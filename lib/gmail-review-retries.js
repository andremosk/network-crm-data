async function loadRetries(sql, mailbox, now) {
  return sql`SELECT message_id AS id, next_attempt_at FROM crm_gmail_review_retries
    WHERE mailbox_email = ${mailbox} ORDER BY next_attempt_at LIMIT 250`;
}

async function deferReview(sql, mailbox, id) {
  await sql`INSERT INTO crm_gmail_review_retries (mailbox_email, message_id, attempts, next_attempt_at)
    VALUES (${mailbox}, ${id}, 1, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (mailbox_email, message_id) DO UPDATE SET
      attempts = crm_gmail_review_retries.attempts + 1,
      next_attempt_at = NOW() + CASE
        WHEN crm_gmail_review_retries.attempts = 1 THEN INTERVAL '1 hour'
        WHEN crm_gmail_review_retries.attempts = 2 THEN INTERVAL '6 hours'
        ELSE INTERVAL '24 hours' END`;
}

async function clearRetry(sql, mailbox, id) {
  await sql`DELETE FROM crm_gmail_review_retries WHERE mailbox_email = ${mailbox} AND message_id = ${id}`;
}

async function retryCount(sql, mailbox) {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM crm_gmail_review_retries WHERE mailbox_email = ${mailbox}`;
  return Number(rows[0]?.count || 0);
}

module.exports = { loadRetries, deferReview, clearRetry, retryCount };
