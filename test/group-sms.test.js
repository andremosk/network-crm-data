const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ingest = require('../api/automation/text-summaries');
const review = require('../api/crm/text-summaries');
const { summarizeTranscript } = require('../lib/text-summaries');
const group = { isGroup: true, threadKey: 'a'.repeat(64), title: 'Mike & Samantha', participants: ['Samantha Example'] };
const payload = { isGroup: true, threadKey: group.threadKey, threadTitle: group.title, participants: group.participants,
  sourceKey: 'synthetic-group-exchange', startedAt: '2026-10-27T17:55:00Z', endedAt: '2026-10-27T17:59:00Z',
  messageCount: 2, transcript: 'Andre: Can you connect me to the product manager?\nSamantha Example: I will reach out to him.' };
function response() {
  return { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function fixture(factory, results, dependencies = {}) {
  const calls = [];
  const handler = factory({ auth: () => true, ensureSchema: async () => {}, getSql: () => async (strings, ...values) => {
    calls.push({ query: strings.join('?'), values }); return results.shift() || [];
  }, ...dependencies });
  return { handler, calls };
}

test('group ingestion queues an unassigned summary with speakers; never edits contacts', async () => {
  let summarized;
  const {handler, calls} = fixture(ingest.createHandler, [[], [{id: '91'}]], {summarizeTranscript: async args => {
    summarized = args; return 'Samantha agreed to ask about an introduction.';
  }});
  const res = response();
  await handler({method: 'POST', body: payload}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'pending');
  assert.equal(summarized.group.title, group.title);
  assert.equal(summarized.engagement, undefined);
  assert.equal(calls[1].values[0], null);
  assert.deepEqual(JSON.parse(calls[1].values.at(-1)), group);
  assert.ok(calls.every(call => !/UPDATE crm_records|INSERT INTO crm_records/.test(call.query)));
});

test('group ingestion dedupes before summarizing and preserves skip decisions', async () => {
  const duplicate = fixture(ingest.createHandler, [[{id: '91'}]], {summarizeTranscript: () => { throw Error('Must not call'); }});
  const res = response();
  await duplicate.handler({method: 'POST', body: payload}, res);
  assert.equal(res.body.status, 'duplicate');
  const skip = fixture(ingest.createHandler, [[]], {summarizeTranscript: async () => 'SKIP'});
  const skipped = response();
  await skip.handler({method: 'POST', body: payload}, skipped);
  assert.equal(skipped.body.status, 'skipped');
  assert.equal(skip.calls.length, 1);
});

test('group input cannot auto-assign a contact or omit identity', async () => {
  for (const body of [{...payload, contactId: '789'}, {...payload, threadKey: ''}, {...payload, participants: []}]) {
    const {handler, calls} = fixture(ingest.createHandler, []);
    const res = response(); await handler({method: 'POST', body}, res);
    assert.equal(res.statusCode, 400); assert.equal(calls.length, 0);
  }
});

const draft = {contact_id: null, conversation_ended_at: payload.endedAt, source_key: 'source', conversation_context: group};
test('group approval requires explicit destination; unavailable contact is not claimed', async () => {
  const missing = fixture(review.createHandler, [[draft]]);
  const res = response(); await missing.handler({method: 'PATCH', body: {id: 91, action: 'approve', summary: 'Test'}}, res);
  assert.equal(res.statusCode, 400); assert.equal(missing.calls.length, 1);
  const unavailable = fixture(review.createHandler, [[draft], []]);
  const conflict = response(); await unavailable.handler({method: 'PATCH', body: {id: 91, action: 'approve', summary: 'Test', contactId: 'missing'}}, conflict);
  assert.equal(conflict.statusCode, 409);
  assert.match(unavailable.calls[1].query, /status = 'pending' AND EXISTS \(SELECT 1 FROM target\)/);
  assert.match(unavailable.calls[1].query, /archived/);
});

test('group approval can save once to the selected contact, not every participant', async () => {
  const {handler, calls} = fixture(review.createHandler, [[draft], [{contact_id: '789'}]]);
  const res = response(); await handler({method: 'PATCH', body: {id: 91, action: 'approve', summary: 'Samantha agreed to reach out.', contactId: '789'}}, res);
  assert.equal(res.body.contactId, '789');
  assert.match(calls[1].query, /FOR UPDATE/);
  assert.match(calls[1].query, /record_id = claimed_summary.contact_id/);
  assert.ok(calls[1].values.includes('789'));
});

test('group approval can save to an engagement without inventing a contact', async () => {
  const {handler, calls} = fixture(review.createHandler, [[draft], [], [{engagement_id: '5'}]]);
  const res = response(); await handler({method: 'PATCH', body: {id: 91, action: 'approve', summary: 'Samantha agreed to reach out.', engagementId: '5'}}, res);
  assert.equal(res.body.engagementId, '5');
  const note = JSON.parse(calls[2].values.find(value => typeof value === 'string' && value.startsWith('[{')))[0];
  assert.equal(note.contactId, undefined);
  assert.match(note.html, /Mike &amp; Samantha/);
  assert.doesNotMatch(calls[2].query, /updated_contact/);
});

test('group prompt preserves attribution and still rejects routine sports logistics', async t => {
  const originalFetch = global.fetch, originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-only';
  t.after(() => { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey; });
  global.fetch = async (_, options) => {
    const prompt = JSON.parse(options.body).messages[0].content;
    assert.match(prompt, /private group text/);
    assert.match(prompt, /actual named speaker/);
    assert.match(prompt, /Routine Little League/);
    return {ok: true, json: async () => ({content: [{text: 'Samantha agreed to reach out.'}]})};
  };
  await summarizeTranscript({contactName: group.title, transcript: payload.transcript, startedAt: new Date(payload.startedAt), endedAt: new Date(payload.endedAt), group});
});

test('review UI renders group metadata, requires a contact, and sends explicit selection', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {value: '', innerHTML: '', classList: {contains: () => id === 'textReviewModal', toggle() {}, add() {}, remove() {}}});
    return elements.get(id);
  }
  const posts = [], notices = [];
  const context = {console, contacts: [{id: 789, name: 'Michael Example'}], document: {getElementById: id => id === 'engagementSmsReview' ? null : element(id)},
    localStorage: {getItem: () => '[]', setItem() {}}, window: {toast: text => notices.push(text)},
    fetch: async (url, options) => {
      if (options?.method === 'PATCH') { posts.push(JSON.parse(options.body)); return {ok: true, json: async () => ({status: 'approved', contactId: '789'})}; }
      return {ok: true, json: async () => url.includes('communication-proposals') ? {proposals: []} : {summaries: [{id: 91, ...draft, summary: 'Samantha agreed.'}], conversations: [], engagements: []}};
    }};
  vm.runInNewContext(fs.readFileSync('text-summary-review.js', 'utf8'), context);
  await context.window.loadTextSummaries();
  assert.match(element('textReviewContent').innerHTML, /Group SMS/);
  assert.match(element('textReviewContent').innerHTML, /Mike &amp; Samantha/);
  element('textReviewSummary_91').value = 'Samantha agreed.';
  await context.window.approveTextSummary(91, 'null');
  assert.equal(posts.length, 0);
  element('groupContact_91').value = 'Michael Example [789]';
  await context.window.approveTextSummary(91, 'null');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].contactId, 789);
});
