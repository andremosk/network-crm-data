const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../api/gmail/drafts");

test("turns website and Calendly signature lines into clickable links", () => {
  const html = handler.bodyToHtml("Best Regards,\nAndre\nWebsite: https://andremosk.com\nCalendly: https://calendly.com/andre-moskowitz/30min");
  assert.match(html, /<a href="https:\/\/andremosk\.com">Website<\/a>/);
  assert.match(html, /<a href="https:\/\/calendly\.com\/andre-moskowitz\/30min">Calendly<\/a>/);
});

test("creates an HTML MIME draft with the selected sender", () => {
  const raw = handler.rawMessage({
    from: "andre@andremosk.com",
    to: "person@example.com",
    subject: "Checking in",
    html: "Hey there",
    signature: "Andre"
  });
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(mime, /^From: andre@andremosk\.com/m);
  assert.match(mime, /Content-Type: text\/html/);
});

test("rejects unauthenticated Gmail draft requests before external access", async () => {
  const original = process.env.NETWORK_CRM_AUTOMATION_TOKEN;
  delete process.env.NETWORK_CRM_AUTOMATION_TOKEN;
  let statusCode;
  let payload;
  await handler({ method: "POST", headers: {}, body: {} }, {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return body; },
    setHeader() {}
  });
  if (original) process.env.NETWORK_CRM_AUTOMATION_TOKEN = original;
  assert.equal(statusCode, 401);
  assert.equal(payload.error.message, "Unauthorized");
});
