const seedContacts=[
{id:1,name:"Maya Patel",company:"Northline Components",position:"President",email:"maya@northline.example",tier:2,client:1,connector:3,status:"follow_up",follow:"2026-07-28",notes:["Jul 8, 2026|Met through the regional manufacturing council. Their quoting process still moves between email and three spreadsheets.","Jun 12, 2026|Family-owned operation, 85 employees. Maya is curious about AI but wants practical guardrails."]},
{id:2,name:"Daniel Brooks",company:"Harbor Ridge Accounting",position:"Managing Partner",email:"daniel@harborridge.example",tier:1,client:2,connector:1,status:"network_closely",notes:["Jul 17, 2026|Daniel advises about 40 local business owners and often hears about operational issues before a project exists.","May 2, 2026|Introduced me to Maya Patel at Northline Components."]},
{id:3,name:"Elena Torres",company:"BrightPath Health Services",position:"COO",email:"elena@brightpath.example",tier:2,client:1,connector:3,status:"follow_up",follow:"2026-08-06",notes:["Jul 15, 2026|Scheduling and monthly reporting require a lot of manual reconciliation. Interested in a workflow diagnostic."]},
{id:4,name:"Marcus Lee",company:"Cedar & Stone Builders",position:"Owner",email:"marcus@cedarstone.example",tier:3,client:1,connector:2,status:"new",notes:["Jul 19, 2026|Met at chamber breakfast. Second-generation construction company with 120 field and office employees."]},
{id:5,name:"Rachel Kim",company:"Kinship Business Law",position:"Partner",email:"rachel@kinshiplaw.example",tier:2,client:2,connector:1,status:"network_closely",notes:["Jul 1, 2026|Trusted advisor to family businesses. Curious about a simple way to explain where Andre fits."]},
{id:6,name:"Owen Marshall",company:"Meridian Distribution",position:"VP Operations",email:"owen@meridian.example",tier:3,client:1,connector:3,status:"follow_up",follow:"2026-07-25",notes:["Jul 20, 2026|Team spends Fridays assembling inventory and vendor reports. ERP modernization is still a year away."]},
{id:7,name:"Priya Narang",company:"Fieldstone Foundation",position:"Chief of Staff",email:"priya@fieldstone.example",tier:1,client:2,connector:2,status:"came_through",notes:["Jun 28, 2026|Connected Andre to two nonprofit executive directors and offered to review workshop positioning."]},
{id:8,name:"Theo Grant",company:"Apex National Bank",position:"Director, AI Strategy",email:"theo@apex.example",tier:2,client:4,connector:3,status:"nurture",notes:["Jul 3, 2026|Large enterprise and already AI mature. Valuable peer relationship, not a likely client."]},
{id:9,name:"Nina Wallace",company:"Orchard Benefits Group",position:"Principal",email:"nina@orchardbenefits.example",tier:3,client:3,connector:1,status:"follow_up",follow:"2026-09-10",notes:["Jun 15, 2026|Works with established employers across the region and can spot HR process pain early."]},
{id:10,name:"Samir Desai",company:"Lakeview Dental Partners",position:"Practice Director",email:"samir@lakeview.example",tier:2,client:1,connector:3,status:"follow_up",follow:"2026-07-31",notes:["Jul 11, 2026|Five locations. Patient follow-up and insurance knowledge live with a few experienced coordinators."]},
{id:11,name:"Claire Bennett",company:"LaunchCraft AI",position:"Co-Founder",email:"claire@launchcraft.example",tier:1,client:4,connector:2,status:"network_closely",notes:["Jul 9, 2026|AI-native product company. Better partner and thought peer than end client."]},
{id:12,name:"Jamal Greene",company:"Westbridge Academy",position:"Director of Operations",email:"jamal@westbridge.example",tier:3,client:2,connector:3,status:"new",notes:["Jul 18, 2026|Automation-minded title at a tech-behind education organization. Strong discovery conversation."]},
{id:13,name:"Sofia Alvarez",company:"Redwood Commercial Bank",position:"SVP, Business Banking",email:"sofia@redwoodbank.example",tier:2,client:4,connector:1,status:"came_through",notes:["Jul 6, 2026|Regularly speaks with owners of established regional companies. Made one warm introduction."]},
{id:14,name:"Evan Miller",company:"Fulton Industrial Supply",position:"General Manager",email:"evan@fultonindustrial.example",tier:4,client:1,connector:3,status:"follow_up",follow:"2026-08-18",notes:["Jun 30, 2026|Long-running distributor. Customer follow-up and purchasing rely heavily on email."]},
{id:15,name:"Aisha Coleman",company:"Goodwork People Advisors",position:"Founder",email:"aisha@goodwork.example",tier:2,client:3,connector:1,status:"network_closely",notes:["Jul 2, 2026|Fractional HR leader with deep owner relationships. Interested in a shared client workshop."]},
{id:16,name:"Ben Foster",company:"Crown Retail Group",position:"CIO",email:"ben@crownretail.example",tier:3,client:2,connector:3,status:"nurture",notes:["May 22, 2026|Larger mid-market retailer, but not AI-native. Strong buyer role and practical modernization agenda."]},
{id:17,name:"Lena Morris",company:"Community Arts Network",position:"Executive Director",email:"lena@communityarts.example",tier:1,client:2,connector:2,status:"not_interested",notes:["Jul 12, 2026|Good organizational fit, but asked not to receive business outreach this year."]},
{id:18,name:"Caleb Ross",company:"Ross Technology Studio",position:"Owner",email:"caleb@rosstech.example",tier:2,client:4,connector:2,status:"network_closely",notes:["Jun 9, 2026|Tech-forward studio. Potential implementation partner for larger workflow builds."]}
];
const statusMeta={follow_up:["Follow Up","calendar-clock"],network_closely:["Network Closely","heart-handshake"],came_through:["Came Through","badge-check"],new:["New Lead","sparkles"],nurture:["Nurture Later","sprout"],not_interested:["Not Interested","circle-slash"]};
let contacts=structuredClone(seedContacts),selectedId=null;
const filters={relationship:0,client:0,connector:0,status:"all",search:"",sort:"followup"};
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=name=>name.split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase();
const fmtDate=value=>value?new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(new Date(`${value}T12:00:00`)):"";
const firstName=c=>c.name.split(/\s+/)[0];
function iconRefresh(){if(window.lucide)window.lucide.createIcons()}
function toast(message){$("toast").textContent=message;$("toast").classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>$("toast").classList.remove("show"),2200)}
function count(key,value){const field=key==="relationship"?"tier":key;return contacts.filter(c=>value==="all"||value===0||c[field]===value).length}
function filterButton(group,value,label,color){
  const active=filters[group]===value;
  return `<button class="filter-button ${active?"active":""}" data-filter-group="${group}" data-filter-value="${value}"><span class="dot" style="background:${color}"></span><span>${label}</span><span class="count">${count(group,value)}</span></button>`;
}
function renderFilters(){
  $("relationshipFilters").innerHTML=filterButton("relationship",0,"All","#63736f")+[1,2,3,4].map((n,i)=>filterButton("relationship",n,["T1 — Close","T2 — Good","T3 — Acquaintance","T4 — Weak Tie"][i],["#b98524","#238a7b","#7863a5","#84908d"][i])).join("");
  $("clientFilters").innerHTML=filterButton("client",0,"All","#63736f")+[1,2,3,4].map((n,i)=>filterButton("client",n,["1 — Strong","2 — Good","3 — Possible","4 — No Fit"][i],["#b98524","#238a7b","#7863a5","#84908d"][i])).join("");
  $("connectorFilters").innerHTML=filterButton("connector",0,"All","#63736f")+[1,2,3,4].map((n,i)=>filterButton("connector",n,["1 — Strong","2 — Good","3 — Possible","4 — Low"][i],["#b98524","#238a7b","#7863a5","#84908d"][i])).join("");
  $("statusFilters").innerHTML=filterButton("status","all","All","#63736f")+Object.entries(statusMeta).map(([key,[label]])=>filterButton("status",key,label,key==="not_interested"?"#a5473c":"#238a7b")).join("");
  document.querySelectorAll("[data-filter-group]").forEach(button=>button.onclick=()=>{
    const group=button.dataset.filterGroup,value=button.dataset.filterValue;
    filters[group]=["relationship","client","connector"].includes(group)?Number(value):value;
    render();
    if(innerWidth<760)$("filters").classList.remove("open");
  });
}
function visibleContacts(){
  const q=filters.search.toLowerCase();
  const rows=contacts.filter(c=>(!filters.relationship||c.tier===filters.relationship)&&(!filters.client||c.client===filters.client)&&(!filters.connector||c.connector===filters.connector)&&(filters.status==="all"||c.status===filters.status)&&(!q||[c.name,c.company,c.position,c.notes.map(n=>n.split("|")[1]).join(" ")].join(" ").toLowerCase().includes(q)));
  return rows.sort((a,b)=>{
    if(filters.sort==="name")return a.name.localeCompare(b.name);
    if(filters.sort==="relationship")return a.tier-b.tier||a.name.localeCompare(b.name);
    if(filters.sort==="client")return a.client-b.client||a.name.localeCompare(b.name);
    if(filters.sort==="connector")return a.connector-b.connector||a.name.localeCompare(b.name);
    return (a.follow||"9999-12-31").localeCompare(b.follow||"9999-12-31")||a.name.localeCompare(b.name);
  });
}
function score(n){return `<span class="score s${n}">${n}</span>`}
function renderRows(){
  const rows=visibleContacts();
  $("contactRows").innerHTML=rows.map(c=>`<button class="contact-row ${selectedId===c.id?"selected":""}" data-contact="${c.id}">
    <span class="name">${esc(c.name)}</span><span class="company">${esc(c.company)}</span><span class="position">${esc(c.position)}</span>${score(c.tier)}${score(c.client)}${score(c.connector)}
    <span class="status"><strong>${statusMeta[c.status][0]}</strong>${c.follow?`<small>By ${fmtDate(c.follow)}</small>`:""}</span></button>`).join("");
  document.querySelectorAll("[data-contact]").forEach(row=>row.onclick=()=>openDetail(Number(row.dataset.contact)));
  $("showingCount").textContent=rows.length;$("totalCount").textContent=contacts.length;$("relationshipOneCount").textContent=count("tier",1);
  $("emptyState").hidden=rows.length>0;$("resultLabel").textContent=rows.length===contacts.length?"All contacts":`${rows.length} contacts`;
  const active=[];if(filters.relationship)active.push(`Relationship ${filters.relationship}`);if(filters.client)active.push(`Client ${filters.client}`);if(filters.connector)active.push(`Connector ${filters.connector}`);if(filters.status!=="all")active.push(statusMeta[filters.status][0]);$("activeFilterLabel").textContent=active.join(" · ");
}
function render(){renderFilters();renderRows();iconRefresh()}
function setField(id,key,value){const c=contacts.find(x=>x.id===id);if(!c)return;c[key]=value;render();renderDetail(c);toast("Saved in demo")}
function scorePicker(c,key,label){return `<div class="score-card"><label>${label}</label><div class="score-options">${[1,2,3,4].map(n=>`<button class="s${n} ${c[key]===n?"active":""}" data-score="${key}:${n}">${n}</button>`).join("")}</div></div>`}
function renderDetail(c){
  const notes=c.notes.map(n=>{const [date,text]=n.split("|");return `<article class="note"><time>${esc(date)}</time>${esc(text)}</article>`}).join("");
  $("detailContent").innerHTML=`<div class="profile-head"><div class="avatar">${initials(c.name)}</div><div><div class="profile-name">${esc(c.name)}</div><div class="profile-role">${esc(c.position)} · ${esc(c.company)}</div></div><div class="profile-actions">
    <a href="mailto:${esc(c.email)}"><i data-lucide="mail"></i>Email</a><button data-reconnect="${c.id}"><i data-lucide="send"></i>Reconnect</button><button class="accent" data-coach="${c.id}"><i data-lucide="sparkles"></i>Coach</button></div></div>
    <div class="score-grid">${scorePicker(c,"tier","Relationship")}${scorePicker(c,"client","Client Fit")}${scorePicker(c,"connector","Connector Fit")}</div>
    <div class="field-grid"><div class="field"><label>Email</label><input type="email" value="${esc(c.email)}" data-field="email"></div><div class="field"><label>Status</label><select data-field="status">${Object.entries(statusMeta).map(([key,[label]])=>`<option value="${key}" ${c.status===key?"selected":""}>${label}</option>`).join("")}</select></div>
    <div class="field"><label>Company</label><input value="${esc(c.company)}" data-field="company"></div><div class="field"><label>Position</label><input value="${esc(c.position)}" data-field="position"></div>
    <div class="field"><label>Follow-up</label><div class="follow-controls"><input type="date" value="${c.follow||""}" data-field="follow"><select id="quickFollow"><option value="">Quick date</option><option value="7">In a week</option><option value="30">In a month</option><option value="90">In 3 months</option></select></div></div><div class="field"><label>Contact ID</label><input value="DEMO-${String(c.id).padStart(3,"0")}" disabled></div></div>
    <div class="section-title">Conversation Coach</div><section class="coach"><div class="coach-head"><strong>Prepare for your next conversation</strong><button data-coach="${c.id}">Generate</button></div><div class="coach-output" id="coachOutput">Use CRM context to surface a useful angle, questions, and a repeatable description of Andre's work.</div></section>
    <div class="section-title">Add Note</div><div class="note-editor"><div class="note-toolbar"><button data-command="bold">B</button><button data-command="italic"><em>I</em></button><button data-command="insertUnorderedList">•</button></div><div id="noteInput" class="note-input" contenteditable="true" data-placeholder="Add a meeting note..."></div></div><div class="note-save"><button class="primary-button" id="saveNote">Save note</button></div>
    <div class="section-title">Updates</div><div class="notes">${notes}</div>`;
  document.querySelectorAll("[data-score]").forEach(b=>b.onclick=()=>{const [key,n]=b.dataset.score.split(":");setField(c.id,key,Number(n))});
  document.querySelectorAll("[data-field]").forEach(el=>el.onchange=()=>setField(c.id,el.dataset.field,el.value));
  document.querySelectorAll("[data-coach]").forEach(b=>b.onclick=()=>generateCoach(c));
  document.querySelector("[data-reconnect]").onclick=()=>showReconnect(c);
  $("quickFollow").onchange=e=>{if(!e.target.value)return;const d=new Date();d.setDate(d.getDate()+Number(e.target.value));setField(c.id,"follow",d.toISOString().slice(0,10))};
  document.querySelectorAll("[data-command]").forEach(b=>b.onmousedown=e=>{e.preventDefault();document.execCommand(b.dataset.command)});
  $("saveNote").onclick=()=>{const value=$("noteInput").innerText.trim();if(!value)return toast("Write a note first");c.notes.unshift(`${new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(new Date())}|${value}`);renderDetail(c);toast("Note added for this demo session")};
  iconRefresh();
}
function openDetail(id){selectedId=id;const c=contacts.find(x=>x.id===id);if(!c)return;$("detailPanel").classList.add("open");$("detailPanel").setAttribute("aria-hidden","false");$("detailBreadcrumb").textContent=c.name;renderDetail(c);renderRows()}
function generateCoach(c){const output=$("coachOutput");output.innerHTML="Thinking through the relationship and recent notes…";setTimeout(()=>{const angle=c.client<=2?`Explore one concrete workflow at ${esc(c.company)} where manual coordination is slowing the team down.`:`Lead with curiosity and relationship-building rather than a client conversation.`;output.innerHTML=`<strong>Best angle</strong><ul><li>${angle}</li><li>Ask what work still depends on spreadsheets, email, or one person's know-how.</li><li>Describe Andre as someone who helps established teams figure out where AI is genuinely useful, then builds or teaches what fits.</li></ul>`},650)}
function modal(title,content){$("modalTitle").textContent=title;$("modalContent").innerHTML=content;$("modalBackdrop").hidden=false;iconRefresh()}
function showReconnect(c){
  const personal=c.notes[0].split("|")[1];const callback=personal.includes("Met")?`I enjoyed meeting you and have been meaning to follow up.`:`I've been meaning to reach out and see how you're doing.`;
  const draft=`Subject: Checking in\n\nHey ${firstName(c)},\n\n${callback} I’d love to hear how things are going at ${c.company} and what you’ve been working on.\n\nOn my side, I’ve started helping organizations figure out where AI can make work easier in practical, useful ways. There’s a quick overview at https://andremosk.com. I’d also be curious to hear how AI is showing up in your world, if at all.\n\nOpen to catching up sometime in the next few weeks? Feel free to find a slot in my Calendly below.\n\nBest Regards,\nAndre\nWebsite: https://andremosk.com\nCalendly: https://calendly.com/andre-moskowitz/30min`;
  modal("Warm reconnection",`<div class="modal-body"><p style="font-size:12px;color:var(--muted)">To: ${esc(c.email)} · Generated from fictional demo context</p><textarea id="draftText">${esc(draft)}</textarea><div class="modal-actions"><button id="regenerateDraft">Regenerate</button><button class="accent" id="demoDraft">Save Gmail draft</button></div></div>`);
  $("regenerateDraft").onclick=()=>{toast("Draft refreshed");showReconnect(c)};$("demoDraft").onclick=()=>toast("Demo only · no email was created");
}
function showReview(){modal("Text Review",`<div class="modal-body"><div class="review-list"><article class="review-item"><header><strong>Unknown · ending 0194</strong><small>Today</small></header><p>Recent text conversation needs a contact match. Message content is never shown here.</p><button>Not CRM Relevant</button> <button class="accent">Match contact</button></article><article class="review-item"><header><strong>Summary for Maya Patel</strong><small>Yesterday</small></header><p>Discussed quoting workflow and agreed to reconnect with the operations lead next week.</p><button>Dismiss</button> <button class="accent">Add to Notes</button></article></div></div>`);document.querySelectorAll(".review-item button").forEach(b=>b.onclick=()=>toast("Review action simulated"))}
function addContactModal(){modal("Add contact",`<div class="modal-body"><div class="field-grid"><div class="field"><label>First name</label><input id="newFirst"></div><div class="field"><label>Last name</label><input id="newLast"></div><div class="field"><label>Company</label><input id="newCompany"></div><div class="field"><label>Position</label><input id="newPosition"></div><div class="field"><label>Email</label><input id="newEmail" type="email"></div></div><div class="modal-actions"><button class="accent" id="createContact">Add contact</button></div></div>`);$("createContact").onclick=()=>{const name=[$("newFirst").value,$("newLast").value].filter(Boolean).join(" ").trim();if(!name)return toast("Enter a name");const c={id:Math.max(...contacts.map(x=>x.id))+1,name,company:$("newCompany").value||"New Company",position:$("newPosition").value||"New Contact",email:$("newEmail").value,tier:3,client:3,connector:3,status:"new",notes:["Today|Added during this demo session."]};contacts.unshift(c);$("modalBackdrop").hidden=true;render();openDetail(c.id);toast("Demo contact added")}}
$("searchInput").oninput=e=>{filters.search=e.target.value;renderRows()};
$("sortSelect").onchange=e=>{filters.sort=e.target.value;renderRows()};
$("closeDetail").onclick=()=>{$("detailPanel").classList.remove("open");$("detailPanel").setAttribute("aria-hidden","true");selectedId=null;renderRows()};
$("prevContact").onclick=()=>{const rows=visibleContacts(),i=rows.findIndex(c=>c.id===selectedId);if(i>0)openDetail(rows[i-1].id)};
$("nextContact").onclick=()=>{const rows=visibleContacts(),i=rows.findIndex(c=>c.id===selectedId);if(i>=0&&i<rows.length-1)openDetail(rows[i+1].id)};
$("reviewButton").onclick=showReview;$("addContact").onclick=addContactModal;$("closeModal").onclick=()=>$("modalBackdrop").hidden=true;$("modalBackdrop").onclick=e=>{if(e.target===$("modalBackdrop"))$("modalBackdrop").hidden=true};
$("resetDemo").onclick=()=>{contacts=structuredClone(seedContacts);Object.assign(filters,{relationship:0,client:0,connector:0,status:"all",search:"",sort:"followup"});$("searchInput").value="";$("sortSelect").value="followup";render();toast("Demo reset")};
$("mobileFilter").onclick=()=>$("filters").classList.add("open");$("closeFilters").onclick=()=>$("filters").classList.remove("open");
document.querySelectorAll("[data-demo-toast]").forEach(el=>el.onclick=()=>toast(el.dataset.demoToast));
render();if(innerWidth>760)openDetail(1);
