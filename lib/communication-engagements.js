const crypto = require('node:crypto');
const { withDefaults } = require('../engagement-core');
const { sanitizeProposal } = require('./communication-proposals');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function applyEngagement(sql, draft, value) {
  const clean = sanitizeProposal(draft.proposal_type, value);
  const sourceKey = draft.review_context?.messageId || `communication:${draft.id}`;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(draft.occurred_at));
  const note = { id: crypto.randomUUID(), date, html: escapeHtml(clean.note), source: 'email', sourceKey };
  if (!clean.note || (!clean.engagementId && (!clean.title || !clean.organization || !clean.opportunity))) {
    const error = new Error('A note and an existing engagement, or a title, organization and opportunity, are required.'); error.statusCode = 400; throw error;
  }
  if (draft.proposal_type === 'update_engagement' && !clean.engagementId) {
    const error = new Error('Choose an existing engagement.'); error.statusCode = 400; throw error;
  }
  if (clean.engagementId) {
    const rows = await sql`WITH target AS MATERIALIZED (
      SELECT id FROM crm_communication_proposals WHERE id = ${Number(draft.id)} AND status = 'pending' FOR UPDATE
    ), updated AS (
      UPDATE crm_records r SET payload = r.payload || jsonb_build_object(
        'notes', COALESCE(r.payload->'notes', '[]'::jsonb) || ${JSON.stringify([note])}::jsonb,
        'updatedDate', ${date}) || ${JSON.stringify({
          ...(clean.currentState ? { currentState: clean.currentState } : {}),
          ...(clean.opportunity ? { opportunity: clean.opportunity } : {}),
          ...(clean.nextMilestone ? { nextMilestone: clean.nextMilestone } : {}),
          ...(clean.nextMilestoneDate ? { nextMilestoneDate: clean.nextMilestoneDate } : {})
        })}::jsonb,
        version = version + 1, updated_at = NOW()
      FROM target WHERE r.record_type = 'engagement' AND r.record_id = ${clean.engagementId}
        AND COALESCE(r.payload->>'deleted', 'false') <> 'true' AND COALESCE(r.payload->>'archived', 'false') <> 'true'
        AND COALESCE(r.payload->>'status', '') <> 'closed' AND COALESCE(r.payload->>'isGroup', 'false') <> 'true'
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.payload->'notes', '[]'::jsonb)) n WHERE n->>'sourceKey' = ${sourceKey})
      RETURNING r.record_id
    ), applied AS (
      UPDATE crm_communication_proposals SET status = 'applied', reviewed_at = NOW(), proposed = ${JSON.stringify(clean)}::jsonb
      WHERE id IN (SELECT id FROM target) AND EXISTS (SELECT 1 FROM updated) RETURNING id
    ) SELECT record_id AS engagement_id FROM updated`;
    return rows[0]?.engagement_id || null;
  }
  const template = withDefaults({ ...clean, id: '', notes: [note], createdDate: date, updatedDate: date });
  delete template.engagementId;
  const rows = await sql`WITH target AS MATERIALIZED (
    SELECT id FROM crm_communication_proposals WHERE id = ${Number(draft.id)} AND status = 'pending' FOR UPDATE
  ), id_lock AS MATERIALIZED (
    SELECT pg_advisory_xact_lock(hashtextextended('crm-record-id:engagement', 0)) AS held FROM target
  ), next_id AS MATERIALIZED (
    SELECT COALESCE(MAX(record_id::bigint) FILTER (WHERE record_id ~ '^[0-9]+$'), 0) + 1 AS value
    FROM (SELECT record_id FROM crm_records WHERE record_type = 'engagement'
      UNION ALL SELECT record_id FROM crm_deleted_records WHERE record_type = 'engagement') ids CROSS JOIN id_lock
  ), inserted AS (
    INSERT INTO crm_records (record_type, record_id, payload)
    SELECT 'engagement', next_id.value::text, jsonb_set(${JSON.stringify(template)}::jsonb, '{id}', to_jsonb(next_id.value), true)
    FROM target CROSS JOIN next_id
    WHERE NOT EXISTS (SELECT 1 FROM crm_records WHERE record_type = 'engagement'
      AND LOWER(payload->>'organization') = LOWER(${clean.organization})
      AND COALESCE(payload->>'deleted', 'false') <> 'true' AND COALESCE(payload->>'archived', 'false') <> 'true'
      AND COALESCE(payload->>'status', '') <> 'closed')
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify(clean.contactIds)}::jsonb) ids
        WHERE NOT EXISTS (SELECT 1 FROM crm_records WHERE record_type = 'contact' AND record_id = ids.value
          AND COALESCE(payload->>'deleted', 'false') <> 'true' AND COALESCE(payload->>'archived', 'false') <> 'true'))
    RETURNING record_id
  ), applied AS (
    UPDATE crm_communication_proposals SET status = 'applied', reviewed_at = NOW(), proposed = ${JSON.stringify(clean)}::jsonb
    WHERE id IN (SELECT id FROM target) AND EXISTS (SELECT 1 FROM inserted) RETURNING id
  ) SELECT record_id AS engagement_id FROM inserted`;
  return rows[0]?.engagement_id || null;
}

module.exports = { applyEngagement };
