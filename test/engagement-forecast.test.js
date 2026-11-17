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

test('list nests filtered children under their group and edits child status without changing the parent', () => {
  const items=[
    {id:1,title:'Parent initiative',isGroup:true,status:'on_hold'},
    {id:2,title:'Alpha project',groupId:'1',status:'lead'},
    {id:3,title:'Beta project',groupId:'1',status:'completed'},
    {id:4,title:'Independent project',status:'proposal'}
  ];
  const els=new Map();
  const el=id=>{if(!els.has(id))els.set(id,{value:'',innerHTML:'',focus(){}});return els.get(id);};
  const context={window:{EngagementCore:core},document:{head:{appendChild(){}},createElement:()=>({}),getElementById:el},
    engagements:items,selectedEngagementId:null,esc:String,fmtDate:String,saveEngagements(){},toggleMobileFilters(){}};
  vm.runInNewContext(fs.readFileSync('engagements.js','utf8'),context);Object.assign(context,context.window);
  const view=()=>el('engagementsView').innerHTML;
  context.renderEngagements();
  assert.match(view(),/Parent initiative[\s\S]*id="eng-branch-1" [^>]*>[\s\S]*Status for Alpha project/);
  assert.match(view(),/Independent project/);
  assert.doesNotMatch(view(),/Beta project|Status for Parent initiative/);
  assert.doesNotMatch(el('engagementsSidebar').innerHTML,/Standalone|Pursuit groups/);
  context.toggleEngagementBranch('1');
  assert.match(view(),/aria-expanded="false"/);
  assert.match(view(),/id="eng-branch-1" hidden/);
  context.toggleEngagementBranch('1');
  el('searchInput').value='parent initiative';
  context.renderEngagements();
  assert.match(view(),/Alpha project/);
  assert.doesNotMatch(view(),/Independent project|Beta project/);
  context.setListEngagementStatus(2,'on_hold');
  assert.equal(items[1].status,'on_hold');
  assert.equal(items[0].status,'on_hold');
  assert.doesNotMatch(view(),/Alpha project/);
  context.undoEngagementStatus();
  assert.match(view(),/Alpha project/);
  context.setEngagementFilter('all');
  assert.match(view(),/Status for Alpha project[\s\S]*Status for Beta project/);
});

test('cash-flow view keeps on-hold opportunities but excludes groups, closed and deleted', () => {
  const rows=core.forecastRows([sample,{id:2,isGroup:true,expectedValue:10000},{id:3,status:'on_hold'},{id:4,status:'closed'},{id:5,deleted:true},{id:6,archived:true},{id:7,groupId:'2',title:'Child'}]);
  assert.deepEqual(rows.map(row=>row.id).sort(),[1,3,7]);
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
  assert.match(el('engagementsSidebar').innerHTML,/Active Pursuits/);
  assert.match(el('engagementsView').innerHTML,/Status for/);
  context.window.setEngagementView('forecast');
  assert.match(el('engagementsView').innerHTML,/Cash-flow timeline/);
  context.window.toggleForecastPayments('1');
  assert.match(el('engagementsView').innerHTML,/Expected fees/);
  context.window.updateForecastField(1,'projectedEndDate','2026-11-01'); assert.equal(saves,0);
  context.window.updateForecastField(1,'expectedValue','12000');assert.equal(items[0].expectedValue,12000);assert.equal(saves,1);
  context.window.addEngagementPayment(1); assert.equal(items[0].payments.length,4);
  context.window.updateEngagementPayment(1,3,'amount','1500');assert.equal(items[0].payments[3].amount,1500);
  context.window.updateEngagementPayment(1,3,'status','received');assert.equal(items[0].payments[3].status,'received');
  context.window.removeEngagementPayment(1,3);assert.equal(items[0].payments.length,3);
  context.window.updateForecastField(1,'forecastConfidence','at_risk');assert.equal(items[0].forecastConfidence,'at_risk');assert.equal(items[0].status,'proposal');
  assert.equal(context.contacts.length,0);assert.equal(core.withDefaults(items[0]).expectedValue,12000);
});

