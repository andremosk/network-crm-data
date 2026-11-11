const test = require('node:test');
const assert = require('node:assert/strict');
const { assessEmail, buildProposals, nextMonth, SYSTEM } = require('../lib/business-email-review');
const { normalizedInboundMessage, runGmailReviewSync, saveBusinessReview, alreadyReviewed } = require('../lib/gmail-review-sync');
const { sanitizeProposal } = require('../lib/communication-proposals');
const { applyEngagement } = require('../lib/communication-engagements');
const review = require('../api/crm/communication-proposals');

const message = { sourceMessageId:'intro-123', receivedAt:'2026-11-09T23:57:56Z',
  sender:{name:'Avery Chen',email:'avery@example.org'}, recipients:[{email:'andre@example.com'},{name:'Jamie Lee',email:'jamie@orbit.example'}],
  subject:'Introduction: Jamie and Andre', bodyText:'I suspect there may be an opportunity for you to work together. Jamie is interested in AI training for the team at Orbit Five.' };
const context = { people:[{...message.sender,contact:{id:'907',name:'Avery Chen',email:message.sender.email}},
  {...message.recipients[1],contact:null}], engagements:[] };
const assessment = {relevant:true, category:'business', actions:[
  {kind:'contact',personEmail:'avery@example.org',note:'Avery introduced Andre to Jamie at Orbit Five to explore AI training.',
    evidence:'I suspect there may be an opportunity for you to work together.',referral:true,nextAction:'Thank Avery for the introduction and share how it went.'},
  {kind:'engagement',personEmail:'jamie@orbit.example',title:'Orbit Five — AI training',organization:'Orbit Five',
    opportunity:'Explore AI training for the team.',currentState:'Jamie is interested in training; introduced by Avery.',note:'Warm referral from Avery to discuss AI training with Jamie.',
    nextMilestone:'Connect with Jamie to assess needs and fit.',evidence:'Jamie is interested in AI training for the team at Orbit Five.'}
]};

test('business intro produces linked referral reminder and pursuit without creating every recipient', () => {
  const rows = buildProposals(message,assessment,context);
  assert.deepEqual(rows.map(r=>r.proposalType),['update_contact','create_engagement']);
  assert.equal(rows[0].matchedContactId,'907');
  assert.equal(rows[0].proposed.reminder.date,'2026-12-09');
  assert.match(rows[0].proposed.reminder.text,/Thank Avery/);
  assert.deepEqual(rows[1].proposed.contactIds,['907']);
  assert.equal(rows[1].proposed.status,'pursuit');
  assert.equal(rows[1].proposed.expectedValue,undefined);
  assert.equal(rows[0].reviewContext.messageId,rows[1].reviewContext.messageId);
  assert.notEqual(rows[0].sourceHash, rows[1].sourceHash);
  assert.deepEqual(buildProposals(message,assessment,context).map(r=>r.sourceHash),rows.map(r=>r.sourceHash));
});

test('calendar-month thank-you dates clamp month ends and use New York message date', () => {
  assert.equal(nextMonth('2026-01-31'),'2026-02-28');
  assert.equal(nextMonth('2028-01-31'),'2028-02-29');
  const rows=buildProposals({...message,receivedAt:'2026-11-10T01:00:00Z'},assessment,context);
  assert.equal(rows[0].proposed.reminder.date,'2026-12-09');
});

test('referral reminder does not suggest replacing an existing follow-up', () => {
  const people=context.people.map(person=>({...person,contact:person.contact ? {...person.contact,followUpDate:'2026-11-15'} : null}));
  const row=buildProposals(message,assessment,{...context,people})[0];
  assert.equal(row.proposed.followUpDate,'');assert.equal(row.proposed.status,null);
  assert.equal(row.proposed.reminder.date,'2026-12-09');
});

test('sports-only negative decision cannot become a proposal', () => {
  assert.deepEqual(buildProposals({...message,bodyText:'Who is coaching Little League on Saturday?'},{relevant:false,actions:[]},context),[]);
  assert.match(SYSTEM,/NOT thread name/);
  assert.match(SYSTEM,/business opportunity inside a sports thread qualifies/);
});

test('specific personal opener stays with an existing contact, never a pursuit or unknown person', () => {
  const note={kind:'contact',personEmail:'avery@example.org',note:'Avery is taking a vacation with Dave.',evidence:'Avery is taking a vacation with Dave.'};
  const rows=buildProposals({...message,bodyText:note.evidence},{relevant:true,category:'relationship',actions:[note]},context);
  assert.equal(rows[0].proposalType,'update_contact');
  assert.equal(rows[0].proposed.reminder,undefined);
  assert.throws(()=>buildProposals({...message,bodyText:note.evidence},{relevant:true,category:'relationship',actions:[{...note,personEmail:'jamie@orbit.example'}]},context),/no valid grounded/);
});

