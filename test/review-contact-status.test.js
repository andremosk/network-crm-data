const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const {contactStatusPatch} = require('../lib/review-contact-status');
const {sanitizeProposal, applyUpdatePayload, createContactPayload} = require('../lib/communication-proposals');
const sms = require('../api/crm/text-summaries');
const email = require('../api/crm/communication-proposals');

function response() { return {setHeader() {}, status(code) {this.statusCode = code; return this;}, json(body) {this.body = body;}}; }

test('review status validates the full status list and real calendar dates', () => {
  assert.deepEqual(contactStatusPatch(undefined), {});
  assert.deepEqual(contactStatusPatch({status: ''}), {});
  for (const status of ['network_closely','network','came_through','call_scheduled','interesting','recruiter','cant_help']) {
    assert.deepEqual(contactStatusPatch({status}), {status, followUp: false, followUpDate: ''});
  }
  assert.deepEqual(contactStatusPatch({status: 'none'}), {status: null, followUp: false, followUpDate: ''});
  assert.deepEqual(contactStatusPatch({status: 'follow_up', followUpDate: '2026-11-04'}), {status: 'follow_up', followUp: true, followUpDate: '2026-11-04'});
  assert.deepEqual(contactStatusPatch({status: 'follow_up'}), {status: 'follow_up', followUp: true});
  assert.deepEqual(contactStatusPatch({status: 'follow_up', followUpDate: ''}), {status: 'follow_up', followUp: true, followUpDate: ''});
  for (const value of [{status:'invalid'}, {status:'follow_up', followUpDate:'2026-02-30'}, {status:'network',followUpDate:'2026-11-04'}, {status:'',followUpDate:'2026-11-04'}, []]) assert.throws(() => contactStatusPatch(value), error => error.statusCode === 400);
});

test('explicit manual email status/date overrides suggestions; ordinary suggestions still preserve later dates', () => {
  const current = {status:'follow_up',followUp:true,followUpDate:'2026-12-01',notes:'Original'};
  const proposed = {status:'follow_up',followUpDate:'2026-11-04', note:'Thanks'};
  assert.equal(applyUpdatePayload(current, proposed).followUpDate, '2026-12-01');
  const edited = {...proposed, contactUpdate:{status:'follow_up',followUpDate:'2026-11-04',tier:1}};
  assert.equal(applyUpdatePayload(current, edited).followUpDate, '2026-11-04');
  assert.equal(sanitizeProposal('update_contact', edited).contactUpdate.tier, undefined);
  const cleared = applyUpdatePayload(current, {contactUpdate:{status:'none'}});
  assert.equal(cleared.status, null); assert.equal(cleared.followUp, false); assert.equal(cleared.followUpDate, '');
  assert.equal(createContactPayload({name:'Example',email:'example@example.com',contactUpdate:{status:'network'}}, 1).status,'network');
});

test('SMS status change is in the same guarded write as approval, never a separate save', async () => {
  const calls = [], results = [[{contact_id:'42',conversation_ended_at:'2026-10-28T12:00:00Z'}],[{contact_id:'42'}]];
  const handler = sms.createHandler({auth:()=>true,ensureSchema:async()=>{},getSql:()=>async(strings,...values)=>{calls.push({sql:strings.join('?'),values});return results.shift()||[];}});
  const res = response();
  await handler({method:'PATCH',body:{id:1,action:'approve',summary:'A note',contactUpdate:{status:'follow_up',followUpDate:'2026-11-04'}}},res);
  assert.equal(res.statusCode,200); assert.equal(calls.length,2);
  assert.match(calls[1].sql,/EXISTS \(SELECT 1 FROM target\)/);
  assert.ok(calls[1].values.includes(JSON.stringify({status:'follow_up',followUp:true,followUpDate:'2026-11-04'})));
});

test('invalid status and engagement status requests never reach an SMS write', async () => {
  const calls=[];
  const handler=sms.createHandler({auth:()=>true,ensureSchema:async()=>{},getSql:()=>async(strings)=>{calls.push(strings.join(''));return [];}});
  for (const extra of [{contactUpdate:{status:'invalid'}},{engagementId:'7',contactUpdate:{status:'network'}}]) {
    const res=response(); await handler({method:'PATCH',body:{id:1,action:'approve',summary:'A note',...extra}},res);
    assert.equal(res.statusCode,400);
  }
  assert.equal(calls.length,0);
});

