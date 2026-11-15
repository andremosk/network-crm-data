const test = require('node:test');
const assert = require('node:assert/strict');
const { shortlist, rank, judge } = require('../lib/referrer');
const { createHandler } = require('../api/crm/referrer');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

const contacts = [
  {id:1,name:'Sam Ops',position:'COO',company:'Example Manufacturing',notes:'We are rolling out a new ERP across three plants.',tier:2},
  {id:2,name:'Jo Advisor',position:'Consultant',notes:'Advises industrial clients on ERP implementations and can introduce their operations leads.',connectorFitTier:1},
  {id:3,name:'Kai Leader',position:'CEO',notes:'Enjoyed lunch.',tier:2},
  {id:4,name:'Hidden',archived:true,notes:'ERP rollout'}
];

test('notes beat title alone; connector and direct paths are distinct', () => {
  const results = rank(shortlist(contacts,'leaders dealing with a major technology rollout'));
  assert.equal(results.find(row => row.track === 'direct').id,'1');
  assert.equal(results.find(row => row.track === 'connector').id,'2');
  assert.equal(results.find(row => row.id === '3').confidence,'Speculative');
  assert.equal(results.some(row => row.id === '4'),false);
});

test('thin queries still return ranked leads without inventing evidence', () => {
  const rows = rank(shortlist([{id:1,name:'Example'}],'orbital archaeology'));
  assert.equal(rows.length,1);
  assert.equal(rows[0].evidence,'');
  assert.equal(rows[0].confidence,'Speculative');
});

test('CRM explanations name the matched wording, distinguish connectors, and flag what to verify', () => {
  const query = 'leaders dealing with a major technology rollout';
  const rows = rank(shortlist(contacts, query), [], query);
  const direct = rows.find(row => row.id === '1');
  assert.match(direct.reason, /note mentions “rolling out”/);
  assert.match(direct.caveat, /own organization.*current/);
  const connector = rows.find(row => row.id === '2');
  assert.match(connector.reason, /access.*requested circle/);
  assert.match(connector.caveat, /Verify whom/);
  const fallback = rows.find(row => row.id === '3');
  assert.match(fallback.reason, /CEO/);
  assert.match(fallback.caveat, /does not confirm/);
});

test('district search separates district employees from evidenced connectors and rejects unrelated introductions', () => {
  const query = 'school districts with an overburdened head of HR';
  const rows = rank(shortlist([
    {id:1,name:'District Lead',company:'Example Union Free School District',position:'Head of HR'},
    {id:2,name:'Outside HR',company:'Netflix',position:'Head of HR'},
    {id:3,name:'District Advisor',company:'Example Consulting',notes:'Advises school districts on change management.'},
    {id:4,name:'Marty Banker',company:'Example Bank',notes:'Eugene introduced me to school district HR. Connected me with a chamber member.'},
    {id:5,name:'University HR',company:'Example University',position:'Head of HR'},
    {id:6,name:'Charter HR',company:'Example Charter Schools',position:'Head of HR'},
    {id:7,name:'Sasha Example',notes:'Sasha agreed to meet a consultant who is seeking to expand her work with school districts; Andre to make the introduction.'}
  ], query), [], query);
  assert.deepEqual(rows.filter(row=>row.track==='direct').map(row=>row.id), ['1']);
  assert.deepEqual(rows.filter(row=>row.track==='connector').map(row=>row.id), ['3']);
  assert.equal(rows.find(row=>row.id==='1').industrySource,'Inferred');
  assert.match(rows.find(row=>row.id==='1').caveat,/does not confirm/);
});

test('technology rollout is a situation, not a technology industry restriction', () => {
  const { industryScope } = require('../lib/referrer');
  assert.deepEqual(industryScope('leaders dealing with a major technology rollout'), []);
  assert.deepEqual(industryScope('HR leaders in healthcare').map(scope=>scope.industry), ['Healthcare']);
});

