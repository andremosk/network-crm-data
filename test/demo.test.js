const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

test("public demo is generated from the real app without private data or services", () => {
  const source = fs.readFileSync("index.html", "utf8");
  const html = fs.readFileSync("demo/index.html", "utf8");
  const script = fs.readFileSync("demo/demo-overrides.js", "utf8");

  new Function(script);
  assert.match(source, /class="detail-panel" id="detailPanel"/);
  assert.match(html, /class="detail-panel" id="detailPanel"/);
  assert.match(source, /class="rich-field add-note-field" id="noteInput"/);
  assert.match(html, /class="rich-field add-note-field" id="noteInput"/);
  assert.match(html, /All people, companies, and notes are fictional/);
  assert.match(html, /Relationship/);
  assert.match(html, /Client Fit/);
  assert.match(html, /Connector Fit/);
  assert.match(script, /Fictional demo contact/);
  assert.match(script, /Would love to reconnect/);
  assert.doesNotMatch(html, /Freek Tanis|Arthur Eddy|Andre\.Moskowitz@gmail\.com/);
  assert.doesNotMatch(html, /text-summary-review\.js|cloud-sync\.js|DATABASE_URL|NETWORK_CRM_AUTOMATION_TOKEN/);
});
