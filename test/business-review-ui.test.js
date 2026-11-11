const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const elements=new Map(),requests=[];
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',innerHTML:'',classList:{contains:()=>id==='textReviewModal',add(){},remove(){},toggle(){}}});
    return elements.get(id);
  };
  const shared={messageId:'source-123',subject:'Introduction: Jamie and Andre',sourceUrl:'https://mail.google.com/mail/u/0/#all/source-123'};
  const proposals=[{id:1,proposal_type:'update_contact',matched_contact_id:'907',matched_contact_name:'Avery Chen',evidence:'I am making an introduction.',review_context:shared,
    proposed:{note:'Avery referred Andre.',status:'follow_up',followUpDate:'2026-12-09',reminder:{date:'2026-12-09',text:'Thank Avery and share outcome.'}}},
    {id:2,proposal_type:'create_engagement',evidence:'Jamie needs AI training.',review_context:shared,
      proposed:{title:'Orbit Five AI training',organization:'Orbit Five',currentState:'Warm introduction',opportunity:'Team AI training',note:'Referral from Avery',nextMilestone:'Discovery call',contactIds:['907'],links:shared.sourceUrl}}];
  const context={console,Date,contacts:[{id:907,name:'Avery Chen',status:'follow_up',followUpDate:'2026-11-15',communicationReminders:[{date:'2026-12-09',text:'Thank Avery'}]}],
    window:{toast(){}},document:{getElementById:id=>id==='engagementSmsReview'?null:element(id)},localStorage:{getItem:()=> '[]',setItem(){}},
    fetch:async(url,options)=>{
      if(options?.method==='PATCH'){requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({status:'pending',proposal:{}})};}
      return {ok:true,json:async()=>url.includes('communication-proposals')?{proposals}:{summaries:[],conversations:[],engagements:[{id:'12',title:'Existing client work',organization:'Orbit Five'}]}};
    }};
  vm.runInNewContext(fs.readFileSync('text-summary-review.js','utf8'),context);
  return {context,element,requests};
}

test('one email groups separately reviewable contact and engagement actions with source link', async()=>{
  const h=harness();await h.context.window.loadTextSummaries();
  const html=h.element('textReviewContent').innerHTML;
  assert.match(html,/Introduction: Jamie and Andre.*2 proposed actions/);
  assert.match(html,/View email/);assert.match(html,/Referral reminder date/);assert.match(html,/Create pursuit/);
  assert.match(html,/New pursuit/);assert.match(html,/Existing client work/);
  assert.match(html,/ignoreCommunicationProposal\(1\)/);assert.match(html,/ignoreCommunicationProposal\(2\)/);
  assert.equal(h.requests.length,0);
});

test('engagement edits preserve linked contacts/source but do not save live engagement', async()=>{
  const h=harness();await h.context.window.loadTextSummaries();
  for(const [key,value] of Object.entries({engagementId:'12',title:'Edited title',organization:'Orbit Five',currentState:'Updated',opportunity:'Training',note:'A precise note',nextMilestone:'Call Jamie',nextMilestoneDate:'2026-11-20'}))h.element(`comm_${key}_2`).value=value;
  await h.context.window.editCommunicationProposal(2);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'edit');
  assert.equal(h.requests[0].proposed.engagementId,'12');
  assert.deepEqual(Array.from(h.requests[0].proposed.contactIds),['907']);
  assert.equal(h.requests[0].proposed.note,'A precise note');
});

test('approved referral reminder is readable from contact profile without pending SMS', async()=>{
  const h=harness();await h.context.window.loadTextSummaries();
  const html=h.context.window.renderTextSummarySection(907);
  assert.match(html,/Referral follow-ups/);assert.match(html,/2026-12-09/);assert.match(html,/Thank Avery/);
});
