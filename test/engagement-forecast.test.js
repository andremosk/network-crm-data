const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../engagement-core');
const sample = {id: 1, title: 'Workflow discovery', organization: 'Example Co', status: 'proposal', commercial: 'Estimate pending', expectedValue: 10000,
  projectedStartDate: '2026-11-10', projectedEndDate: '2026-12-20', nextMilestone: 'Scope review', nextMilestoneDate: '2026-11-05',
  payments: [{id:'a',label:'Deposit',amount:2000,expectedDate:'2026-11-10',status:'received'}, {id:'b',label:'Delivery',amount:6000,expectedDate:'2026-12-20'}, {id:'c',label:'Extras',amount:null}]};

test('legacy engagements retain commercial notes and get unknown financial defaults', () => {
  const item = core.withDefaults({id:1,title:'Legacy',commercial:'Maybe $10k'});
  assert.equal(item.commercial,'Maybe $10k'); assert.equal(item.expectedValue,null); assert.deepEqual(item.payments,[]);
  assert.equal(item.projectedStartDate,''); assert.equal(core.money(''),null); assert.equal(core.money(0),0);
  for(const value of [-1,'oops',Infinity,true]) assert.equal(core.money(value),null);
  assert.equal(core.dateOnly('2026-02-30'),'');
  assert.deepEqual(core.payments([null]),[]);
});

test('active forecast excludes groups, closed, held and deleted; child pursuits count once', () => {
  const rows=core.forecastRows([sample,{id:2,isGroup:true,expectedValue:10000},{id:3,status:'on_hold'},{id:4,status:'closed'},{id:5,deleted:true},{id:6,archived:true},{id:7,groupId:'2',title:'Child'}]);
  assert.deepEqual(rows.map(row=>row.id).sort(),[1,7]);
  assert.equal(core.forecastRows([{id:3,status:'on_hold'}],false).length,1);
});

test('fees, received payments and unscheduled balance do not double-count', () => {
  const rows=core.forecastRows([sample]);
  assert.equal(rows[0].expectedFees,10000); assert.equal(rows[0].plannedTotal,8000); assert.equal(rows[0].unallocatedFees,2000);
  assert.equal(rows[0].nextPayment.id,'b');
  assert.deepEqual(core.cashFlow(rows),[{month:'2026-12',amount:6000,unknown:0},{month:'Unscheduled',amount:2000,unknown:1}]);
  const derived=core.forecastRows([{id:2,payments:[{amount:0.1},{amount:0.2}]}])[0];
  assert.equal(derived.expectedFees,0.3); assert.equal(derived.unallocatedFees,0);
  assert.equal(core.forecastRows([{id:3}])[0].expectedFees,null);
});

test('CSV is escaped, formula-safe and includes payment timing and legacy milestone', () => {
  const csv=core.forecastCsv(core.forecastRows([{...sample,title:'=HYPERLINK("bad")',organization:'One, Two'}]));
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/); assert.match(csv,/"One, Two"/);
  assert.match(csv,/Scope review - 2026-11-05/); assert.match(csv,/Unscheduled balance: \$2,000.00/);
});

test('Gmail recap includes HTML and plain text without executable contact content', () => {
  const recap=core.forecastRecap(core.forecastRows([{...sample,title:'<img onerror=alert(1)>'}]));
  assert.match(recap.html,/&lt;img/); assert.doesNotMatch(recap.html,/<img/);
  assert.match(recap.html,/border-collapse/); assert.match(recap.text,/2026-11-10 to 2026-12-20/);
  assert.match(recap.text,/not guaranteed revenue/);
});

test('forecast edits save through existing engagement persistence and never edit contacts', () => {
  const items=[core.withDefaults(sample)]; let saves=0; const notices=[];
  const els=new Map(); const el=id=>{if(!els.has(id))els.set(id,{innerHTML:'',value:'',style:{},classList:{contains:()=>false}});return els.get(id);};
  const context={window:{EngagementCore:core},document:{head:{appendChild(){}},createElement:()=>({}),getElementById:el},engagements:items,contacts:[],selectedEngagementId:null,
    esc:value=>String(value||''),fmtDate:value=>value||'TBD',toast:message=>notices.push(message),saveEngagements:()=>saves++,toggleMobileFilters(){},Date,Set,Map};
  vm.runInNewContext(fs.readFileSync('engagements.js','utf8'),context);
  Object.assign(context,context.window);
  context.window.renderEngagements();
  assert.match(el('engagementsView').innerHTML,/Expected fees/);
  context.window.updateForecastField(1,'projectedEndDate','2026-11-01'); assert.equal(saves,0);
  context.window.updateForecastField(1,'expectedValue','12000');assert.equal(items[0].expectedValue,12000);assert.equal(saves,1);
  context.window.addEngagementPayment(1); assert.equal(items[0].payments.length,4);
  context.window.updateEngagementPayment(1,3,'amount','1500');assert.equal(items[0].payments[3].amount,1500);
  context.window.updateEngagementPayment(1,3,'status','received');assert.equal(items[0].payments[3].status,'received');
  context.window.removeEngagementPayment(1,3);assert.equal(items[0].payments.length,3);
  assert.equal(context.contacts.length,0);assert.equal(core.withDefaults(items[0]).expectedValue,12000);
});
