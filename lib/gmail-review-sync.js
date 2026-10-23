const { analyzeOutboundEmail, calendarComment, cleanText, normalizeEmail, sourceHash } = require("./communication-proposals");

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_REVIEW_BATCH_SIZE = 25;
const DEFAULT_ENRICHMENT_BATCH_SIZE = 20;

function gmailMailbox(env = process.env) {
  return normalizeEmail(env.NETWORK_CRM_GMAIL_MAILBOX);
}

function normalizeName(value) {
  return cleanText(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function decodeBase64Url(value) {
  if (!value) return "";
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function headerMap(headers = []) {
  return headers.reduce((result, header) => {
    result[String(header?.name || "").toLowerCase()] = String(header?.value || "");
    return result;
  }, {});
}

function addressList(value) {
  return String(value || "").split(",").map((part) => {
    const match = part.match(/^(?:\s*([^<]*)<)?\s*([^<>\s,]+@[^<>\s,]+)\s*>?\s*$/);
    if (!match) return null;
    return { name: cleanText(match[1] || "", 160).replace(/^['\"]|['\"]$/g, ""), email: normalizeEmail(match[2]) };
  }).filter(Boolean);
}

function textBody(part) {
  const plain = bodyOfType(part, 'text/plain');
  if (plain.trim()) return plain;
  return bodyOfType(part, 'text/html')
    .replace(/<(script|style|blockquote)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (all, code) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    })
    .replace(/&(nbsp|amp|quot|apos|lt|gt|rsquo|lsquo|rdquo|ldquo);/gi, (_, name) => ({
      nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"'
    })[name.toLowerCase()]).trim();
}

function bodyOfType(part, type) {
  if (!part) return "";
  if (part.filename) return '';
  if (part.mimeType === type && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts || []) {
    const text = bodyOfType(child, type);
    if (text) return text;
  }
  return "";
}

function isAutomatedGmail(headers) {
  const precedence = String(headers.precedence || "").toLowerCase();
  const submitted = String(headers["auto-submitted"] || "").toLowerCase();
  return Boolean(headers["list-id"]) || /bulk|list|junk/.test(precedence) || (submitted && submitted !== "no");
}

function normalizedInboundMessage(message, mailbox) {
  const headers = headerMap(message?.payload?.headers);
  const sender = addressList(headers.from)[0];
  const recipients = [...addressList(headers.to), ...addressList(headers.cc)];
  if (!sender || recipients.length !== 1 || recipients[0].email !== mailbox) return null;
  const body = textBody(message.payload);
  // A calendar wrapper may be automated while its quoted attendee comment is personal.
  const personalCalendarReply = calendarComment(headers.subject, body)
    && !headers['list-id'] && !/bulk|list|junk/i.test(headers.precedence || '')
    && !/^(no[-_.]?reply|notifications?|mailer-daemon)@/i.test(sender.email);
  if (isAutomatedGmail(headers) && !personalCalendarReply) return null;
  const receivedAt = new Date(Number(message.internalDate || 0));
  if (Number.isNaN(receivedAt.getTime()) || !message.id) return null;
  return {
    direction: "inbound",
    sourceMessageId: String(message.id),
    receivedAt: receivedAt.toISOString(),
    sender,
    recipients,
    subject: headers.subject || "",
    bodyText: body,
    requireKnownContact: true
  };
}

async function getGmailAccessToken(env = process.env, fetchImpl = fetch) {
  const clientId = env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = env.GOOGLE_GMAIL_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Could not connect to Gmail.");
  return data.access_token;
}

function dateQuery(value) {
  const date = new Date(value);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

async function gmailRequest(accessToken, path, fetchImpl = fetch) {
  const response = await fetchImpl(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Gmail request failed.");
  return data;
}

async function loadSyncState(sql, mailbox) {
  const rows = await sql`SELECT last_successful_at, next_page_token, window_since, window_until FROM crm_gmail_review_sync_state WHERE mailbox_email = ${mailbox}`;
  return rows[0] || null;
}

async function saveSyncState(sql, mailbox, completedAt, progress = {}) {
  await sql`
    INSERT INTO crm_gmail_review_sync_state (mailbox_email, last_successful_at, last_run_at, next_page_token, window_since, window_until)
    VALUES (${mailbox}, ${completedAt}, NOW(), ${progress.nextPageToken || null}, ${progress.since || null}, ${progress.until || null})
    ON CONFLICT (mailbox_email) DO UPDATE
    SET last_successful_at = EXCLUDED.last_successful_at, last_run_at = EXCLUDED.last_run_at,
        next_page_token = EXCLUDED.next_page_token, window_since = EXCLUDED.window_since,
        window_until = EXCLUDED.window_until, updated_at = NOW()
  `;
}

async function findContactByEmail(sql, email) {
  const rows = await sql`
    SELECT record_id, payload FROM crm_records
    WHERE record_type = 'contact'
      AND LOWER(COALESCE(payload->>'email', '')) = ${normalizeEmail(email)}
      AND COALESCE((payload->>'deleted')::boolean, false) = false
      AND COALESCE((payload->>'archived')::boolean, false) = false
    ORDER BY updated_at DESC LIMIT 1
  `;
  return rows.length ? { id: rows[0].record_id, ...rows[0].payload } : null;
}

async function findUniqueContactByName(sql, name, requireMissingEmail = true) {
  const target = normalizeName(name);
  if (!target || target.split(" ").length < 2) return null;
  const rows = await sql`
    SELECT record_id, payload FROM crm_records
    WHERE record_type = 'contact'
      AND COALESCE((payload->>'deleted')::boolean, false) = false
      AND COALESCE((payload->>'archived')::boolean, false) = false
  `;
  const matches = rows.filter((row) => {
    const contactName = row.payload.name || [row.payload.firstName, row.payload.lastName].filter(Boolean).join(" ");
    return normalizeName(contactName) === target && (!requireMissingEmail || !normalizeEmail(row.payload.email));
  });
  return matches.length === 1 ? { id: matches[0].record_id, ...matches[0].payload } : null;
}

async function insertProposal(sql, proposal) {
  const rows = await sql`
    INSERT INTO crm_communication_proposals (
      source, source_message_id, source_hash, recipient_email, occurred_at,
      proposal_type, matched_contact_id, evidence, proposed
    ) VALUES (
      ${proposal.source}, ${proposal.sourceMessageId}, ${proposal.sourceHash}, ${proposal.recipientEmail}, ${proposal.occurredAt},
      ${proposal.proposalType}, ${proposal.matchedContactId}, ${proposal.evidence}, ${JSON.stringify(proposal.proposed)}::jsonb
    ) ON CONFLICT (source_hash) DO NOTHING RETURNING id
  `;
  return rows.length ? "created" : "duplicate";
}

async function hasPendingEmailEnrichment(sql, contactId, email) {
  const rows = await sql`
    SELECT id FROM crm_communication_proposals
    WHERE source = 'email'
      AND proposal_type = 'update_contact'
      AND status = 'pending'
      AND matched_contact_id = ${String(contactId)}
      AND LOWER(COALESCE(proposed->>'email', '')) = ${normalizeEmail(email)}
    LIMIT 1
  `;
  return rows.length > 0;
}

function enrichmentCandidate(message, mailbox) {
  const headers = headerMap(message?.payload?.headers);
  if (isAutomatedGmail(headers)) return null;
  const sender = addressList(headers.from)[0];
  const recipients = [...addressList(headers.to), ...addressList(headers.cc)];
  if (!sender || !message?.id) return null;
  const counterparties = sender.email === mailbox
    ? recipients.filter((recipient) => recipient.email !== mailbox)
    : recipients.length === 1 && recipients[0].email === mailbox ? [sender] : [];
  if (counterparties.length !== 1 || !counterparties[0].name) return null;
  const occurredAt = new Date(Number(message.internalDate || 0));
  if (Number.isNaN(occurredAt.getTime())) return null;
  return { person: counterparties[0], subject: cleanText(headers.subject, 300), occurredAt: occurredAt.toISOString(), messageId: String(message.id) };
}

async function loadEnrichmentState(sql, mailbox) {
  const rows = await sql`SELECT next_page_token, completed FROM crm_gmail_email_enrichment_state WHERE mailbox_email = ${mailbox}`;
  return rows[0] || null;
}

async function saveEnrichmentState(sql, mailbox, pageToken, completed) {
  await sql`
    INSERT INTO crm_gmail_email_enrichment_state (mailbox_email, next_page_token, completed, last_run_at)
    VALUES (${mailbox}, ${pageToken || null}, ${completed}, NOW())
    ON CONFLICT (mailbox_email) DO UPDATE
    SET next_page_token = EXCLUDED.next_page_token, completed = EXCLUDED.completed, last_run_at = NOW(), updated_at = NOW()
  `;
}

async function runGmailReviewSync({ sql, env = process.env, fetchImpl = fetch, now = new Date(), dependencies = {} }) {
  const mailbox = dependencies.mailbox || gmailMailbox(env);
  if (!mailbox) throw new Error("NETWORK_CRM_GMAIL_MAILBOX is not configured.");
  const accessToken = await (dependencies.getAccessToken || getGmailAccessToken)(env, fetchImpl);
  if (!accessToken) throw new Error("Gmail review is not configured.");
  const state = await (dependencies.loadSyncState || loadSyncState)(sql, mailbox);
  const lookbackDays = Math.max(1, Math.min(Number(env.NETWORK_CRM_GMAIL_INITIAL_LOOKBACK_DAYS) || DEFAULT_LOOKBACK_DAYS, 60));
  const batchSize = Math.max(1, Math.min(Number(env.NETWORK_CRM_GMAIL_REVIEW_BATCH_SIZE) || DEFAULT_REVIEW_BATCH_SIZE, 100));
  const since = state?.window_since || state?.last_successful_at || new Date(now.getTime() - lookbackDays * 86400000).toISOString();
  const until = state?.window_until || now.toISOString();
  const pageToken = state?.next_page_token || '';
  const list = await (dependencies.listMessages || (async (token, date, page, upper) => {
    const query = `after:${Math.floor(new Date(date).getTime() / 1000) - 1} before:${Math.ceil(new Date(upper).getTime() / 1000)} -from:me`;
    return gmailRequest(token, `/messages?labelIds=INBOX&q=${encodeURIComponent(query)}&maxResults=${batchSize}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, fetchImpl);
  }))(accessToken, since, pageToken, until);
  const messages = Array.isArray(list.messages) ? list.messages : [];
  const result = { scanned: messages.length, proposed: 0, approximated: 0, duplicates: 0, skipped: 0, has_more: Boolean(list.nextPageToken) };
  for (const item of messages) {
    const raw = await (dependencies.getMessage || (async (token, id) => gmailRequest(token, `/messages/${encodeURIComponent(id)}?format=full`, fetchImpl)))(accessToken, item.id);
    const normalized = normalizedInboundMessage(raw, mailbox);
    if (!normalized) { result.skipped += 1; continue; }
    const findByEmail = dependencies.findContactByEmail || findContactByEmail;
    const exactContact = await findByEmail(sql, normalized.sender.email);
    const contact = exactContact
      || await (dependencies.findUniqueContactByName || findUniqueContactByName)(sql, normalized.sender.name, true);
    const proposal = analyzeOutboundEmail(normalized, contact, now);
    if (proposal.status !== "pending") { result.skipped += 1; continue; }
    if (!exactContact && !normalizeEmail(contact.email)) {
      proposal.proposed.email = normalized.sender.email;
      proposal.evidence = cleanText(`${proposal.evidence} Suggested unique name match; save ${normalized.sender.email}.`, 420);
      result.approximated += 1;
    }
    const status = await (dependencies.insertProposal || insertProposal)(sql, proposal);
    if (status === "created") result.proposed += 1;
    else result.duplicates += 1;
  }
  await (dependencies.saveSyncState || saveSyncState)(sql, mailbox,
    result.has_more ? state?.last_successful_at || null : new Date(until).toISOString(),
    result.has_more ? { nextPageToken: list.nextPageToken, since, until } : {});
  return result;
}

async function loadRecentEnrichmentState(sql, mailbox) {
  const rows = await sql`SELECT * FROM crm_gmail_recent_enrichment_state WHERE mailbox_email = ${mailbox}`;
  return rows[0] || null;
}

async function saveRecentEnrichmentState(sql, mailbox, checkpoint, progress) {
  await sql`INSERT INTO crm_gmail_recent_enrichment_state
    (mailbox_email, last_successful_at, last_run_at, next_page_token, window_since, window_until)
    VALUES (${mailbox}, ${checkpoint}, NOW(), ${progress.nextPageToken || null}, ${progress.since || null}, ${progress.until || null})
    ON CONFLICT (mailbox_email) DO UPDATE SET last_successful_at = EXCLUDED.last_successful_at,
      last_run_at = NOW(), next_page_token = EXCLUDED.next_page_token,
      window_since = EXCLUDED.window_since, window_until = EXCLUDED.window_until, updated_at = NOW()`;
}

async function runGmailEmailEnrichment({ sql, env = process.env, fetchImpl = fetch, dependencies = {}, recent = false, now = new Date() }) {
  const mailbox = dependencies.mailbox || gmailMailbox(env);
  if (!mailbox) throw new Error("NETWORK_CRM_GMAIL_MAILBOX is not configured.");
  const accessToken = await (dependencies.getAccessToken || getGmailAccessToken)(env, fetchImpl);
  if (!accessToken) throw new Error("Gmail review is not configured.");
  const state = await (recent
    ? dependencies.loadRecentEnrichmentState || loadRecentEnrichmentState
    : dependencies.loadEnrichmentState || loadEnrichmentState)(sql, mailbox);
  if (state?.completed) return { scanned: 0, proposed: 0, duplicates: 0, skipped: 0, completed: true };
  const batchSize = Math.max(1, Math.min(Number(env.NETWORK_CRM_GMAIL_ENRICHMENT_BATCH_SIZE) || DEFAULT_ENRICHMENT_BATCH_SIZE, 100));
  const since = recent ? state?.window_since || state?.last_successful_at || new Date(now.getTime() - 14 * 86400000).toISOString() : null;
  const until = recent ? state?.window_until || now.toISOString() : null;
  const query = recent
    ? `after:${Math.floor(new Date(since).getTime() / 1000) - 1} before:${Math.ceil(new Date(until).getTime() / 1000)}`
    : 'in:anywhere';
  const list = await (dependencies.listMessages || (async (token, pageToken) => gmailRequest(token, `/messages?includeSpamTrash=false&maxResults=${batchSize}&q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, fetchImpl)))(accessToken, state?.next_page_token || "", query);
  const messages = Array.isArray(list.messages) ? list.messages : [];
  const result = { scanned: messages.length, proposed: 0, duplicates: 0, skipped: 0, completed: !list.nextPageToken };
  for (const item of messages) {
    const raw = await (dependencies.getMessage || (async (token, id) => gmailRequest(token, `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`, fetchImpl)))(accessToken, item.id);
    const candidate = enrichmentCandidate(raw, mailbox);
    if (!candidate) { result.skipped += 1; continue; }
    const contact = await (dependencies.findUniqueContactByName || findUniqueContactByName)(sql, candidate.person.name, true);
    if (!contact) { result.skipped += 1; continue; }
    const hasPending = await (dependencies.hasPendingEmailEnrichment || hasPendingEmailEnrichment)(sql, contact.id, candidate.person.email);
    if (hasPending) { result.duplicates += 1; continue; }
    const proposal = {
      source: "email",
      sourceMessageId: `enrichment:${candidate.messageId}:${candidate.person.email}`,
      sourceHash: sourceHash("email", `enrichment:${candidate.messageId}:${candidate.person.email}`),
      recipientEmail: candidate.person.email,
      occurredAt: candidate.occurredAt,
      proposalType: "update_contact",
      matchedContactId: String(contact.id),
      evidence: cleanText(`Direct Gmail conversation${candidate.subject ? `: ${candidate.subject}` : ""}. Suggested unique name match; save ${candidate.person.email}.`, 420),
      proposed: { note: "", email: candidate.person.email, status: null, followUpDate: "", lastContact: "" }
    };
    const status = await (dependencies.insertProposal || insertProposal)(sql, proposal);
    if (status === "created") result.proposed += 1;
    else result.duplicates += 1;
  }
  if (recent) {
    await (dependencies.saveRecentEnrichmentState || saveRecentEnrichmentState)(sql, mailbox,
      list.nextPageToken ? state?.last_successful_at || null : new Date(until).toISOString(),
      list.nextPageToken ? { nextPageToken: list.nextPageToken, since, until } : {});
  } else {
    await (dependencies.saveEnrichmentState || saveEnrichmentState)(sql, mailbox, list.nextPageToken || "", !list.nextPageToken);
  }
  return result;
}

module.exports = {
  addressList,
  getGmailAccessToken,
  gmailMailbox,
  findUniqueContactByName,
  hasPendingEmailEnrichment,
  normalizedInboundMessage,
  runGmailEmailEnrichment,
  runGmailReviewSync
};
