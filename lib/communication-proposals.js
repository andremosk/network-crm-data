const crypto = require("crypto");

const MAX_TEXT_LENGTH = 12000;
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"
]);

function cleanText(value, limit = MAX_TEXT_LENGTH) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function sourceHash(source, sourceMessageId) {
  return crypto.createHash("sha256").update(`${source}:${sourceMessageId}`).digest("hex");
}

function dateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function titleFromEmail(email) {
  return normalizeEmail(email).split("@")[0]
    .replace(/[._+-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function companyFromEmail(email) {
  const domain = normalizeEmail(email).split("@")[1] || "";
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return "";
  const label = domain.split(".")[0].replace(/[-_]+/g, " ");
  return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function recipientList(payload) {
  const raw = payload.recipients || payload.to || (payload.recipient ? [payload.recipient] : []);
  return (Array.isArray(raw) ? raw : [raw]).map((recipient) => {
    if (typeof recipient === "string") return { email: normalizeEmail(recipient), name: "" };
    return {
      email: normalizeEmail(recipient?.email || recipient?.address),
      name: cleanText(recipient?.name, 160),
      company: cleanText(recipient?.company, 160),
      position: cleanText(recipient?.position || recipient?.title, 160)
    };
  }).filter((recipient) => recipient.email);
}

function senderFromEmail(payload) {
  const raw = payload.sender || payload.from || payload.senderEmail || {};
  if (typeof raw === "string") return { email: normalizeEmail(raw), name: "" };
  return {
    email: normalizeEmail(raw?.email || raw?.address),
    name: cleanText(raw?.name, 160)
  };
}

function isInbound(payload) {
  return payload.direction === "inbound" || payload.inbound === true;
}

function directMessageBody(body) {
  return String(body || "")
    .split(/(?:^|\n)\s*(?:-+\s*forwarded message\s*-+|from:\s+.*\n(?:date|sent):)/i)[0]
    .trim();
}

function hasPersonalInboundContext(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  return /\b(you (?:both )?came to mind|thought (?:of|you)|hope you(?:'| a)re|how are you|kids|family|talk again|catch up|reconnect|would love to|curious how)\b/.test(text);
}

function looksAutomated(subject, body, recipient) {
  const text = `${subject} ${body}`.toLowerCase();
  return /\b(receipt|invoice|order confirmation|shipping confirmation|unsubscribe|newsletter|verification code|password reset|do not reply|no[- ]?reply|automated message)\b/.test(text)
    || /^(no[-_.]?reply|notifications?|mailer-daemon)@/.test(recipient.email);
}

function signalFor(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  const patterns = [
    ["reconnect", /\b(reconnect|reconnecting|been meaning to reach out|checking in)\b/],
    ["catch up", /\b(catch up|catching up|coffee|grab coffee)\b/],
    ["connect", /\b(connect|connecting|set up (?:a )?time|find a time|schedule a time)\b/],
    ["follow up", /\b(follow[ -]?up|following up|circle back)\b/],
    ["calendar", /\b(calendar|calendly)\b/],
    ["relationship", /\b(how are you|great (?:meeting|speaking|talking)|thank you for|introduction|intro)\b/]
  ];
  return patterns.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

function isLowSignalLogistics(subject, body, signal) {
  const text = `${subject} ${body}`.toLowerCase();
  if (text.length > 240) return false;
  if (["reconnect", "catch up", "connect", "follow up", "relationship"].includes(signal)) return false;
  return /\b(tuesday|wednesday|thursday|friday|monday|tomorrow|today|zoom|meet link|reschedule|works for me|see you then|confirmed)\b/.test(text);
}

function meaningfulExcerpt(body, subject) {
  const cleaned = cleanText(body, 1200)
    .replace(/\b(best|best regards|regards|thanks),?\s+andre.*$/i, "")
    .trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const useful = sentences
    .map((sentence) => cleanText(sentence, 280))
    .filter((sentence) => sentence.length >= 24)
    .filter((sentence) => !/^(hi|hey|hello)\b[^.!?]{0,50}[.!?]?$/i.test(sentence));
  return cleanText(useful.slice(0, 2).join(" ") || subject || cleaned, 360);
}

function analyzeOutboundEmail(payload, matchedContact = null, now = new Date()) {
  const sourceMessageId = cleanText(payload.sourceMessageId || payload.messageId || payload.id, 500);
  const inbound = isInbound(payload);
  const sentAt = new Date((inbound ? payload.receivedAt : payload.sentAt) || payload.occurredAt || now);
  const recipients = recipientList(payload);
  const subject = cleanText(payload.subject, 300);
  const rawBody = String(payload.bodyText || payload.text || payload.body || "");
  const body = cleanText(inbound ? directMessageBody(rawBody) : rawBody);
  const sender = senderFromEmail(payload);

  if (!sourceMessageId || Number.isNaN(sentAt.getTime())) return { status: "invalid", reason: "Missing source message ID or sent date." };
  if (inbound) {
    if (!sender.email) return { status: "invalid", reason: "Missing inbound sender email." };
    if (recipients.length !== 1) {
      return { status: "excluded", reason: "Inbound mail is not a direct one-to-one message." };
    }
    if (looksAutomated(subject, body, sender)) return { status: "excluded", reason: "Automated or transactional mail." };
    if (!hasPersonalInboundContext(subject, body)) return { status: "excluded", reason: "No personal relationship context detected." };
    if (matchedContact === null && payload.requireKnownContact === true) {
      return { status: "excluded", reason: "Inbound mail must match an existing contact." };
    }
    if (matchedContact === null) {
      return {
        status: "pending",
        source: "email",
        sourceMessageId,
        sourceHash: sourceHash("email", sourceMessageId),
        recipientEmail: sender.email,
        occurredAt: sentAt.toISOString(),
        proposalType: "update_contact",
        matchedContactId: null,
        evidence: meaningfulExcerpt(body, subject),
        proposed: {},
        signal: "relationship"
      };
    }
    const excerpt = meaningfulExcerpt(body, subject);
    if (!excerpt) return { status: "excluded", reason: "No useful relationship context detected." };
    const evidence = cleanText(`${subject ? `${subject}: ` : ""}${excerpt}`, 420);
    return {
      status: "pending",
      source: "email",
      sourceMessageId,
      sourceHash: sourceHash("email", sourceMessageId),
      recipientEmail: sender.email,
      occurredAt: sentAt.toISOString(),
      proposalType: "update_contact",
      matchedContactId: String(matchedContact.id),
      evidence,
      proposed: {
        note: `Received email from ${matchedContact.name || sender.name || titleFromEmail(sender.email)}: ${evidence}`,
        status: null,
        followUpDate: "",
        lastContact: dateOnly(sentAt)
      },
      signal: "relationship"
    };
  }

  if (recipients.length !== 1) return { status: "excluded", reason: "Only direct one-to-one sent mail is eligible." };
  const recipient = recipients[0];
  if (looksAutomated(subject, body, recipient)) return { status: "excluded", reason: "Automated or transactional mail." };
  const signal = signalFor(subject, body);
  if (!signal || isLowSignalLogistics(subject, body, signal)) return { status: "excluded", reason: "No durable relationship action detected." };

  const excerpt = meaningfulExcerpt(body, subject);
  if (!excerpt) return { status: "excluded", reason: "No useful relationship context detected." };
  const name = recipient.name || titleFromEmail(recipient.email) || "New contact";
  const oldColleague = /\b(old|former) colleague|worked together|when we worked|remember when|reminisce/i.test(body);
  const followUpDate = addDays(sentAt, 7);
  const contactName = matchedContact?.name || name;
  const evidence = cleanText(`${subject ? `${subject}: ` : ""}${excerpt}`, 420);
  const note = `Sent email to ${contactName}: ${evidence}`;
  const proposalType = matchedContact ? "update_contact" : "create_contact";
  const proposed = matchedContact ? {
    note,
    status: "follow_up",
    followUpDate,
    lastContact: dateOnly(sentAt)
  } : {
    name,
    firstName: name.split(/\s+/)[0] || "",
    lastName: name.split(/\s+/).slice(1).join(" "),
    email: recipient.email,
    company: recipient.company || cleanText(payload.company, 160) || companyFromEmail(recipient.email),
    position: recipient.position || cleanText(payload.position || payload.title, 160),
    tier: oldColleague ? 2 : 3,
    notes: note,
    status: "follow_up",
    followUpDate,
    lastContact: dateOnly(sentAt)
  };

  return {
    status: "pending",
    source: "email",
    sourceMessageId,
    sourceHash: sourceHash("email", sourceMessageId),
    recipientEmail: recipient.email,
    occurredAt: sentAt.toISOString(),
    proposalType,
    matchedContactId: matchedContact?.id ? String(matchedContact.id) : null,
    evidence,
    proposed,
    signal
  };
}

function sanitizeProposal(type, proposed) {
  const value = proposed || {};
  const status = value.status === "follow_up" ? "follow_up" : null;
  const followUpDate = dateOnly(value.followUpDate);
  const common = {
    notes: cleanText(value.notes || value.note, 2000),
    status,
    followUpDate: status ? followUpDate : "",
    lastContact: dateOnly(value.lastContact)
  };
  if (type === "update_contact") return {
    note: common.notes,
    email: normalizeEmail(value.email),
    status,
    followUpDate: common.followUpDate,
    lastContact: common.lastContact
  };
  if (type !== "create_contact") return {};
  const name = cleanText(value.name, 200);
  return {
    name,
    firstName: cleanText(value.firstName || name.split(/\s+/)[0], 100),
    lastName: cleanText(value.lastName || name.split(/\s+/).slice(1).join(" "), 120),
    email: normalizeEmail(value.email),
    company: cleanText(value.company, 200),
    position: cleanText(value.position, 200),
    tier: [1, 2, 3, 4].includes(Number(value.tier)) ? Number(value.tier) : 3,
    ...common
  };
}

function createContactPayload(proposed, id) {
  const clean = sanitizeProposal("create_contact", proposed);
  return {
    id: Number(id), name: clean.name, firstName: clean.firstName, lastName: clean.lastName,
    tier: clean.tier, company: clean.company, position: clean.position, linkedin: "",
    email: clean.email, phone: "", notes: clean.notes, companyFlag: false,
    functionFlag: false, positionFlag: false, knowsMe: false, status: clean.status,
    recruiter: false, followUp: clean.status === "follow_up", followUpDate: clean.followUpDate,
    notInterested: false, lastContact: clean.lastContact, addedDate: dateOnly(new Date())
  };
}

function applyUpdatePayload(contact, proposed) {
  const clean = sanitizeProposal("update_contact", proposed);
  const currentDate = dateOnly(contact.followUpDate);
  const keepLater = currentDate && clean.followUpDate && currentDate > clean.followUpDate;
  return {
    ...contact,
    notes: clean.note ? [contact.notes, clean.note].filter(Boolean).join("\n") : contact.notes,
    email: !normalizeEmail(contact.email) && clean.email ? clean.email : contact.email,
    status: clean.status || contact.status,
    followUp: clean.status === "follow_up" ? true : contact.followUp,
    followUpDate: keepLater ? currentDate : (clean.followUpDate || currentDate),
    lastContact: clean.lastContact && clean.lastContact > String(contact.lastContact || "") ? clean.lastContact : contact.lastContact
  };
}

module.exports = {
  addDays,
  analyzeOutboundEmail,
  applyUpdatePayload,
  cleanText,
  createContactPayload,
  dateOnly,
  normalizeEmail,
  sanitizeProposal,
  sourceHash
};
