const { hasValidSession } = require("../../lib/crm-auth");

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function bodyToHtml(body) {
  return String(body || "").split(/\r?\n/).map((line) => {
    const link = line.match(/^\s*(Website|Calendly):\s*(https:\/\/\S+)\s*$/i);
    if (link) return `<a href="${escapeHtml(link[2])}">${escapeHtml(link[1])}</a>`;
    return escapeHtml(line).replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
  }).join("<br>");
}

function rawMessage(to, subject, html) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const mime = [
    "From: andre.moskowitz@gmail.com",
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf8").toString("base64")
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

async function getAccessToken() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Could not connect to Gmail");
  return data.access_token;
}

module.exports = async function handler(request, response) {
  if (!hasValidSession(request)) return response.status(401).json({ error: { message: "Unauthorized" } });
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: { message: "Method not allowed" } });
  }
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const to = String(body.to || "").trim();
    const subject = String(body.subject || "").trim().slice(0, 200);
    const message = String(body.body || "").trim().slice(0, 20000);
    if (!/^\S+@\S+\.\S+$/.test(to) || !subject || !message) {
      return response.status(400).json({ error: { message: "Recipient, subject, and message are required." } });
    }
    const token = await getAccessToken();
    if (!token) return response.status(503).json({ error: { message: "Gmail connection is not configured yet." } });
    const gmailResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw: rawMessage(to, subject, bodyToHtml(message)) } })
    });
    const draft = await gmailResponse.json();
    if (!gmailResponse.ok) throw new Error(draft.error?.message || "Gmail could not create the draft");
    return response.status(201).json({ id: draft.id, status: "drafted" });
  } catch (error) {
    console.error("Gmail draft error:", error);
    return response.status(500).json({ error: { message: error.message || "Could not create Gmail draft." } });
  }
};

module.exports.bodyToHtml = bodyToHtml;