test('unseen people, invented evidence and unrecognized engagement IDs cannot write proposals', () => {
  for (const action of [{...assessment.actions[0],personEmail:'stranger@elsewhere.example'},
    {...assessment.actions[0],evidence:'Invented quote'}, {...assessment.actions[1],engagementId:'999'}]) {
    assert.throws(()=>buildProposals(message,{relevant:true,actions:[action]},context),/no valid grounded/);
  }
});

test('existing client work routes to an engagement and repeated same-target actions are collapsed', () => {
  const action={...assessment.actions[1],engagementId:'12'};
  const rows=buildProposals(message,{relevant:true,actions:[action,action]}, {...context,engagements:[{id:'12',organization:'Orbit Five'}]});
  assert.equal(rows.length,1); assert.equal(rows[0].proposalType,'update_engagement');
  assert.equal(rows[0].proposed.engagementId,'12');
  const matched=buildProposals(message,{relevant:true,actions:[assessment.actions[1]]},{...context,engagements:[{id:'12',organization:'Orbit Five'}]});
  assert.equal(matched[0].proposalType,'update_engagement');
  assert.throws(()=>buildProposals(message,{relevant:true,actions:[assessment.actions[1]]},{...context,engagements:[{id:'12',organization:'Orbit Five'},{id:'13',organization:'Orbit Five'}]}),/no valid grounded/);
});

test('group mail to a known alias is eligible; bulk and messages without Andre remain excluded', () => {
  const raw={id:'intro',internalDate:'1794268676000',payload:{mimeType:'text/plain',body:{data:Buffer.from(message.bodyText).toString('base64url')},
    headers:[{name:'From',value:'Avery Chen <avery@example.org>'},{name:'To',value:'Jamie Lee <jamie@orbit.example>, Andre <andre@work.example>'}]}};
  assert.ok(normalizedInboundMessage(raw,'andre@example.com',['andre@work.example']));
  assert.equal(normalizedInboundMessage(raw,'andre@example.com'),null);
  assert.equal(normalizedInboundMessage({...raw,payload:{...raw.payload,headers:[...raw.payload.headers,{name:'List-Id',value:'bulk'}]}},'andre@example.com',['andre@work.example']),null);
});

test('AI failures, malformed JSON and truncated output fail for retry, not permanent exclusion', async () => {
  for(const data of [{error:{}},{stop_reason:'max_tokens',content:[]},{content:[{type:'text',text:'not json'}]}]) {
    await assert.rejects(assessEmail(message,context,{ANTHROPIC_API_KEY:'test'},async()=>({ok:true,json:async()=>data})),/assessment/);
  }
  await assert.rejects(assessEmail(message,context,{}),/server AI key/);
});

test('atomic receipt and child inserts enforce durable dedupe', async () => {
  let query;
  const result=await saveBusinessReview(async(strings)=>{query=strings.join('?');return [{claimed:1,inserted:2}];},message.sourceMessageId,buildProposals(message,assessment,context));
  assert.equal(result.inserted,2);
  assert.match(query,/FROM claim CROSS JOIN jsonb_to_recordset/);
  assert.match(query,/ON CONFLICT DO NOTHING/);
  let oldQuery;
  assert.equal(await alreadyReviewed(async strings=>{oldQuery=strings.join('?');return [{}];},'old'),true);
  assert.match(oldQuery,/source_message_id =/); // includes applied AND ignored legacy decisions
});

test('email review approval never creates a pursuit during Save Edit or Ignore', async () => {
  let writes=0;
  const draft={id:5,proposal_type:'create_engagement',proposed:buildProposals(message,assessment,context)[1].proposed};
  const handler=review.createHandler({auth:()=>true,getSql:()=>({}),ensureSchema:async()=>{},loadPending:async()=>draft,
    editProposal:async()=>({proposed:draft.proposed}),ignoreProposal:async()=>true,
    applyEngagement:async()=>{writes++;return '123';}});
  const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}});
  for (const action of ['edit','ignore']) await handler({method:'PATCH',body:{id:5,action}},response());
  assert.equal(writes,0);
  const res=response();await handler({method:'PATCH',body:{id:5,action:'apply'}},res);
  assert.equal(writes,1);assert.equal(res.body.engagementId,'123');
});