test('timeline spans year boundaries and clips project bars to actual days', () => {
  assert.deepEqual(core.monthKeys('2026-12',3),['2026-12','2027-01','2027-02']);
  assert.deepEqual(core.monthKeys('bad'),[]);
  const timeline=core.cashTimeline(core.forecastRows([{...sample,projectedStartDate:'2026-11-10',projectedEndDate:'2026-12-20'}]),'2026-11',6);
  assert.equal(timeline.entries[0].cells[0].running,true);
  assert.equal(timeline.entries[0].cells[0].left,30);
  assert.equal(timeline.entries[0].cells[1].right,11/31*100);
  assert.equal(timeline.entries[0].cells[2].running,false);
  assert.equal(timeline.entries[0].cells[1].amount,6000);
});

test('receipts land in payment month independently of run; colors and sums remain separate', () => {
  const rows=core.forecastRows([
    {...sample,status:'active_client',payments:[{amount:1000,expectedDate:'2027-02-05'},{amount:300,expectedDate:'2027-02-20'}]},
    {...sample,id:2,status:'proposal',payments:[{amount:500,expectedDate:'2027-02-05'}]},
    {...sample,id:3,status:'on_hold',payments:[{amount:200,expectedDate:'2027-02-05'}]},
    {...sample,id:4,status:'active_client',forecastConfidence:'at_risk',payments:[{amount:50,expectedDate:'2027-02-05'}]}
  ]);
  const timeline=core.cashTimeline(rows,'2027-02',6);
  assert.equal(timeline.entries[0].cells[0].running,false);
  assert.equal(timeline.totals.confirmed[0].amount,1300);
  assert.equal(timeline.totals.proposal[0].amount,500);
  assert.equal(timeline.totals.at_risk[0].amount,250);
});

