const {
  clearSessionCookie,
  createSessionCookie,
  hasValidSession,
  tokenIsValid
} = require("../../lib/crm-auth");

module.exports = async function handler(request, response) {
  if (request.method === "GET") {
    return response.status(hasValidSession(request) ? 200 : 401).json({ authenticated: hasValidSession(request) });
  }
  if (request.method === "DELETE") {
    response.setHeader("Set-Cookie", clearSessionCookie());
    return response.status(200).json({ authenticated: false });
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, DELETE");
    return response.status(405).json({ error: { message: "Method not allowed" } });
  }
  const token = request.body?.token || "";
  if (!tokenIsValid(token)) {
    return response.status(401).json({ error: { message: "That access key is not valid." } });
  }
  response.setHeader("Set-Cookie", createSessionCookie());
  return response.status(200).json({ authenticated: true });
};
