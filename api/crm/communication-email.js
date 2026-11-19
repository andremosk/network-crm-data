const { hasValidSession } = require('../../lib/crm-auth');
const { getSql } = require('../../lib/crm-db');
const { getGmailAccessToken, gmailRequest, textBody, headerMap } = require('../../lib/gmail-review-sync');

async function loadSource(sql, id) {
  const rows = await sql`SELECT source_message_id, review_context FROM crm_communication_proposals
    WHERE id = ${id} AND source = 'email' AND status = 'pending'`;
  return rows[0];
}

async function readMessage(token, id, fetchImpl = fetch) {
  const message = await gmailRequest(token, `/messages/${encodeURIComponent(id)}?format=full`, fetchImpl);
  // Gmail can store a large inline text body separately; do not silently fall back to its snippet.
  async function hydrate(part) {
    if (!part || part.filename) return;
    if (/^text\/(plain|html)$/.test(part.mimeType) && part.body?.attachmentId && !part.body.data) {
      const body = await gmailRequest(token, `/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, fetchImpl);
      part.body.data = body.data;
    }
    for (const child of part.parts || []) await hydrate(child);
  }
  await hydrate(message.payload);
  const headers = headerMap(message.payload?.headers);
  return { subject: headers.subject || '', from: headers.from || '', to: headers.to || '', cc: headers.cc || '',
    receivedAt: new Date(Number(message.internalDate)).toISOString(), body: textBody(message.payload, {includeQuoted:true}) };
}

function createHandler(dependencies = {}) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    if (!(dependencies.auth || hasValidSession)(request)) return response.status(401).json({error:{message:'Unauthorized'}});
    if (request.method !== 'GET') {
      response.setHeader('Allow','GET');
      return response.status(405).json({error:{message:'Method not allowed'}});
    }
    const id = Number(request.query?.proposalId);
    if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({error:{message:'A valid proposal ID is required.'}});
    try {
      const source = await (dependencies.loadSource || loadSource)((dependencies.getSql || getSql)(), id);
      const storedId = source?.source_message_id || '';
      const messageId = source?.review_context?.messageId || (storedId.startsWith('enrichment:') ? storedId.split(':')[1] : storedId);
      if (!source || !/^[a-z0-9_-]{1,256}$/i.test(messageId || '')) {
        return response.status(404).json({error:{message:'Original email is unavailable for this item. Open it in Gmail instead.'}});
      }
      const token = await (dependencies.getAccessToken || getGmailAccessToken)();
      if (!token) return response.status(503).json({error:{message:'Gmail is not connected.'}});
      const email = await (dependencies.readMessage || readMessage)(token, messageId);
      return response.status(200).json({email});
    } catch {
      return response.status(503).json({error:{message:'Could not load the full email. Try again or open it in Gmail.'}});
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.loadSource = loadSource;
module.exports.readMessage = readMessage;