test('engagement approval guards claim, duplicate organizations, active targets, and escapes notes', async () => {
  const rows=buildProposals(message,assessment,context);
  const draft={id:5,proposal_type:'create_engagement',occurred_at:message.receivedAt,review_context:rows[1].reviewContext};
  let query, params;
  const sql=async(strings,...values)=>{query=strings.join('?');params=values;return [{engagement_id:'12'}];};
  assert.equal(await applyEngagement(sql,draft,{...rows[1].proposed,note:'<script>danger</script>'}),'12');
  assert.match(query,/status = 'pending' FOR UPDATE/);
  assert.match(query,/crm_deleted_records/);
  assert.match(query,/LOWER\(payload->>'organization'\)/);
  assert.ok(params.some(p=>typeof p==='string'&&p.includes('danger')));
  assert.ok(params.every(p=>typeof p!=='string'||!p.includes('<script>')));
  await applyEngagement(sql,{...draft,proposal_type:'update_engagement'},{...rows[1].proposed,engagementId:'12'});
  assert.match(query,/sourceKey/);assert.match(query,/<> 'closed'/);
  assert.doesNotMatch(query,/'status', 'pursuit'/);
});

test('sanitizers retain reminder intent but reject HTML, invalid dates, arbitrary financial and status writes', () => {
  const clean=sanitizeProposal('update_contact',{note:'A referral',reminder:{date:'2026-12-09',text:'<b>Thank Avery</b>'},nextAction:'Share outcome'});
  assert.equal(clean.reminder.text,'Thank Avery');
  const p=sanitizeProposal('create_engagement',{title:'Test',expectedValue:50000,status:'active_client',nextMilestoneDate:'2026-02-30',links:'javascript:alert(1) https://mail.google.com/mail/u/0/#all/test'});
  assert.equal(p.expectedValue,undefined);assert.equal(p.status,'pursuit');assert.equal(p.nextMilestoneDate,'');assert.doesNotMatch(p.links,/javascript/);
});

test('assessment cache prevents repeat provider calls, and exclusion receipts do not alter contacts', async () => {
  let calls=0, receipts=0;
  const deps={getAccessToken:async()=> 'token',loadSyncState:async()=>({review_version:2,last_successful_at:'2026-11-09T00:00:00Z'}),
    loadEngagementContext:async()=>[],listMessages:async()=>({messages:[{id:'seen'},{id:'noise'}]}),
    alreadyReviewed:async(_sql,id)=>id==='seen',
    getMessage:async()=>({id:'noise',internalDate:'1794268676000',payload:{mimeType:'text/plain',headers:[{name:'From',value:'Avery <avery@example.org>'},{name:'To',value:'andre@example.com'}],body:{data:Buffer.from('Little league practice is at six.').toString('base64url')}}}),
    findContactByEmail:async()=>null,findUniqueContactByName:async()=>null,
    assessEmail:async()=>{calls++;return {relevant:false,actions:[]};},
    saveBusinessReview:async(_sql,_id,rows)=>{receipts++;assert.deepEqual(rows,[]);return {claimed:1,inserted:0};},saveSyncState:async()=>{}};
  const result=await runGmailReviewSync({sql:{},env:{NETWORK_CRM_GMAIL_MAILBOX:'andre@example.com'},dependencies:deps});
  assert.equal(calls,1);assert.equal(receipts,1);assert.equal(result.duplicates,1);assert.equal(result.skipped,1);
});

test('upgrade resets only the bounded window, and AI failure retains the successful checkpoint', async () => {
  let window, saved=[];
  const deps={getAccessToken:async()=> 'token',loadSyncState:async()=>({review_version:1,last_successful_at:'2026-11-09T00:00:00Z'}),
    loadEngagementContext:async()=>[],alreadyReviewed:async()=>false,
    listMessages:async(_token,since,page,until)=>{window={since,page,until};return{messages:[{id:'failed'}]};},
    getMessage:async()=>({id:'failed',internalDate:'1794268676000',payload:{mimeType:'text/plain',headers:[{name:'From',value:'Avery <avery@example.org>'},{name:'To',value:'andre@example.com'}],body:{data:Buffer.from('We have a project opportunity.').toString('base64url')}}}),
    findContactByEmail:async()=>null,findUniqueContactByName:async()=>null,assessEmail:async()=>{throw new Error('provider down');},
    saveSyncState:async(_sql,_mailbox,checkpoint,progress)=>saved.push({checkpoint,progress})};
  await assert.rejects(runGmailReviewSync({sql:{},now:new Date('2026-11-10T15:00:00Z'),env:{NETWORK_CRM_GMAIL_MAILBOX:'andre@example.com'},dependencies:deps}),/provider down/);
  assert.equal(window.since,'2026-10-27T15:00:00.000Z');
  assert.equal(saved.length,1);assert.equal(saved[0].checkpoint,null);
  assert.equal(saved[0].progress.since,window.since);
});
