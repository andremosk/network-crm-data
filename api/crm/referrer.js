const { hasValidSession } = require('../../lib/crm-auth');
const { getSql } = require('../../lib/crm-db');
const { parseBody } = require('../../lib/text-summaries');
const { shortlist, rank, judge } = require('../../lib/referrer');

async function loadContacts() {
  const sql = getSql();
  const rows = await sql`SELECT record_id, payload FROM crm_records WHERE record_type = 'contact'`;
  return rows.map(row => ({ ...row.payload, id: row.record_id }));
}

function createHandler({ auth = hasValidSession, load = loadContacts, assess = judge } = {}) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    if (!auth(request)) return response.status(401).json({ error: 'Sign in to search your CRM.' });
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return response.status(405).json({ error: 'Method not allowed.' });
    }
    const query = parseBody(request)?.query;
    if (typeof query !== 'string' || !query.trim() || query.length > 600) {
      return response.status(400).json({ error: 'Enter a search of 1 to 600 characters.' });
    }
    try {
      const candidates = shortlist(await load(), query.trim());
      let judgments = [];
      try { judgments = await assess(query.trim(), candidates); } catch { /* Keep CRM-based matches available. */ }
      return response.status(200).json({ results: rank(candidates, judgments, query.trim()), mode: judgments.length ? 'ai' : 'crm' });
    } catch {
      return response.status(503).json({ error: 'Could not search contacts. Try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
