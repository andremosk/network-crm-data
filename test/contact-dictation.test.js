const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(supported = true, fetcher = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '- Personal detail\n- Next steps: call Friday' }] }) })) {
  let observer, click, recognition;
  const toolbar = { style: {}, append(button, status) { if (status) { this.button = button; this.status = status; } else this.summarize = button; } };
  let preview;
  const editor = {
    textContent: 'Existing note', innerHTML: 'Existing note', isConnected: true,
    parentElement: { querySelector: () => toolbar, append(node) { preview = node; } },
    appendChild(node) { this.textContent += node.textContent || ''; this.innerHTML += node.textContent || ''; },
    replaceChildren() { this.textContent = ''; this.innerHTML = ''; },
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
    createElement: () => ({ style: {}, attrs: {}, children: [], append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; }, setAttribute(k, v) { this.attrs[k] = v; } }),
    createTextNode: textContent => ({ textContent }),
    addEventListener: (name, fn) => { click = fn; }
  };
  vm.runInNewContext(fs.readFileSync('contact-dictation.js', 'utf8'), {
    window: { SpeechRecognition: supported ? Recognition : null, confirm: () => true, addEventListener() {} },
    document, fetch: fetcher, AbortController, setTimeout, clearTimeout,
    Event: class {}, MutationObserver: class { constructor(fn) { observer = fn; } observe() {} }
  });
  return { toolbar, editor, get preview() { return preview; }, get recognition() { return recognition; }, navigate() { current = null; observer(); }, save() { click({ target: { closest: () => ({ closest: () => null }) } }); } };
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

test('summary is previewed without changing draft; apply and restore are explicit', async () => {
  const s = setup();
  await s.toolbar.summarize.onclick();
  assert.equal(s.editor.innerHTML, 'Existing note');
  assert.equal(s.preview.hidden, false);
  assert.match(s.preview.children[0].textContent, /Next steps/);
  s.preview.children[1].onclick();
  assert.match(s.editor.textContent, /Personal detail/);
  s.preview.children[0].onclick();
  assert.equal(s.editor.innerHTML, 'Existing note');
});

test('provider failure preserves raw draft', async () => {
  const s = setup(true, async () => { throw new Error('offline'); });
  await s.toolbar.summarize.onclick();
  assert.equal(s.editor.innerHTML, 'Existing note');
  assert.match(s.toolbar.status.textContent, /raw draft is unchanged/);
  assert.equal(s.toolbar.summarize.disabled, false);
});

for (const action of ['edit', 'navigate']) test(`summary ignores stale response after ${action}`, async () => {
  let resolve;
  const s = setup(true, () => new Promise(r => { resolve = r; }));
  const pending = s.toolbar.summarize.onclick();
  if (action === 'edit') s.editor.innerHTML = 'New draft';
  else s.navigate();
  resolve({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Stale summary' }] }) });
  await pending;
  assert.equal(s.preview.hidden, true);
  assert.notEqual(s.editor.innerHTML, 'Stale summary');
});

test('active recording cannot be summarized', async () => {
  const s = setup(); s.toolbar.button.onclick();
  await s.toolbar.summarize.onclick();
  assert.match(s.toolbar.status.textContent, /Stop dictation/);
});

test('apply refuses to overwrite edits made after preview', async () => {
  const s = setup(); await s.toolbar.summarize.onclick();
  s.editor.innerHTML = 'My new text';
  s.preview.children[1].onclick();
  assert.equal(s.editor.innerHTML, 'My new text');
});

test('sends only draft text using the existing server provider configuration', async () => {
  let payload;
  const s = setup(true, async (url, options) => {
    assert.equal(url, '/api/coach');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-api-key'], undefined);
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: '<script>not HTML</script>' }] }) };
  });
  await s.toolbar.summarize.onclick();
  assert.equal(payload.messages[0].content, 'Existing note');
  assert.match(payload.system, /Do not invent/);
  assert.equal(s.preview.children[0].textContent, '<script>not HTML</script>');
});

for (const data of [{ error: { message: 'no key' } }, { content: [] }, { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Cut off' }] }]) {
  test(`rejects unsuccessful provider output ${JSON.stringify(data)}`, async () => {
    const s = setup(true, async () => ({ ok: true, json: async () => data }));
    await s.toolbar.summarize.onclick();
    assert.equal(s.editor.innerHTML, 'Existing note');
    assert.equal(s.preview.hidden, true);
    assert.match(s.toolbar.status.textContent, /Could not summarize/);
  });
}
