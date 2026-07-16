const crypto = require("crypto");

const MAX_TRANSCRIPT_LENGTH = 24000;

function parseBody(request) {
  if (typeof request.body !== "string") return request.body || {};
  try {
    return JSON.parse(request.body);
  } catch {
    return null;
  }
}

function getBearerToken(request) {
  const header = request.headers?.authorization || request.headers?.Authorization || "";
  const match = String(Array.isArray(header) ? header[0] : header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return text.startsWith("+") && digits ? `+${digits}` : digits;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceKeyFor(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanTranscript(value) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, MAX_TRANSCRIPT_LENGTH);
}

async function summarizeTranscript({ contactName, transcript, startedAt, endedAt }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
  const prompt = `Summarize this private one-to-one text exchange for Andre's relationship CRM.

Contact: ${contactName}
Window: ${startedAt.toISOString()} to ${endedAt.toISOString()}

Capture only durable relationship context: decisions, commitments, meaningful personal context, business needs, introductions, and next steps. Ignore greetings, reactions, scheduling minutiae, verification codes, links without discussion, and casual chatter that will not matter later. Do not invent anything.

Return one concise paragraph of 1-3 sentences, written as a factual CRM update. If there is no durable context, return exactly SKIP.

Transcript:
${transcript}`;
  const result = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 220,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(data.error?.message || "AI summarization failed.");
  return String(data.content?.[0]?.text || "").trim();
}

module.exports = {
  cleanTranscript,
  getBearerToken,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseBody,
  sourceKeyFor,
  summarizeTranscript,
  validDate
};
