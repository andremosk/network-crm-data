const { messagesTokenIsValid } = require("../../lib/crm-auth");
const { ensureSchema, getSql } = require("../../lib/crm-db");
const { getBearerToken, parseBody } = require("../../lib/text-summaries");
const { runGmailEmailEnrichment } = require("../../lib/gmail-review-sync");

function createHandler(dependencies = {}) {
  const auth = dependencies.auth || messagesTokenIsValid;
  const sqlFactory = dependencies.getSql || getSql;
  const schema = dependencies.ensureSchema || ensureSchema;
  const enrich = dependencies.runEnrichment || runGmailEmailEnrichment;
  return async function handler(request, response) {
    if (!auth(getBearerToken(request))) return response.status(401).json({ error: { message: "Unauthorized" } });
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }
    try {
      const sql = sqlFactory();
      await schema(sql);
      const body = parseBody(request);
      if (body?.mode && !['recent', 'archive'].includes(body.mode)) return response.status(400).json({ error: { message: 'Invalid enrichment mode.' } });
      return response.status(200).json({ status: "completed", ...await enrich({ sql, recent: body?.mode === 'recent' }) });
    } catch (error) {
      console.error("Automated Gmail email enrichment error:", error);
      return response.status(503).json({ error: { message: error.message || "Email enrichment failed." } });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