test('received, undated, unknown, and outside-view payments are not falsely placed into months', () => {
  const rows=core.forecastRows([{...sample,expectedValue:1200,payments:[{amount:200,expectedDate:'2026-11-01',status:'received'},{amount:300},{amount:null,expectedDate:'2026-12-15'},{amount:400,expectedDate:'2027-06-01'}]}]);
  const timeline=core.cashTimeline(rows,'2026-11',6), row=timeline.entries[0];
  assert.equal(row.cells[0].receipts.length,0);assert.equal(row.cells[1].unknown,1);
  assert.equal(row.unscheduled,600); assert.equal(row.outside.length,1);
  const output=core.cashTimelineExport(rows,'2026-11',6);
  assert.match(output.html,/#d7eee1/); assert.match(output.csv,/Client","Opportunity/);
  assert.match(output.text,/\$400.00 on 2027-06-01/);
});

test('missing run dates produce no invented bars and timeline exports escape content', () => {
  const rows=core.forecastRows([{id:1,organization:'=bad',title:'<script>bad</script>',payments:[{amount:50,expectedDate:'2026-11-04'}]}]);
  assert.equal(core.cashTimeline(rows,'2026-11',6).entries[0].cells[0].running,false);
  const output=core.cashTimelineExport(rows,'2026-11',6);
  assert.match(output.csv,/"'=bad"/);assert.doesNotMatch(output.html,/<script>/);
  assert.match(output.html,/&lt;script&gt;/);
});

test('Copy recap writes the new month-across colored timeline rather than the old fee table', async () => {
  let copied;
  const elements = new Map(); const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',classList:{contains:()=>false}});return elements.get(id);};
  class ClipboardItem {constructor(data){this.data=data;}}
  const context={Blob,ClipboardItem,navigator:{clipboard:{write:async items=>{copied=items[0].data;}}},window:{EngagementCore:core,ClipboardItem},
    document:{head:{appendChild(){}},createElement:()=>({}),getElementById:el},engagements:[core.withDefaults(sample)],contacts:[],selectedEngagementId:null,
    esc:value=>String(value||''),fmtDate:value=>value||'TBD',toast(){},saveEngagements(){},toggleMobileFilters(){},Date,Set,Map};
  vm.runInNewContext(fs.readFileSync('engagements.js','utf8'),context);Object.assign(context,context.window);
  context.window.setEngagementView('forecast');
  context.window.setCashTimelineStart('2026-11');await context.window.copyEngagementForecast();
  const html=await copied['text/html'].text();
  assert.match(html,/Cash-flow timeline/);assert.match(html,/Nov 2026/);assert.match(html,/border-top:5px/);
  assert.match(await copied['text/plain'].text(),/Cash-flow timeline/);
});

test('row status menu stays anchored near the bottom edge and supports Escape', () => {
  const listeners = new Map();
  const node = () => ({style:{}, attrs:{}, children:[], scrollHeight:220,
    setAttribute(k,v){this.attrs[k]=v;}, getAttribute(k){return this.attrs[k];}, removeAttribute(k){delete this.attrs[k];},
    append(child){this.children.push(child);}, remove(){this.removed=true;},
    querySelector(){return this.children.find(child=>child.attrs['aria-pressed']==='true');},
    get firstElementChild(){return this.children[0];}, focus(){this.focused=true;}});
  const trigger=node(), body=node();
  trigger.getBoundingClientRect=()=>({left:680,width:130,top:660,bottom:696});
  const win={EngagementCore:core,addEventListener(){},removeEventListener(){}};
  const context={window:win,engagements:[{id:1,status:'closed'}],
    document:{body,documentElement:{clientWidth:820,clientHeight:720},head:{appendChild(){}},createElement:node,
      addEventListener(k,v){listeners.set(k,v);},removeEventListener(k){listeners.delete(k);}}};
  vm.runInNewContext(fs.readFileSync('engagements.js','utf8'),context);
  win.openListStatusMenu(trigger,'1');
  const menu=body.firstElementChild;
  assert.equal(menu.style.bottom,'64px');
  assert.equal(menu.style.left,'648px');
  assert.equal(menu.children.length,7);
  assert.equal(trigger.attrs['aria-expanded'],'true');
  listeners.get('keydown')({key:'Escape',preventDefault(){}});
  assert.equal(menu.removed,true);
  assert.equal(trigger.attrs['aria-expanded'],'false');
  assert.equal(trigger.focused,true);
});

test('active pursuits exclude terminal and stalled work, with inline status edits and undo', () => {
  const statuses = ['pursuit','discovery','proposal','decision_pending','active_client','stalled','closed','lost','completed'];
  const items = statuses.map((status,id)=>({id:id+1,status,title:`Fixture ${status}`}));
  const elements=new Map();
  const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:''});return elements.get(id);};
  let saves=0;
  const context={window:{EngagementCore:core},document:{head:{appendChild(){}},createElement:()=>({}),getElementById:el},
    engagements:items,selectedEngagementId:null,esc:String,fmtDate:String,saveEngagements(){saves++;},toggleMobileFilters(){}};
  vm.runInNewContext(fs.readFileSync('engagements.js','utf8'),context);Object.assign(context,context.window);
  const view=()=>el('engagementsView').innerHTML;
  context.renderEngagements();
  assert.equal(el('statShowing').textContent,4);
  assert.match(view(),/Status for Fixture pursuit/);
  assert.doesNotMatch(view(),/Fixture (?:active_client|stalled|closed|lost|completed)/);
  context.setListEngagementStatus(1,'on_hold');
  assert.equal(saves,1);assert.doesNotMatch(view(),/Fixture pursuit/);
  context.undoEngagementStatus();
  assert.equal(saves,2);assert.match(view(),/Fixture pursuit/);
  context.setEngagementFilter('clients');
  assert.equal(el('statShowing').textContent,1);
  context.setEngagementFilter('all');
  assert.equal(el('statShowing').textContent,9);
  assert.match(view(),/Closed \(legacy\)/);
  context.setEngagementView('forecast');
  assert.match(view(),/Fixture stalled/);assert.doesNotMatch(view(),/Fixture (?:closed|lost|completed)/);
});
