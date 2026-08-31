const { messagesTokenIsValid } = require("../../lib/crm-auth");
const { ensureSchema, getSql } = require("../../lib/crm-db");
const { getBearerToken } = require("../../lib/text-summaries");
const { runGmailReviewSync } = require("../../lib/gmail-review-sync");

function createHandler(dependencies = {}) {
  const auth = dependencies.auth || messagesTokenIsValid;
  const sqlFactory = dependencies.getSql || getSql;
  const schema = dependencies.ensureSchema || ensureSchema;
  const sync = dependencies.runSync || runGmailReviewSync;
  return async function handler(request, response) {
    if (!auth(getBearerToken(request))) return response.status(401).json({ error: { message: "Unauthorized" } });
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return response.status(405).json({ error: { message: "Method not allowed" } });
    }
    try {
      const sql = sqlFactory();
      await schema(sql);
      const result = await sync({ sql });
      return response.status(200).json({ status: "completed", ...result });
    } catch (error) {
      console.error("Automated Gmail review sync error:", error);
      return response.status(503).json({ error: { message: error.message || "Gmail review sync failed." } });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