test('email save edit persists manual controls without touching live contact; apply sends sanitized edits', async () => {
  let writes=0, saved;
  const draft={id:1,proposal_type:'update_contact',matched_contact_id:'42',proposed:{note:'Example'}};
  const handler=email.createHandler({auth:()=>true,ensureSchema:async()=>{},getSql:()=>({}),loadPending:async()=>draft,
    editProposal:async(_sql,_id,_type,proposed)=>{saved=proposed;return {proposed};},
    applyUpdate:async(_sql,_draft,proposed)=>{writes++;assert.deepEqual(proposed.contactUpdate,{status:'call_scheduled',followUpDate:''});return '42';}});
  const body={id:1,action:'edit',proposed:{note:'Example',contactUpdate:{status:'call_scheduled'}}};
  const res=response();await handler({method:'PATCH',body},res);assert.equal(writes,0);assert.equal(res.statusCode,200);
  await handler({method:'PATCH',body:{id:1,action:'apply',proposed:saved}},response());assert.equal(writes,1);
});

test('email SQL applies manual patch after suggested fields', async () => {
  let query, values;
  await email.applyUpdate(async(strings,...params)=>{query=strings.join('?');values=params;return [{contact_id:'42'}];},
    {id:1,occurred_at:'2026-10-28T12:00:00Z'}, {note:'Example',contactUpdate:{status:'network'}});
  assert.match(query,/\)\) \|\| \?::jsonb/);
  assert.ok(values.includes(JSON.stringify({status:'network',followUp:false,followUpDate:''})));
});

function uiHarness(now='2026-10-29T02:00:00Z') {
  const elements = new Map(), posts=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',classList:{contains:()=>id==='textReviewModal',toggle(){},add(){},remove(){}}});return elements.get(id);};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} }
  const context={Date:Clock,console,contacts:[{id:42,name:'Example',status:'network'}],window:{toast(){}},localStorage:{getItem:()=> '[]',setItem(){}},
    document:{getElementById:id=>id==='engagementSmsReview'?null:element(id)},
    fetch:async(url,options)=>{
      if(options?.method==='PATCH'){posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({status:'approved'})};}
      return {ok:true,json:async()=>url.includes('communication-proposals')?{proposals:[]}:{summaries:[{id:1,contact_id:'42',summary:'Example',conversation_ended_at:now}],engagements:[],conversations:[]}};
    }};
  vm.runInNewContext(fs.readFileSync('text-summary-review.js','utf8'),context);
  return {context,element,posts};
}

test('one-week button uses New York calendar date and includes change only on approval', async () => {
  const {context,element,posts}=uiHarness();
  await context.window.loadTextSummaries();
  assert.match(element('textReviewContent').innerHTML,/1 week/);
  assert.match(element('textReviewContent').innerHTML,/current: Network Regularly/);
  context.window.setReviewFollowUpPreset('sms:1','textReviewSummary_1','week');
  assert.equal(posts.length,0);
  assert.equal(element('textReviewSummary_1_reviewStatus').value,'follow_up');
  assert.equal(element('textReviewSummary_1_reviewDate').value,'2026-11-04');
  element('textReviewSummary_1').value='A note';
  await context.window.approveTextSummary(1,'42');
  assert.deepEqual(posts[0].contactUpdate,{status:'follow_up',followUpDate:'2026-11-04'});
});

test('month shortcuts clamp end-of-month dates; custom dates select Follow Up; no change clears edit', () => {
  const {context,element}=uiHarness('2026-01-31T18:00:00Z');
  context.window.setReviewFollowUpPreset('sms:1','row','month');
  assert.equal(element('row_reviewDate').value,'2026-02-28');
  context.window.setReviewFollowUpPreset('sms:1','row','quarter');
  assert.equal(element('row_reviewDate').value,'2026-04-30');
  context.window.setReviewFollowUpDate('sms:1','row','2026-03-12');
  assert.equal(element('row_reviewStatus').value,'follow_up');
  context.window.setReviewContactStatus('sms:1','row','');
  assert.equal(element('row_reviewDate').value,'');
});
