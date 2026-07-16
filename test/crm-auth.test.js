const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NETWORK_CRM_AUTOMATION_TOKEN = "test-private-token";
const auth = require("../lib/crm-auth");

test("accepts only the configured access token", () => {
  assert.equal(auth.tokenIsValid("test-private-token"), true);
  assert.equal(auth.tokenIsValid("wrong-token"), false);
  assert.equal(auth.tokenIsValid(""), false);
});

test("accepts a separate Messages-only token without changing the main token", () => {
  process.env.NETWORK_CRM_MESSAGES_TOKEN = "test-messages-token";
  assert.equal(auth.messagesTokenIsValid("test-messages-token"), true);
  assert.equal(auth.messagesTokenIsValid("test-private-token"), true);
  assert.equal(auth.messagesTokenIsValid("wrong-token"), false);
});

test("creates and validates an HTTP-only session cookie", () => {
  const cookie = auth.createSessionCookie();
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  const request = { headers: { cookie: cookie.split(";")[0] } };
  assert.equal(auth.hasValidSession(request), true);
});

test("rejects a tampered session cookie", () => {
  const cookie = auth.createSessionCookie().split(";")[0];
  const request = { headers: { cookie: `${cookie}tampered` } };
  assert.equal(auth.hasValidSession(request), false);
});
