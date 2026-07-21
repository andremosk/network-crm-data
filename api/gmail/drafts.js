const { hasValidSession } = require("../../lib/crm-auth");

const ALLOWED_SENDERS = new Set([
  "andre.moskowitz@gmail.com",
  "andre@andremosk.com"
]);

function parseBody(request) {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bodyToHtml(body) {
  return String(body || "").split(/\r?\n/).map((line) => {
    const link = line.match(/^\s*(Website|Calendly):\s*(https:\/\/\S+)\s*$/i);
    if (link) return `<a href="${escapeHtml(link[2])}">${escapeHtml(link[1])}</a>`;
    return escapeHtml(line).replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);
  }).join("<br>");
}

function encodeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function rawMessage({ from, to, subject, html, signature }) {
  const content = signature ? `${html}<br><br>${signature}` : html;
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(content, "utf8").toString("base64")
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64url");
}

async function gmailFetch(path, accessToken, options = {}) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gmail request failed (${response.status})`);
  return data;
}

async function accessToken() {
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
    const body = parseBody(request);
    const from = String(body.from || "").trim().toLowerCase();
    const to = String(body.to || "").trim();
    const subject = String(body.subject || "").trim().slice(0, 200);
    const message = String(body.body || "").trim().slice(0, 20000);
    if (!ALLOWED_SENDERS.has(from) || !/^\S+@\S+\.\S+$/.test(to) || !subject || !message) {
      return response.status(400).json({ error: { message: "From, recipient, subject, and message are required." } });
    }
    const token = await accessToken();
    if (!token) return response.status(503).json({ error: { message: "Gmail connection is not configured yet." } });
    const settings = await gmailFetch("/settings/sendAs", token);
    const identity = (settings.sendAs || []).find((item) => String(item.sendAsEmail).toLowerCase() === from);
    if (!identity || identity.verificationStatus !== "accepted") {
      return response.status(400).json({ error: { message: `${from} is not an approved Gmail sending address.` } });
    }
    const draft = await gmailFetch("/drafts", token, {
      method: "POST",
      body: JSON.stringify({ message: { raw: rawMessage({ from: identity.sendAsEmail, to, subject, html: bodyToHtml(message), signature: identity.signature || "" }) } })
    });
    const account = encodeURIComponent(process.env.GOOGLE_GMAIL_ACCOUNT_INDEX || "0");
    return response.status(201).json({ id: draft.id, url: `https://mail.google.com/mail/u/${account}/#drafts/${encodeURIComponent(draft.id)}` });
  } catch (error) {
    console.error("Gmail draft error:", error);
    return response.status(500).json({ error: { message: error.message || "Could not create Gmail draft." } });
  }
};

module.exports.bodyToHtml = bodyToHtml;
module.exports.rawMessage = rawMessage;
