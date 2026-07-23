const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../api/gmail/drafts");

test("makes reconnect footer links clickable in Gmail drafts", () => {
  const html = handler.bodyToHtml("Website: https://andremosk.com\nCalendly: https://calendly.com/andre-moskowitz/30min");
  assert.match(html, /<a href="https:\/\/andremosk\.com">Website<\/a>/);
  assert.match(html, /<a href="https:\/\/calendly\.com\/andre-moskowitz\/30min">Calendly<\/a>/);
});

test("rejects unauthenticated Gmail draft creation", async () => {
  const original = process.env.NETWORK_CRM_AUTOMATION_TOKEN;
  delete process.env.NETWORK_CRM_AUTOMATION_TOKEN;
  let statusCode;
  await handler({ method:"POST", headers:{}, body:{} }, { status(code){statusCode=code;return this;}, json(body){return body;}, setHeader(){} });
  if (original) process.env.NETWORK_CRM_AUTOMATION_TOKEN = original;
  assert.equal(statusCode, 401);
});
