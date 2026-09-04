const crypto = require("crypto");
const { normalizeEmail, normalizeName } = require("./text-summaries");

const CONTACT_TIERS = new Set([1, 2, 3, 4]);
const CONTACT_STATUSES = new Set([
  "network_closely", "network", "came_through", "follow_up",
  "call_scheduled", "interesting", "recruiter", "cant_help"
]);
const MAX_NOTE_LENGTH = 2400;

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function validDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const parsed = new Date(`${text}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : text;
}

function requestHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function publicContact(contact, created = false) {
  return {
    id: String(contact._recordId ?? contact.id ?? ""),
    name: cleanText(contact.name, 200),
    created
  };
}

function normalizeSelector(value) {
  const selector = value || {};
  const contactId = String(selector.contact_id || selector.id || "").trim();
  const name = cleanText(selector.name, 200);
  const email = normalizeEmail(selector.email);
  if (!contactId && !name && !email) return { error: "Provide contact.id, contact.name, or contact.email." };
  if (email && (!email.includes("@") || email.length > 320)) return { error: "contact.email must be a valid email address." };
  return { contactId, name, normalizedName: normalizeName(name), email };
}

function validatePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Request body must be an object." };
  const requestId = String(body.request_id || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(requestId)) {
    return { error: "request_id must be 8-200 characters using letters, numbers, '.', '_', ':', or '-'." };
  }
  const action = body.action || "apply";
  if (!["lookup", "apply"].includes(action)) return { error: "action must be lookup or apply." };
  const selector = normalizeSelector(body.contact);
  if (selector.error) return selector;
  const note = cleanText(body.note, MAX_NOTE_LENGTH);
  const rawProfile = body.profile;
  let profile = null;
  if (rawProfile != null) {
    if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) return { error: "profile must be an object." };
    profile = {};
    if (rawProfile.tier != null) {
      const tier = Number(rawProfile.tier);
      if (!Number.isInteger(tier) || !CONTACT_TIERS.has(tier)) return { error: "profile.tier must be 1, 2, 3, or 4." };
      profile.tier = tier;
    }
    if (rawProfile.client_fit_tier != null || rawProfile.clientFitTier != null) {
      const tier = Number(rawProfile.client_fit_tier ?? rawProfile.clientFitTier);
      if (!Number.isInteger(tier) || !CONTACT_TIERS.has(tier)) return { error: "profile.client_fit_tier must be 1, 2, 3, or 4." };
      profile.clientFitTier = tier;
    }
    if (rawProfile.status != null) {
      const status = String(rawProfile.status).trim();
      if (!CONTACT_STATUSES.has(status)) return { error: "profile.status is not an allowed CRM status." };
      profile.status = status;
    }
    if (!Object.keys(profile).length) return { error: "profile must include tier, client_fit_tier, or status." };
  }
  const rawFollowUp = body.follow_up;
  let followUp = null;
  if (rawFollowUp != null) {
    if (!rawFollowUp || typeof rawFollowUp !== "object" || Array.isArray(rawFollowUp)) return { error: "follow_up must be an object." };
    if (rawFollowUp.status !== "follow_up") return { error: "follow_up.status must be follow_up." };
    const date = rawFollowUp.date == null || rawFollowUp.date === "" ? "" : validDate(rawFollowUp.date);
    if (rawFollowUp.date && !date) return { error: "follow_up.date must use YYYY-MM-DD." };
    followUp = { status: "follow_up", date };
  }
  const rawCreate = body.create;
  let create = null;
  if (rawCreate != null) {
    if (!rawCreate || typeof rawCreate !== "object" || Array.isArray(rawCreate)) return { error: "create must be an object." };
    const name = cleanText(rawCreate.name || selector.name, 200);
    const email = normalizeEmail(rawCreate.email || selector.email);
    const company = cleanText(rawCreate.company, 200);
    const position = cleanText(rawCreate.position, 200);
    const tier = rawCreate.tier == null ? 3 : Number(rawCreate.tier);
    if (!name) return { error: "create.name is required when creating a contact." };
    if (email && (!email.includes("@") || email.length > 320)) return { error: "create.email must be a valid email address." };
    if (!CONTACT_TIERS.has(tier)) return { error: "create.tier must be 1, 2, 3, or 4." };
    create = { name, email, company, position, tier };
  }
  if (action === "lookup" && (create || note || profile || followUp || body.create_if_missing)) {
    return { error: "lookup requests cannot create or modify contacts." };
  }
  if (action === "apply" && !note && !profile && !followUp && !create) {
    return { error: "apply requests need create, note, profile, or follow_up." };
  }
  if (body.create_if_missing && !create) return { error: "create_if_missing requires a create block." };
  return {
    requestId, action, selector, createIfMissing: body.create_if_missing === true,
    create, note, profile, followUp
  };
}

function splitName(name) {
  const parts = cleanText(name, 200).split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

function createPayload(create, requestId) {
  const { firstName, lastName } = splitName(create.name);
  return {
    name: create.name, firstName, lastName, tier: create.tier, company: create.company,
    position: create.position, linkedin: "", email: create.email, phone: "", notes: "",
    companyFlag: false, functionFlag: false, positionFlag: false, knowsMe: false,
    status: null, recruiter: false, followUp: false, followUpDate: "", notInterested: false,
    lastContact: "", addedDate: new Date().toISOString().slice(0, 10),
    automationRequestIds: [requestId]
  };
}

function formatNote(note) {
  if (!note) return "";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric"
  }).format(new Date());
  return `${date}: ${note}`;
}

function applyChanges(contact, request) {
  const payload = { ...contact };
  const alreadyApplied = Array.isArray(payload.automationRequestIds)
    && payload.automationRequestIds.includes(request.requestId);
  if (alreadyApplied) return { payload, alreadyApplied: true, keptLaterDate: false };
  if (request.note) {
    const entry = formatNote(request.note);
    payload.notes = [String(payload.notes || "").trim(), entry].filter(Boolean).join("\n");
  }
  if (request.profile) {
    if (request.profile.tier != null) payload.tier = request.profile.tier;
    if (request.profile.clientFitTier != null) payload.clientFitTier = request.profile.clientFitTier;
    if (request.profile.status != null) {
      payload.status = request.profile.status;
      payload.followUp = request.profile.status === "follow_up";
      if (request.profile.status !== "follow_up") payload.followUpDate = "";
    }
  }
  let keptLaterDate = false;
  if (request.followUp) {
    payload.status = "follow_up";
    payload.followUp = true;
    const current = validDate(payload.followUpDate);
    if (request.followUp.date) {
      if (current && current > request.followUp.date) keptLaterDate = true;
      else payload.followUpDate = request.followUp.date;
    }
  }
  payload.automationRequestIds = [...(Array.isArray(payload.automationRequestIds) ? payload.automationRequestIds : []), request.requestId].slice(-100);
  return { payload, alreadyApplied: false, keptLaterDate };
}

module.exports = { applyChanges, createPayload, publicContact, requestHash, validDate, validatePayload };
