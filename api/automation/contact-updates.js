const { tokenIsValid } = require("../../lib/crm-auth");
const { ensureSchema, getSql } = require("../../lib/crm-db");
const { createRecord, updateRecord } = require("../crm/state");
const { getBearerToken, normalizeEmail, normalizeName, parseBody } = require("../../lib/text-summaries");
const { applyChanges, createPayload, publicContact, requestHash, validatePayload } = require("../../lib/automation-contact-updates");

function active(record) {
  return ![true, "true", 1, "1"].includes(record.deleted)
    && ![true, "true", 1, "1"].includes(record.archived);
}

function recordFromRow(row) {
  return { ...row.payload, _recordId: row.record_id, _syncVersion: Number(row.version) };
}

async function findById(sql, id) {
  if (!id) return null;
  const rows = await sql`SELECT record_id, payload, version FROM crm_records WHERE record_type = 'contact' AND record_id = ${id}`;
  const record = rows[0] ? recordFromRow(rows[0]) : null;
  return record && active(record) ? record : null;
}

async function findByEmail(sql, email) {
  if (!email) return [];
  const rows = await sql`
    SELECT record_id, payload, version FROM crm_records
    WHERE record_type = 'contact' AND LOWER(COALESCE(payload->>'email', '')) = ${normalizeEmail(email)}
  `;
  return rows.map(recordFromRow).filter(active);
}

async function findByName(sql, name) {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  const rows = await sql`
    SELECT record_id, payload, version FROM crm_records
    WHERE record_type = 'contact'
      AND regexp_replace(LOWER(COALESCE(payload->>'name', '')), '[^a-z0-9]+', ' ', 'g') = ${normalized}
  `;
  return rows.map(recordFromRow).filter(active);
}

async function findByRequestId(sql, requestId) {
  const rows = await sql`
    SELECT record_id, payload, version FROM crm_records
    WHERE record_type = 'contact'
      AND COALESCE(payload->'automationRequestIds', '[]'::jsonb) ? ${requestId}
    LIMIT 1
  `;
  return rows[0] ? recordFromRow(rows[0]) : null;
}

function candidateSummary(records) {
  return records.slice(0, 10).map((record) => ({
    id: String(record._recordId ?? record.id),
    name: String(record.name || ""),
    company: String(record.company || ""),
    position: String(record.position || ""),
    last_contact: String(record.lastContact || ""),
    note_summary: String(record.notes || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280)
  }));
}

async function resolveContact(repository, selector) {
  const byId = selector.contactId ? await repository.findById(selector.contactId) : null;
  const byEmail = selector.email ? await repository.findByEmail(selector.email) : [];
  const byName = selector.normalizedName ? await repository.findByName(selector.name) : [];
  if (selector.contactId && !byId) return { type: "not_found" };
  if (selector.contactId) {
    const others = [...byEmail, ...byName];
    if (others.some((record) => String(record._recordId) !== String(byId._recordId))) {
      return { type: "conflict", candidates: candidateSummary([byId, ...others]) };
    }
    return { type: "resolved", contact: byId };
  }
  if (selector.email) {
    if (byEmail.length > 1) return { type: "ambiguous", candidates: candidateSummary(byEmail) };
    if (byEmail.length === 1) {
      if (byName.length && !byName.some((record) => String(record._recordId) === String(byEmail[0]._recordId))) {
        return { type: "conflict", candidates: candidateSummary([...byEmail, ...byName]) };
      }
      return { type: "resolved", contact: byEmail[0] };
    }
  }
  if (selector.normalizedName) {
    if (byName.length > 1) return { type: "ambiguous", candidates: candidateSummary(byName) };
    if (byName.length === 1) return { type: "resolved", contact: byName[0] };
  }
  return { type: "not_found" };
}

function followUpState(contact, keptLaterDate = false) {
  return {
    status: contact.status === "follow_up" ? "follow_up" : null,
    date: contact.followUpDate || "",
    kept_later_date: keptLaterDate
  };
}

function profileState(contact) {
  return {
    tier: Number(contact.tier) || null,
    client_fit_tier: Number(contact.clientFitTier) || null,
    status: contact.status || null
  };
}

function createRepository(sql) {
  return {
    findById: (id) => findById(sql, id),
    findByEmail: (email) => findByEmail(sql, email),
    findByName: (name) => findByName(sql, name),
    findByRequestId: (requestId) => findByRequestId(sql, requestId),
    create: (payload) => createRecord(sql, "contact", { id: "", create: true, data: payload }),
    update: (contact, payload) => updateRecord(sql, "contact", {
      id: contact._recordId, version: contact._syncVersion, data: payload
    }),
    async claim(requestId, hash) {
      const inserted = await sql`
        INSERT INTO crm_automation_write_requests (request_id, request_hash, status)
        VALUES (${requestId}, ${hash}, 'processing')
        ON CONFLICT (request_id) DO NOTHING
        RETURNING request_id
      `;
      if (inserted.length) return { type: "claimed" };
      const rows = await sql`
        SELECT request_hash, status, response FROM crm_automation_write_requests WHERE request_id = ${requestId}
      `;
      const current = rows[0];
      if (!current || current.request_hash !== hash) return { type: "conflict" };
      if (current.status === "completed" && current.response) return { type: "completed", response: current.response };
      const reclaimed = await sql`
        UPDATE crm_automation_write_requests
        SET status = 'processing', updated_at = NOW()
        WHERE request_id = ${requestId} AND request_hash = ${hash} AND status = 'failed'
        RETURNING request_id
      `;
      return reclaimed.length ? { type: "claimed" } : { type: "in_progress" };
    },
    complete: async (requestId, result) => {
      await sql`
        UPDATE crm_automation_write_requests
        SET status = 'completed', response = ${JSON.stringify(result)}::jsonb, updated_at = NOW()
        WHERE request_id = ${requestId}
      `;
    },
    fail: async (requestId) => {
      await sql`
        UPDATE crm_automation_write_requests
        SET status = 'failed', updated_at = NOW()
        WHERE request_id = ${requestId} AND status = 'processing'
      `;
    }
  };
}

