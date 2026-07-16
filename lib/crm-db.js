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
}

function cleanPayload(value) {
  const payload = { ...(value || {}) };
  delete payload._syncVersion;
  delete payload._syncUpdatedAt;
  return payload;
}

module.exports = { cleanPayload, ensureSchema, getSql };
