const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "index.html");
const outputPath = path.join(root, "demo", "index.html");

const contacts = [
  {id:1,name:"Maya Patel",firstName:"Maya",lastName:"Patel",tier:2,company:"Northline Components",position:"President",email:"maya@northline.example",notes:"Jul 8, 2026: Met through the regional manufacturing council. Their quoting process still moves between email and three spreadsheets.\nJun 12, 2026: Family-owned operation, 85 employees. Maya is curious about AI but wants practical guardrails.",status:"follow_up",followUp:true,followUpDate:"2026-07-28",clientFitTier:1,clientFitManual:true,connectorFitTier:3,addedDate:"2026-06-12"},
  {id:2,name:"Daniel Brooks",firstName:"Daniel",lastName:"Brooks",tier:1,company:"Harbor Ridge Accounting",position:"Managing Partner",email:"daniel@harborridge.example",notes:"Jul 17, 2026: Advises about 40 local business owners and often hears about operational issues before a project exists.\nMay 2, 2026: Introduced me to Maya Patel at Northline Components.",status:"network_closely",clientFitTier:2,clientFitManual:true,connectorFitTier:1,addedDate:"2026-05-02"},
  {id:3,name:"Elena Torres",firstName:"Elena",lastName:"Torres",tier:2,company:"BrightPath Health Services",position:"COO",email:"elena@brightpath.example",notes:"Jul 15, 2026: Scheduling and monthly reporting require a lot of manual reconciliation. Interested in a workflow diagnostic.",status:"follow_up",followUp:true,followUpDate:"2026-08-06",clientFitTier:1,clientFitManual:true,connectorFitTier:3,addedDate:"2026-07-15"},
  {id:4,name:"Marcus Lee",firstName:"Marcus",lastName:"Lee",tier:3,company:"Cedar & Stone Builders",position:"Owner",email:"marcus@cedarstone.example",notes:"Jul 19, 2026: Met at chamber breakfast. Second-generation construction company with 120 field and office employees.",status:null,clientFitTier:1,clientFitManual:true,connectorFitTier:2,addedDate:"2026-07-19"},
  {id:5,name:"Rachel Kim",firstName:"Rachel",lastName:"Kim",tier:2,company:"Kinship Business Law",position:"Partner",email:"rachel@kinshiplaw.example",notes:"Jul 1, 2026: Trusted advisor to family businesses. Curious about a simple way to explain where Andre fits.",status:"network_closely",clientFitTier:2,clientFitManual:true,connectorFitTier:1,addedDate:"2026-07-01"},
  {id:6,name:"Owen Marshall",firstName:"Owen",lastName:"Marshall",tier:3,company:"Meridian Distribution",position:"VP Operations",email:"owen@meridian.example",notes:"Jul 20, 2026: Team spends Fridays assembling inventory and vendor reports. ERP modernization is still a year away.",status:"follow_up",followUp:true,followUpDate:"2026-07-25",clientFitTier:1,clientFitManual:true,connectorFitTier:3,addedDate:"2026-07-20"},
  {id:7,name:"Priya Narang",firstName:"Priya",lastName:"Narang",tier:1,company:"Fieldstone Foundation",position:"Chief of Staff",email:"priya@fieldstone.example",notes:"Jun 28, 2026: Connected Andre to two nonprofit executive directors and offered to review workshop positioning.",status:"came_through",clientFitTier:2,clientFitManual:true,connectorFitTier:2,addedDate:"2026-06-28"},
  {id:8,name:"Theo Grant",firstName:"Theo",lastName:"Grant",tier:2,company:"Apex National Bank",position:"Director, AI Strategy",email:"theo@apex.example",notes:"Jul 3, 2026: Large enterprise and already AI mature. Valuable peer relationship, not a likely client.",status:"network",clientFitTier:4,clientFitManual:true,connectorFitTier:3,addedDate:"2026-07-03"},
  {id:9,name:"Nina Wallace",firstName:"Nina",lastName:"Wallace",tier:3,company:"Orchard Benefits Group",position:"Principal",email:"nina@orchardbenefits.example",notes:"Jun 15, 2026: Works with established employers across the region and can spot HR process pain early.",status:"follow_up",followUp:true,followUpDate:"2026-09-10",clientFitTier:3,clientFitManual:true,connectorFitTier:1,addedDate:"2026-06-15"},
  {id:10,name:"Samir Desai",firstName:"Samir",lastName:"Desai",tier:2,company:"Lakeview Dental Partners",position:"Practice Director",email:"samir@lakeview.example",notes:"Jul 11, 2026: Five locations. Patient follow-up and insurance knowledge live with a few experienced coordinators.",status:"follow_up",followUp:true,followUpDate:"2026-07-31",clientFitTier:1,clientFitManual:true,connectorFitTier:3,addedDate:"2026-07-11"},
  {id:11,name:"Claire Bennett",firstName:"Claire",lastName:"Bennett",tier:1,company:"LaunchCraft AI",position:"Co-Founder",email:"claire@launchcraft.example",notes:"Jul 9, 2026: AI-native product company. Better partner and thought peer than end client.",status:"network_closely",clientFitTier:4,clientFitManual:true,connectorFitTier:2,addedDate:"2026-07-09"},
  {id:12,name:"Jamal Greene",firstName:"Jamal",lastName:"Greene",tier:3,company:"Westbridge Academy",position:"Director of Operations",email:"jamal@westbridge.example",notes:"Jul 18, 2026: Automation-minded title at a tech-behind education organization. Strong discovery conversation.",status:null,clientFitTier:2,clientFitManual:true,connectorFitTier:3,addedDate:"2026-07-18"},
  {id:13,name:"Sofia Alvarez",firstName:"Sofia",lastName:"Alvarez",tier:2,company:"Redwood Commercial Bank",position:"SVP, Business Banking",email:"sofia@redwoodbank.example",notes:"Jul 6, 2026: Regularly speaks with owners of established regional companies. Made one warm introduction.",status:"came_through",clientFitTier:4,clientFitManual:true,connectorFitTier:1,addedDate:"2026-07-06"},
  {id:14,name:"Evan Miller",firstName:"Evan",lastName:"Miller",tier:4,company:"Fulton Industrial Supply",position:"General Manager",email:"evan@fultonindustrial.example",notes:"Jun 30, 2026: Long-running distributor. Customer follow-up and purchasing rely heavily on email.",status:"follow_up",followUp:true,followUpDate:"2026-08-18",clientFitTier:1,clientFitManual:true,connectorFitTier:3,addedDate:"2026-06-30"},
  {id:15,name:"Aisha Coleman",firstName:"Aisha",lastName:"Coleman",tier:2,company:"Goodwork People Advisors",position:"Founder",email:"aisha@goodwork.example",notes:"Jul 2, 2026: Fractional HR leader with deep owner relationships. Interested in a shared client workshop.",status:"network_closely",clientFitTier:3,clientFitManual:true,connectorFitTier:1,addedDate:"2026-07-02"},
  {id:16,name:"Ben Foster",firstName:"Ben",lastName:"Foster",tier:3,company:"Crown Retail Group",position:"CIO",email:"ben@crownretail.example",notes:"May 22, 2026: Larger mid-market retailer, but not AI-native. Strong buyer role and practical modernization agenda.",status:"interesting",clientFitTier:2,clientFitManual:true,connectorFitTier:3,addedDate:"2026-05-22"},
  {id:17,name:"Lena Morris",firstName:"Lena",lastName:"Morris",tier:1,company:"Community Arts Network",position:"Executive Director",email:"lena@communityarts.example",notes:"Jul 12, 2026: Good organizational fit, but asked not to receive business outreach this year.",status:null,notInterested:true,clientFitTier:2,clientFitManual:true,connectorFitTier:2,addedDate:"2026-07-12"},
  {id:18,name:"Caleb Ross",firstName:"Caleb",lastName:"Ross",tier:2,company:"Ross Technology Studio",position:"Owner",email:"caleb@rosstech.example",notes:"Jun 9, 2026: Tech-forward studio. Potential implementation partner for larger workflow builds.",status:"network_closely",clientFitTier:4,clientFitManual:true,connectorFitTier:2,addedDate:"2026-06-09"}
];