function createHandler(dependencies = {}) {
  const auth = dependencies.auth || tokenIsValid;
  const sqlFactory = dependencies.getSql || getSql;
  const schema = dependencies.ensureSchema || ensureSchema;
  const repositoryFactory = dependencies.createRepository || createRepository;

  return async function handler(request, response) {
    response.setHeader("Cache-Control", "private, no-store");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }
    if (!auth(getBearerToken(request))) return response.status(401).json({ error: { message: "Unauthorized" } });
    const body = parseBody(request);
    if (!body) return response.status(400).json({ error: { message: "Invalid JSON" } });
    const input = validatePayload(body);
    if (input.error) return response.status(400).json({ error: { message: input.error } });

    let repository;
    try {
      const sql = sqlFactory();
      await schema(sql);
      repository = repositoryFactory(sql);
      if (input.action === "lookup") {
        const resolved = await resolveContact(repository, input.selector);
        if (resolved.type === "resolved") return response.status(200).json({ request_id: input.requestId, found: true, contact: publicContact(resolved.contact), profile: profileState(resolved.contact), follow_up: followUpState(resolved.contact) });
        if (resolved.type === "not_found") return response.status(404).json({ request_id: input.requestId, found: false, error: { message: "Contact not found." } });
        return response.status(409).json({ request_id: input.requestId, error: { message: "Contact selector is ambiguous or conflicting.", candidates: resolved.candidates } });
      }

      const claim = await repository.claim(input.requestId, requestHash(body));
      if (claim.type === "completed") return response.status(200).json(claim.response);
      if (claim.type === "conflict") return response.status(409).json({ error: { message: "request_id was previously used for a different request." } });
      if (claim.type === "in_progress") return response.status(409).json({ error: { message: "This request is still being processed; retry shortly with the same request_id." } });

      const resolved = await resolveContact(repository, input.selector);
      let contact;
      let created = false;
      if (resolved.type === "not_found") {
        if (!input.createIfMissing || !input.create) {
          await repository.fail(input.requestId);
          return response.status(404).json({ error: { message: "Contact not found. Set create_if_missing with a create block to create one." } });
        }
        const record = await repository.create(createPayload(input.create, input.requestId));
        contact = { ...record.data, _recordId: record.id, _syncVersion: record.version };
        created = true;
      } else if (resolved.type !== "resolved") {
        await repository.fail(input.requestId);
        return response.status(409).json({ error: { message: "Contact selector is ambiguous or conflicting.", candidates: resolved.candidates } });
      } else {
        contact = resolved.contact;
      }

      let keptLaterDate = false;
      if (!created) {
        const prior = await repository.findByRequestId(input.requestId);
        if (prior) contact = prior;
        else {
          let attempts = 0;
          while (attempts < 3) {
            const changed = applyChanges(contact, input);
            keptLaterDate = changed.keptLaterDate;
            if (changed.alreadyApplied) break;
            const updated = await repository.update(contact, changed.payload);
            if (["updated", "unchanged"].includes(updated.status)) {
              contact = { ...(updated.data || changed.payload), _recordId: contact._recordId, _syncVersion: updated.version };
              break;
            }
            if (updated.status !== "conflict" || !updated.data) throw new Error("Contact update could not be completed.");
            contact = { ...updated.data, _recordId: contact._recordId, _syncVersion: updated.version };
            attempts += 1;
          }
          if (attempts >= 3) throw new Error("Contact update conflicted repeatedly; retry the same request_id.");
        }
      } else {
        const changes = applyChanges({ ...contact, automationRequestIds: [] }, input);
        const updated = await repository.update(contact, changes.payload);
        if (updated.status !== "updated") throw new Error("Created contact could not be finalized.");
        contact = { ...changes.payload, _recordId: contact._recordId, _syncVersion: updated.version };
        keptLaterDate = changes.keptLaterDate;
      }

      const result = {
        request_id: input.requestId, outcome: created ? "created" : "updated",
        contact: publicContact(contact, created), note_id: null,
        profile: profileState(contact),
        follow_up: followUpState(contact, keptLaterDate)
      };
      await repository.complete(input.requestId, result);
      return response.status(200).json(result);
    } catch (error) {
      if (repository && input.action === "apply") await repository.fail(input.requestId).catch(() => {});
      console.error("Automation contact update failed:", error.message || error);
      return response.status(500).json({ error: { message: "Automation contact update failed." } });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
handler.resolveContact = resolveContact;
handler.createRepository = createRepository;
handler.candidateSummary = candidateSummary;
module.exports = handler;
