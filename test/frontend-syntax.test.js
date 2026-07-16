const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

for (const file of ["index.html", "index2.html"]) {
  test(`${file} inline scripts parse`, () => {
    const source = fs.readFileSync(file, "utf8");
    const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0);
    for (const script of scripts) new Function(script[1]);
  });
}

test("cloud sync client parses", () => {
  new Function(fs.readFileSync("cloud-sync.js", "utf8"));
});

test("text summary review client parses", () => {
  new Function(fs.readFileSync("text-summary-review.js", "utf8"));
});
