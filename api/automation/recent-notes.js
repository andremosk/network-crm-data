const { getSql } = require("../../lib/crm-db");

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

function getHeader(request, name) {
  const value = request.headers?.[name] || request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseQuery(request) {
  if (request.query) return request.query;
  const url = new URL(request.url || "/", "https://network-crm-data.vercel.app");
  return Object.fromEntries(url.searchParams.entries());
}

function parseLimit(value) {
  const limit = Number.parseInt(value || `${DEFAULT_LIMIT}`, 10);
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compactText(value) {
  return stripHtml(value).replace(/\n{3,}/g, "\n\n").trim();
}

function parseContactDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNoteDate(monthName, day, year, fallbackYear) {
  const month = MONTHS[String(monthName || "").toLowerCase().replace(".", "")];
  if (month === undefined) return null;
  const noteYear = Number.parseInt(year || fallbackYear || `${new Date().getFullYear()}`, 10);
  const noteDay = Number.parseInt(day, 10);
  if (!noteYear || !noteDay) return null;
  const parsed = new Date(Date.UTC(noteYear, month, noteDay, 12, 0, 0));
  if (!year && parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    parsed.setUTCFullYear(parsed.getUTCFullYear() - 1);
  }
  return parsed;
}

function toEasternIso(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMinutes = Math.round((asUtc - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${hh}:${mm}`;
}

function sourceUrl(contact) {
  if (contact.id === undefined || contact.id === null) return undefined;
  return `https://network-crm-data.vercel.app/contacts/${encodeURIComponent(contact.id)}`;
}

function inferTags(contact, note) {
  const text = `${contact.company || ""} ${contact.position || ""} ${note || ""}`.toLowerCase();
  const tags = [];
  if (/\bai\b|chatgpt|automation|training|enablement/.test(text)) tags.push("AI consulting");
  if (/intro|introduc|refer|connect/.test(text)) tags.push("warm intro");
  if (/belmont/.test(text)) tags.push("Belmont");
  if (/job search|interview|resume|recruiter|role/.test(text)) tags.push("job search");
  if (/linkedin live|never search alone/.test(text)) tags.push("active workstream");
  return tags;
}

function splitNoteEntries(contact) {
  const notes = compactText(contact.notes || "");
  if (!notes) return [];

  const fallbackDate = parseContactDate(contact.lastContact || contact.updatedAt || contact.updated_at || contact.addedDate);
  const fallbackYear = fallbackDate ? fallbackDate.getUTCFullYear() : new Date().getFullYear();
  const matches = [...notes.matchAll(/\b(Jan\.?|January|Feb\.?|February|Mar\.?|March|Apr\.?|April|May|Jun\.?|June|Jul\.?|July|Aug\.?|August|Sep\.?|Sept\.?|September|Oct\.?|October|Nov\.?|November|Dec\.?|December)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*:/gi)];

  if (!matches.length) {
    return fallbackDate ? [{ updatedAt: fallbackDate, note: notes }] : [];
  }

  const entries = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const next = matches[i + 1];
    const noteDate = parseNoteDate(match[1], match[2], match[3], fallbackYear);
    const start = match.index + match[0].length;
    const end = next ? next.index : notes.length;
    const note = notes.slice(start, end).trim();
    if (noteDate && note) entries.push({ updatedAt: noteDate, note });
  }

  return entries;
}

function noteRecord(contact, entry) {
  const record = {
    contact_name: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown",
    updated_at: toEasternIso(entry.updatedAt),
    note: entry.note
  };
  if (contact.company) record.company = contact.company;
  if (contact.email) record.email = contact.email;
  const tags = inferTags(contact, entry.note);
  if (tags.length) record.tags = tags;
  const url = sourceUrl(contact);
  if (url) record.source_url = url;
  return record;
}

function matchesSearch(record, terms) {
  if (!terms.length) return true;
  const haystack = [
    record.contact_name,
    record.company,
    record.email,
    record.note,
    record.next_action,
    ...(record.tags || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

async function loadContacts() {
  const sql = getSql();
  const rows = await sql`
    SELECT payload FROM crm_records
    WHERE record_type = 'contact'
    ORDER BY updated_at DESC
  `;
  return rows.map((row) => row.payload);
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: { message: "Method not allowed" } });
  }

  const expectedToken = process.env.NETWORK_CRM_AUTOMATION_TOKEN;
  if (!expectedToken) {
    return response.status(500).json({ error: { message: "NETWORK_CRM_AUTOMATION_TOKEN is not set." } });
  }

  const auth = getHeader(request, "authorization") || "";
  if (auth !== `Bearer ${expectedToken}`) {
    return response.status(401).json({ error: { message: "Unauthorized" } });
  }

  const query = parseQuery(request);
  const since = query.since ? new Date(query.since) : new Date(0);
  if (Number.isNaN(since.getTime())) {
    return response.status(400).json({ error: { message: "Invalid since timestamp." } });
  }

  const limit = parseLimit(query.limit);
  const terms = String(query.q || "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  try {
    const contacts = await loadContacts();
    const notes = contacts
      .filter((contact) => !contact.deleted && !contact.archived)
      .flatMap((contact) => splitNoteEntries(contact).map((entry) => noteRecord(contact, entry)))
      .filter((record) => new Date(record.updated_at).getTime() >= since.getTime())
      .filter((record) => matchesSearch(record, terms))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, limit);

    return response.status(200).json({ notes });
  } catch (error) {
    console.error("Recent notes Neon query failed:", error);
    return response.status(500).json({ error: { message: "Could not load CRM notes." } });
  }
};
