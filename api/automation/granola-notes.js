const { ensureSchema, getSql } = require("../../lib/crm-db");
const { tokenIsValid } = require("../../lib/crm-auth");
const { getBearerToken, parseBody, validDate } = require("../../lib/text-summaries");
const {
  cleanSummary,
  matchContact,
  sourceKeyForMeeting,
  summaryHtml
} = require("../../lib/granola-notes");

function noteDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

async function loadContacts(sql) {
  const rows = await sql`
    SELECT record_id, payload
    FROM crm_records
    WHERE record_type = 'contact'
      AND COALESCE((payload->>'deleted')::boolean, false) = false
      AND COALESCE((payload->>'archived')::boolean, false) = false
  `;
  return rows.map((row) => ({ ...row.payload, id: row.payload.id ?? row.record_id }));
}

async function findImport(sql, sourceKey) {
  const rows = await sql`
    SELECT status, contact_id FROM crm_granola_note_imports
    WHERE source_key = ${sourceKey}
  `;
  return rows[0] || null;
}

async function recordReview(sql, input, sourceKey, result) {
  await sql`
    INSERT INTO crm_granola_note_imports (
      source_key, meeting_id, participant_label, meeting_at, summary,
      status, match_method, match_score
    ) VALUES (
      ${sourceKey}, ${input.meetingId}, ${input.participant.name || input.participant.email},
      ${input.meetingAt.toISOString()}, ${input.summary}, 'review_required',
      ${result.candidates[0]?.method || null}, ${result.candidates[0]?.score || 0}
    )
    ON CONFLICT (source_key) DO UPDATE
    SET participant_label = EXCLUDED.participant_label,
        meeting_at = EXCLUDED.meeting_at,
        summary = EXCLUDED.summary,
        match_method = EXCLUDED.match_method,
        match_score = EXCLUDED.match_score,
        updated_at = NOW()
    WHERE crm_granola_note_imports.status = 'review_required'
  `;
}

async function importNote(sql, input, sourceKey, result) {
  const contactId = String(result.match.id);
  const existing = await sql`
    SELECT source_key FROM crm_granola_note_imports
    WHERE meeting_id = ${input.meetingId}
      AND contact_id = ${contactId}
      AND status = 'imported'
  `;
  if (existing.length) return false;

  const entry = `${noteDate(input.meetingAt)}: <strong>Granola meeting</strong><br>${summaryHtml(input.summary)}`;
  const contactDate = input.meetingAt.toISOString().slice(0, 10);
  const rows = await sql`
    WITH claimed_import AS (
      INSERT INTO crm_granola_note_imports (
        source_key, meeting_id, contact_id, participant_label, meeting_at,
        summary, status, match_method, match_score
      ) VALUES (
        ${sourceKey}, ${input.meetingId}, ${contactId},
        ${input.participant.name || input.participant.email}, ${input.meetingAt.toISOString()},
        ${input.summary}, 'imported', ${result.method}, ${result.score}
      )
      ON CONFLICT (source_key) DO UPDATE
      SET contact_id = EXCLUDED.contact_id,
          status = 'imported',
          match_method = EXCLUDED.match_method,
          match_score = EXCLUDED.match_score,
          updated_at = NOW()
      WHERE crm_granola_note_imports.status = 'review_required'
      RETURNING contact_id
    ), updated_contact AS (
      UPDATE crm_records
      SET payload = jsonb_set(
            jsonb_set(
              payload,
              '{notes}',
              to_jsonb(CASE
                WHEN COALESCE(payload->>'notes', '') = '' THEN ${entry}
                ELSE (payload->>'notes') || E'\n' || ${entry}
              END)
            ),
            '{lastContact}',
            to_jsonb(CASE
              WHEN COALESCE(payload->>'lastContact', '') > ${contactDate} THEN payload->>'lastContact'
              ELSE ${contactDate}
            END)
          ),
          version = version + 1,
          updated_at = NOW()
      FROM claimed_import
      WHERE record_type = 'contact' AND record_id = claimed_import.contact_id
      RETURNING record_id
    )
    SELECT record_id FROM updated_contact
  `;
  return rows.length > 0;
}

function parseInput(request) {
  const body = parseBody(request);
  const meetingId = String(body?.meetingId || "").trim().slice(0, 200);
  const meetingAt = validDate(body?.meetingAt);
  const participant = {
    name: String(body?.participant?.name || "").trim().slice(0, 200),
    email: String(body?.participant?.email || "").trim().slice(0, 320),
    company: String(body?.participant?.company || "").trim().slice(0, 200)
  };
  const meetingTitle = String(body?.meetingTitle || "").trim().slice(0, 300);
  const summary = cleanSummary(body?.summary);
  if (!meetingId || !meetingAt || (!participant.name && !participant.email) || !summary) return null;
  return { meetingId, meetingAt, meetingTitle, participant, summary };
}

function createHandler(dependencies = {}) {
  const getSqlFn = dependencies.getSql || getSql;
  const ensureSchemaFn = dependencies.ensureSchema || ensureSchema;
  const loadContactsFn = dependencies.loadContacts || loadContacts;
  const findImportFn = dependencies.findImport || findImport;
  const recordReviewFn = dependencies.recordReview || recordReview;
  const importNoteFn = dependencies.importNote || importNote;

  return async function handler(request, response) {
    response.setHeader("Cache-Control", "private, no-store");
    if (!tokenIsValid(getBearerToken(request))) {
      return response.status(401).json({ error: { message: "Unauthorized" } });
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }

    const input = parseInput(request);
    if (!input) return response.status(400).json({ error: { message: "Missing or invalid Granola note fields." } });

    try {
      const sql = getSqlFn();
      await ensureSchemaFn(sql);
      const sourceKey = sourceKeyForMeeting(input.meetingId, input.participant);
      const previous = await findImportFn(sql, sourceKey);
      if (previous?.status === "imported") {
        return response.status(200).json({ status: "duplicate", contactId: previous.contact_id });
      }

      const contacts = await loadContactsFn(sql);
      const result = matchContact(contacts, input.participant, input.meetingTitle);
      if (!result.match) {
        await recordReviewFn(sql, input, sourceKey, result);
        return response.status(202).json({ status: "review_required", candidates: result.candidates });
      }

      const imported = await importNoteFn(sql, input, sourceKey, result);
      return response.status(200).json(imported
        ? { status: "imported", contactId: String(result.match.id), matchMethod: result.method, matchScore: result.score }
        : { status: "duplicate", contactId: String(result.match.id) });
    } catch (error) {
      console.error("Granola note import error:", error);
      return response.status(500).json({ error: { message: "Could not import the Granola note." } });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.parseInput = parseInput;
