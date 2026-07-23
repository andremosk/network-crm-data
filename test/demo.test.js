const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

test("public demo is complete, fictional, and self-contained", () => {
  const html = fs.readFileSync("demo/index.html", "utf8");
  const script = fs.readFileSync("demo/app.js", "utf8");
  const styles = fs.readFileSync("demo/styles.css", "utf8");

  new Function(script);
  assert.match(html, /All people and notes are fictional/);
  assert.match(html, /Relationship/);
  assert.match(html, /Client Fit/);
  assert.match(html, /Connector Fit/);
  assert.match(script, /Fictional demo context|fictional demo context/);
  assert.match(script, /Warm reconnection/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.doesNotMatch(script, /\/api\/crm|DATABASE_URL|NETWORK_CRM_AUTOMATION_TOKEN/);
});
