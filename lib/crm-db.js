const { neon } = require("@neondatabase/serverless");

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  return neon(process.env.DATABASE_URL);
}

async function ensureSchema(sql = getSql()) {
  await sql`
    CREATE TABLE IF NOT EXISTS crm_records (
      record_type TEXT NOT NULL CHECK (record_type IN ('contact', 'application')),
      record_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      version BIGINT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (record_type, record_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS crm_records_updated_at_idx ON crm_records (updated_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS crm_text_summaries (
      id BIGSERIAL PRIMARY KEY,
      contact_id TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
      conversation_started_at TIMESTAMPTZ NOT NULL,
      conversation_ended_at TIMESTAMPTZ NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS crm_text_summaries_contact_status_idx ON crm_text_summaries (contact_id, status, conversation_ended_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS crm_text_conversations (
      conversation_key TEXT PRIMARY KEY,
      participant_label TEXT NOT NULL,
      latest_message_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'dismissed', 'ignored')),
      contact_id TEXT,
      reviewed_message_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS crm_text_conversations_status_idx ON crm_text_conversations (status, latest_message_at DESC)`;
}

function cleanPayload(value) {
  const payload = { ...(value || {}) };
  delete payload._syncVersion;
  delete payload._syncUpdatedAt;
  return payload;
}

module.exports = { cleanPayload, ensureSchema, getSql };
