const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const elements=new Map(),requests=[],emailReads=[];
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',innerHTML:'',classList:{contains:()=>id==='textReviewModal',add(){},remove(){},toggle(){}}});
    return elements.get(id);
  };
  const shared={messageId:'source-123',subject:'Introduction: Jamie and Andre',sourceUrl:'https://mail.google.com/mail/u/0/#all/source-123'};
  const proposals=[{id:1,proposal_type:'update_contact',matched_contact_id:'907',matched_contact_name:'Avery Chen',evidence:'I am making an introduction.',review_context:shared,
    proposed:{note:'Avery referred Andre.',status:'follow_up',followUpDate:'2026-12-09',reminder:{date:'2026-12-09',text:'Thank Avery and share outcome.'}}},
    {id:2,proposal_type:'create_engagement',occurred_at:'2026-11-10T14:40:24Z',created_at:'2026-11-18T02:15:09Z',evidence:'Jamie needs AI training.',review_context:shared,
      proposed:{title:'Orbit Five AI training',organization:'Orbit Five',currentState:'Warm introduction',opportunity:'Team AI training',note:'Referral from Avery',nextMilestone:'Discovery call',contactIds:['907'],links:shared.sourceUrl}}];
  const context={console,Date,contacts:[{id:907,name:'Avery Chen',status:'follow_up',followUpDate:'2026-11-15',communicationReminders:[{date:'2026-12-09',text:'Thank Avery'}]}],
    window:{toast(){}},document:{getElementById:id=>id==='engagementSmsReview'?null:element(id)},localStorage:{getItem:()=> '[]',setItem(){}},
    fetch:async(url,options)=>{
      if(url.includes('communication-email')) {emailReads.push(url);return {ok:true,json:async()=>({email:{from:'Avery <avery@example.invalid>',to:'Andre',subject:'Introduction',receivedAt:'2026-11-18T16:00:00Z',body:'Whole email\nSignature\n> Quoted reply <script>unsafe</script>'}})};}
      if(options?.method==='PATCH'){requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({status:'pending',proposal:{}})};}
      return {ok:true,json:async()=>url.includes('communication-proposals')?{proposals}:{summaries:[],conversations:[],engagements:[{id:'12',title:'Existing client work',organization:'Orbit Five'}]}};
    }};
  vm.runInNewContext(fs.readFileSync('text-summary-review.js','utf8'),context);
  return {context,element,requests,emailReads};
}

test('one email groups separately reviewable contact and engagement actions with source link', async()=>{
  const h=harness();await h.context.window.loadTextSummaries();
  const html=h.element('textReviewContent').innerHTML;
  assert.match(html,/Introduction: Jamie and Andre.*2 proposed actions/);
  assert.match(html,/Open in Gmail/);assert.match(html,/Referral reminder date/);assert.match(html,/Create pursuit/);
  assert.equal((html.match(/<summary>Full email<\/summary>/g)||[]).length,1);
  assert.match(html,/New pursuit/);assert.match(html,/Existing client work/);
  assert.match(html,/ignoreCommunicationProposal\(1\)/);assert.match(html,/ignoreCommunicationProposal\(2\)/);
  assert.equal(h.requests.length,0);
  assert.match(html,/Email received: Nov 10, 2026, 9:40 AM EST/);
  assert.match(html,/Added to review: Nov 17, 2026, 9:15 PM EST/);
  assert.match(html,/Older email surfaced during review/);
});

test('whole email loads only on expansion, escapes HTML, and is cached without touching draft edits', async()=>{
  const h=harness();await h.context.window.loadTextSummaries();
  assert.equal(h.emailReads.length,0);
  h.element('comm_note_2').value='Unsaved edit';
  await h.context.window.loadFullReviewEmail(1,{open:true});
  const html=h.element('fullReviewEmail_1').innerHTML;
  assert.match(html,/Whole email\nSignature\n&gt; Quoted reply &lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(html,/From:/);
  assert.doesNotMatch(html,/<script>/);
  assert.equal(h.element('comm_note_2').value,'Unsaved edit');
  await h.context.window.loadFullReviewEmail(1,{open:false});
  await h.context.window.loadFullReviewEmail(1,{open:true});
  assert.equal(h.emailReads.length,1);assert.equal(h.requests.length,0);
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
