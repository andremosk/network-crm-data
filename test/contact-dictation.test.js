const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(supported = true) {
  let observer, click, recognition;
  const toolbar = { style: {}, append(button, status) { this.button = button; this.status = status; } };
  const editor = {
    textContent: 'Existing note', isConnected: true,
    parentElement: { querySelector: () => toolbar },
    appendChild(node) { this.textContent += node.textContent; },
    dispatchEvent() {}, closest: () => ({ contains: () => true })
  };
  let current = editor;
  class Recognition {
    constructor() { recognition = this; }
    start() {} stop() { this.stopped = true; } abort() { this.aborted = true; }
  }
  const document = {
    body: {},
    getElementById: id => id === 'noteInput' ? current : (current === editor ? toolbar.button : null),
    createElement: () => ({ style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    createTextNode: textContent => ({ textContent }),
    addEventListener: (name, fn) => { click = fn; }
  };
  vm.runInNewContext(fs.readFileSync('contact-dictation.js', 'utf8'), {
    window: { SpeechRecognition: supported ? Recognition : null, confirm: () => true, addEventListener() {} },
    document, Event: class {}, MutationObserver: class { constructor(fn) { observer = fn; } observe() {} }
  });
  return { toolbar, editor, get recognition() { return recognition; }, navigate() { current = null; observer(); }, save() { click({ target: { closest: () => ({ closest: () => null }) } }); } };
}

function result(text, final = true) {
  const item = [{ transcript: text }]; item.isFinal = final;
  return { resultIndex: 0, results: [item] };
}

test('dictation appends plain text, preserves prior text, and deduplicates final results', () => {
  const s = setup(); s.toolbar.button.onclick();
  s.recognition.onresult(result('interim', false));
  assert.equal(s.editor.textContent, 'Existing note');
  s.recognition.onresult(result('<b>Spoken</b>'));
  s.recognition.onresult(result('<b>Spoken</b>'));
  assert.equal(s.editor.textContent, 'Existing note <b>Spoken</b>');
  s.toolbar.button.onclick(); assert.equal(s.recognition.stopped, true);
  s.recognition.onend(); assert.equal(s.toolbar.button.attrs['aria-pressed'], 'false');
});

for (const action of ['navigate', 'save']) test(`${action} cancels and rejects late transcripts`, () => {
  const s = setup(); s.toolbar.button.onclick(); s[action]();
  assert.equal(s.recognition.aborted, true);
  s.recognition.onresult(result('Late transcript'));
  assert.equal(s.editor.textContent, 'Existing note');
});

test('permission errors leave note intact and allow retry', () => {
  const s = setup(); s.toolbar.button.onclick();
  s.recognition.onerror({ error: 'not-allowed' });
  assert.match(s.toolbar.status.textContent, /permission denied/);
  assert.equal(s.editor.textContent, 'Existing note');
  s.toolbar.button.onclick(); assert.equal(s.toolbar.button.attrs['aria-pressed'], 'true');
});

test('unsupported browsers offer keyboard dictation fallback', () => {
  const s = setup(false); s.toolbar.button.onclick();
  assert.match(s.toolbar.status.textContent, /keyboard microphone/);
});