const applications = [
  {id:1,company:"Northline Components",role:"AI Workflow Diagnostic",status:"interviewing",appliedDate:"2026-07-08",payRange:"Project",reference:"Maya Patel",whyMe:"Practical operations and AI workflow experience.",whyThem:"Established manufacturer with high-value manual workflows.",notes:"Fictional opportunity for demo purposes.",questionsToRehearse:"",questionsToAsk:"",companyNews:"",myStory:"",rounds:[]},
  {id:2,company:"Fieldstone Foundation",role:"Team AI Enablement Workshop",status:"researching",appliedDate:"2026-07-16",payRange:"Workshop",reference:"Priya Narang",whyMe:"Relevant training and enablement experience.",whyThem:"Mission-driven team looking for practical guardrails.",notes:"Fictional opportunity for demo purposes.",questionsToRehearse:"",questionsToAsk:"",companyNews:"",myStory:"",rounds:[]}
];

function replaceBetween(source, start, end, replacement) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Could not find demo build markers: ${start} ... ${end}`);
  return source.slice(0, from) + replacement + source.slice(to);
}

let html = fs.readFileSync(sourcePath, "utf8");
html = html.replace(/const SEED = \[[^\n]*\];/, "const SEED = [];");
html = replaceBetween(
  html,
  "function loadContacts() {",
  "// ─── APPLICATIONS DATA",
  `function loadContacts() { return ${JSON.stringify(contacts)}.map(withFitDefaults); }\nfunction saveContacts() { /* Demo changes live only in memory. */ }\n\n// ─── APPLICATIONS DATA`
);
html = replaceBetween(
  html,
  "const APP_SEED = [",
  "function loadApps() {",
  `const APP_SEED = ${JSON.stringify(applications)};\n\nfunction loadApps() {`
);
html = replaceBetween(
  html,
  "function loadApps() {",
  "// ─── STATE",
  `function loadApps() { return APP_SEED.map(app => ({...app})); }\nfunction saveApps() { /* Demo changes live only in memory. */ }\n\n// ─── STATE`
);
html = html
  .replace("<title>Network CRM</title>", "<title>Network.crm Interactive Demo</title>")
  .replace("<body>", `<body>\n<div class="demo-mode-banner"><strong>Interactive demo</strong> · All people, companies, and notes are fictional. Changes reset on refresh.</div>`)
  .replace("</head>", `<style>\n.demo-mode-banner{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;background:#173e38;color:#fff;border:1px solid rgba(255,255,255,.2);box-shadow:0 8px 30px rgba(0,0,0,.18);border-radius:7px;padding:8px 13px;font:12px 'DM Sans',sans-serif;white-space:nowrap}.demo-mode-banner strong{color:#9ed9ce}@media(max-width:700px){.demo-mode-banner{max-width:calc(100vw - 20px);white-space:normal;text-align:center}}\n</style>\n</head>`)
  .replace('<script src="/text-summary-review.js"></script>', "")
  .replace('<script src="/cloud-sync.js"></script>', '<script src="./demo-overrides.js"></script>');

html = html.replace(/[ \t]+$/gm, "");
fs.writeFileSync(outputPath, html);
console.log(`Built ${path.relative(root, outputPath)} from index.html with ${contacts.length} fictional contacts.`);
