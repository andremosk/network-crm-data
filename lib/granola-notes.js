const crypto = require("crypto");
const { normalizeEmail, normalizeName } = require("./text-summaries");

function cleanName(value) {
  return normalizeName(String(value || "")
    .replace(/\s+from\s+.+$/i, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, " "));
}

function words(value) {
  return cleanName(value).split(" ").filter((word) => word.length > 1);
}

function nameSimilarity(left, right) {
  const a = words(left);
  const b = words(right);
  if (a.length < 2 || b.length < 2) return 0;
  if (a.join(" ") === b.join(" ")) return 1;
  if ([...a].sort().join(" ") === [...b].sort().join(" ")) return 0.98;

  const aFirst = a[0];
  const bFirst = b[0];
  const aLast = a[a.length - 1];
  const bLast = b[b.length - 1];
  if (aLast === bLast && (aFirst === bFirst || aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst))) return 0.94;
  if (aLast === bLast && aFirst[0] === bFirst[0]) return 0.86;

  const aSet = new Set(a);
  const overlap = b.filter((word) => aSet.has(word)).length;
  return (2 * overlap) / (a.length + b.length);
}

function textIncludesName(text, name) {
  const normalizedText = normalizeName(text);
  const normalizedName = cleanName(name);
  return normalizedName.split(" ").length >= 2 && (` ${normalizedText} `).includes(` ${normalizedName} `);
}

function companyMatches(contactCompany, participantCompany, meetingTitle) {
  const contact = normalizeName(contactCompany);
  if (!contact || contact.length < 3) return false;
  const participant = normalizeName(participantCompany);
  const title = normalizeName(meetingTitle);
  return participant === contact || (` ${title} `).includes(` ${contact} `);
}

function scoreContact(contact, participant, meetingTitle) {
  const contactName = contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const contactEmail = normalizeEmail(contact.email);
  const participantEmail = normalizeEmail(participant.email);
  if (participantEmail && contactEmail && participantEmail === contactEmail) {
    return { score: 100, method: "email" };
  }

  const similarity = nameSimilarity(contactName, participant.name);
  let score = Math.round(similarity * 92);
  let method = similarity >= 0.98 ? "exact_name" : similarity ? "name_similarity" : "none";

  if (textIncludesName(meetingTitle, contactName)) {
    score = Math.max(score, 88);
    method = similarity >= 0.8 ? "name_and_title" : "meeting_title";
  }
  if (similarity >= 0.75 && companyMatches(contact.company, participant.company, meetingTitle)) {
    score = Math.min(99, score + 8);
    method = "name_and_company";
  }
  return { score, method };
}

function matchContact(contacts, participant, meetingTitle = "") {
  const active = (contacts || []).filter((contact) => !contact.deleted && !contact.archived);
  const ranked = active
    .map((contact) => ({ contact, ...scoreContact(contact, participant || {}, meetingTitle) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || String(a.contact.name || "").localeCompare(String(b.contact.name || "")));

  const top = ranked[0];
  const runnerUp = ranked[1];
  const margin = top ? top.score - (runnerUp?.score || 0) : 0;
  const accepted = top && (
    (top.score === 100 && runnerUp?.score !== 100)
    || (top.score >= 84 && margin >= 10)
  );
  return {
    match: accepted ? top.contact : null,
    method: accepted ? top.method : null,
    score: accepted ? top.score : top?.score || 0,
    candidates: ranked.slice(0, 3).map(({ contact, score, method }) => ({
      contactId: String(contact.id),
      contactName: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" "),
      company: contact.company || undefined,
      score,
      method
    }))
  };
}

function sourceKeyForMeeting(meetingId, participant) {
  const identity = normalizeEmail(participant?.email) || cleanName(participant?.name) || "unknown";
  return crypto.createHash("sha256").update(`${meetingId}:${identity}`).digest("hex");
}

function cleanSummary(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 4000);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function summaryHtml(summary) {
  const lines = cleanSummary(summary)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s*/, ""));
  return lines.map((line) => `• ${escapeHtml(line)}`).join("<br>");
}

module.exports = {
  cleanName,
  cleanSummary,
  matchContact,
  nameSimilarity,
  sourceKeyForMeeting,
  summaryHtml
};