test('AI cannot inject contacts or promote invented quotes to strong evidence', () => {
  const candidates = shortlist(contacts,'ERP rollout');
  const rows = rank(candidates,[
    {id:'999',direct:{fit:1,quote:'invented',explicit:true}},
    {id:'3',direct:{fit:1,quote:'Company is restructuring immediately.',explicit:true}},
    {id:'1',direct:{fit:.95,quote:'We are rolling out a new ERP across three plants.',explicit:true}}
  ]);
  assert.equal(rows[0].confidence,'Strong');
  assert.equal(rows[0].id,'1');
  assert.notEqual(rows.find(row=>row.id==='3').confidence,'Strong');
  assert.equal(rows.some(row=>row.id==='999'),false);
});

test('provider receives bounded evidence and no email address', async () => {
  const candidates = shortlist([{...contacts[0],email:'secret@example.test'}],'ERP rollout');
  await judge('ERP rollout',candidates,{key:'test',fetchImpl:async (_url, options)=>{
    assert.match(options.body,/three plants/);
    assert.doesNotMatch(options.body,/secret@example/);
    return {ok:true,json:async()=>({content:[{type:'text',text:'[]'}]})};
  }});
});

test('private route rejects invalid requests and falls back on provider failure', async () => {
  let loads=0;
  const handler=createHandler({auth:req=>req.allowed,load:async()=>{loads++;return contacts;},assess:async()=>{throw Error('offline');}});
  const run=async request=>{
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;}};
    await handler(request,res);return res;
  };
  assert.equal((await run({method:'POST'})).code,401);
  assert.equal((await run({method:'GET',allowed:true})).code,405);
  assert.equal((await run({method:'POST',allowed:true,body:{query:' '}})).code,400);
  assert.equal(loads,0);
  const res=await run({method:'POST',allowed:true,body:{query:'ERP rollout'}});
  assert.equal(res.code,200);
  assert.equal(res.headers['Cache-Control'],'private, no-store');
  assert.equal(res.body.mode,'crm');
  assert.ok(res.body.results.length);
});

test('dialog submits a plain-language search and opens the supporting note', async () => {
  const node = () => ({
    children: [], handlers: {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren() { this.children = []; },
    addEventListener(event, handler) { this.handlers[event] = handler; }
  });
  const dialog = node(), trigger = node(), form = node(), input = node(), button = node();
  const status = node(), results = node(), close = node();
  let opened, scrolled = false, searches = 0;
  const evidence = contacts[0].notes;
  form.querySelector = () => button;
  dialog.querySelector = selector => ({form,input,'[role=status]':status,'.referrer-results':results,'.referrer-close':close})[selector];
  dialog.showModal = () => {};
  dialog.close = () => dialog.handlers.close();
  input.focus = () => {};
  input.value = 'leaders dealing with an ERP rollout';
  runInNewContext(readFileSync('referrer-ui.js','utf8'),{
    document: {
      getElementById: id => id === 'referrerDialog' ? dialog : trigger,
      createElement: node,
      querySelectorAll: () => [{innerText:evidence,scrollIntoView(){scrolled=true;}}]
    },
    location:{pathname:'/'}, contacts, AbortController, setTimeout, clearTimeout,
    clearProfileSearch(){}, switchView(){}, openDetail(id){opened=id;},
    fetch: async (url, options) => {
      searches++;
      assert.equal(url,'/api/crm/referrer');
      assert.deepEqual(JSON.parse(options.body),{query:input.value});
      return {ok:true,json:async()=>({mode:'ai',results:[{id:'1',name:'Sam Ops',track:'direct',confidence:'Strong',evidence,reason:'The note mentions ERP.',caveat:'Verify timing.'}]})};
    }
  });
  assert.equal(trigger.hidden,false);
  trigger.onclick();
  assert.equal(searches,0);
  await form.handlers.submit({preventDefault(){}});
  assert.equal(status.textContent,'1 suggestion');
  const row = results.children[0].children[1].children[0];
  assert.deepEqual(row.children.find(child => child.className === 'referrer-why').children.map(child => child.textContent),
    ['Why this match?', 'The note mentions ERP.', 'Verify timing.']);
  row.children.at(-1).onclick();
  assert.equal(opened,1);
  assert.equal(scrolled,true);
});
