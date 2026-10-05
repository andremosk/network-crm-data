const assert = require('node:assert/strict');
const test = require('node:test');
const { suggestEngagement, relatedEngagements } = require('../lib/sms-routing');
const { withDefaults } = require('../engagement-core');
const endpoint = require('../api/crm/text-summaries');
const { summarizeTranscript } = require('../lib/text-summaries');

const contact = { id: 459, name: 'Mike Example', company: 'Belmont Metals Inc.' };
const engagement = { id: 1, title: 'Belmont Metals', organization: 'Belmont Metals',
  status: 'active_client', contactIds: [459] };

test('work texts suggest linked engagement; personal exchanges stay with contact', () => {
  assert.equal(suggestEngagement(contact, 'Wait for BC Cloud before the AR/AP dashboard.', [engagement]), '1');
  assert.equal(suggestEngagement(contact, 'His daughter started college; enjoyed catching up.', [engagement]), null);
  assert.equal(suggestEngagement(contact, 'Discuss the prototype.', [{ ...engagement, contactIds: [] }]), '1');
  assert.equal(suggestEngagement({ id: 2, company: 'Other' }, 'Discuss prototype.', [engagement]), null);
});

test('ambiguous and inactive engagements are not suggested', () => {
  for (const status of ['closed', 'on_hold']) {
    assert.equal(suggestEngagement(contact, 'Discuss prototype.', [{ ...engagement, status }]), null);
  }
  for (const flag of ['deleted', 'archived']) {
    assert.deepEqual(relatedEngagements(contact, [{ ...engagement, [flag]: true }]), []);
  }
  const other = { ...engagement, id: 2, title: 'Second workstream' };
  assert.equal(suggestEngagement(contact, 'Discuss prototype.', [engagement, other]), null);
  assert.equal(suggestEngagement(contact, 'Belmont Metals prototype.', [engagement, other]), '1');
});

test('SMS provenance survives engagement normalization and later edits', () => {
  const note = { id: 'text-summary-51', date: '2026-10-02', html: 'Work note',
    source: 'sms', sourceKey: 'dedupe-key', contactId: '459' };
  assert.deepEqual(withDefaults({ notes: [note] }).notes, [note]);
});

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
}

function fixture(finalRows = [{ engagement_id: '1' }]) {
  const calls = [];
  const results = [[{ contact_id: '459', source_key: 'source', conversation_ended_at: '2026-10-02T17:20:00Z' }],
    [{ payload: { name: 'Mike <Example>' } }], finalRows];
  const sql = async (strings, ...values) => {
    calls.push({ query: strings.join('?'), values });
    return results.shift() || [];
  };
  return { calls, handler: endpoint.createHandler({ auth: () => true, getSql: () => sql, ensureSchema: async () => {} }) };
}

test('engagement approval atomically claims SMS and appends only to engagement', async () => {
  const { handler, calls } = fixture();
  const res = response();
  await handler({ method: 'PATCH', body: { id: 51, action: 'approve', summary: 'Decision <safe>\nNext steps: Tuesday', engagementId: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.engagementId, '1');
  const write = calls[2];
  assert.match(write.query, /FOR UPDATE/);
  assert.match(write.query, /status = 'pending' AND EXISTS \(SELECT 1 FROM target\)/);
  assert.match(write.query, /EXISTS \(SELECT 1 FROM claimed_summary\)/);
  assert.match(write.query, /record_type = 'engagement'/);
  assert.doesNotMatch(write.query, /updated_contact|lastContact|followUpDate/);
  const note = JSON.parse(write.values.find(value => typeof value === 'string' && value.startsWith('[{')))[0];
  assert.equal(note.date, '2026-10-02');
  assert.equal(note.id, 'text-summary-51');
  assert.match(note.html, /Mike &lt;Example&gt;/);
  assert.match(note.html, /Decision &lt;safe&gt;<br>Next steps/);
});

test('unavailable destination or concurrent approval reports conflict', async () => {
  const { handler } = fixture([]);
  const res = response();
  await handler({ method: 'PATCH', body: { id: 51, action: 'approve', summary: 'Work note', engagementId: 'closed-or-missing' } }, res);
  assert.equal(res.statusCode, 409);
});

test('already-reviewed SMS cannot be appended again', async () => {
  let writes = 0;
  const handler = endpoint.createHandler({ auth: () => true, ensureSchema: async () => {}, getSql: () => async (strings) => {
    if (strings.join('').includes('UPDATE')) writes++;
    return [];
  } });
  const res = response();
  await handler({ method: 'PATCH', body: { id: 51, action: 'approve', summary: 'Work note', engagementId: '1' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(writes, 0);
});

test('contact destination retains existing contact approval behavior', async () => {
  const calls = [];
  const results = [[{ contact_id: '459', conversation_ended_at: '2026-10-02T17:20:00Z' }], [{ contact_id: '459' }]];
  const handler = endpoint.createHandler({ auth: () => true, ensureSchema: async () => {}, getSql: () => async strings => {
    calls.push(strings.join('')); return results.shift();
  } });
  const res = response();
  await handler({ method: 'PATCH', body: { id: 51, action: 'approve', summary: 'Personal update' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.engagementId, undefined);
  assert.match(calls[1], /updated_contact/);
});

test('unauthorized SMS review never reaches database', async () => {
  const handler = endpoint.createHandler({ auth: () => false, getSql: () => { throw new Error('Must not connect'); } });
  const res = response();
  await handler({ method: 'PATCH', body: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('client-work summarization adds detail in one mocked provider call', async t => {
  const priorFetch = global.fetch;
  const priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-only';
  t.after(() => { global.fetch = priorFetch; if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = priorKey; });
  const bodies = [];
  global.fetch = async (_, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ content: [{ text: '- Next steps: review prototype' }] }) };
  };
  await summarizeTranscript({ contactName: 'Example', transcript: 'Synthetic prototype discussion',
    startedAt: new Date('2026-10-02'), endedAt: new Date('2026-10-02'), engagement });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].max_tokens, 550);
  assert.match(bodies[0].messages[0].content, /3-5 concise factual bullets/);
  assert.match(bodies[0].messages[0].content, /Distinguish proposals from agreed decisions/);
});
