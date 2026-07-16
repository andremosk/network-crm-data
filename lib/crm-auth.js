const crypto = require("crypto");

const COOKIE_NAME = "network_crm_session";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;

function getSecret() {
  return process.env.NETWORK_CRM_AUTOMATION_TOKEN || "";
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSessionCookie() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_AGE_SECONDS;
  const value = `${expires}.${sign(String(expires))}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_AGE_SECONDS}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function parseCookies(request) {
  return String(request.headers?.cookie || "")
    .split(";")
    .map((part) => part.trim().split("="))
    .reduce((cookies, [key, ...value]) => {
      if (key) cookies[key] = value.join("=");
      return cookies;
    }, {});
}

function hasValidSession(request) {
  const secret = getSecret();
  if (!secret) return false;
  const value = parseCookies(request)[COOKIE_NAME] || "";
  const [expiresText, signature] = value.split(".");
  const expires = Number(expiresText);
  if (!expires || expires < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signature, sign(expiresText));
}

function tokenIsValid(token) {
  const secret = getSecret();
  return !!secret && safeEqual(token, secret);
}

module.exports = {
  clearSessionCookie,
  createSessionCookie,
  hasValidSession,
  tokenIsValid
};
