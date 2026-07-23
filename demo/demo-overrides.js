(function () {
  const demoBusinessContext = "Andre helps established organizations identify practical AI opportunities, improve manual workflows, and build team confidence through relevant enablement.";

  window.getBusinessHqContext = async () => demoBusinessContext;
  window.openSettingsModal = () => toast("Sync settings are disabled in the public demo");
  window.openSwitchModal = () => toast("Dataset switching is disabled in the public demo");
  window.exportData = () => toast("Export is disabled in the public demo");
  window.openImportModal = () => toast("Import is disabled in the public demo");
  window.openGmailComposeWithSignature = () => toast("Demo only — no Gmail draft was created");

  window.getAI = async function getDemoAI(id) {
    const c = contacts.find((contact) => contact.id === id);
    const output = document.getElementById("aiOut");
    if (!c || !output) return;
    output.innerHTML = '<div class="dot-pulse"><span></span><span></span><span></span></div>';
    await new Promise((resolve) => setTimeout(resolve, 500));
    const clientAngle = c.clientFitTier <= 2
      ? `Explore one concrete workflow at ${esc(c.company)} where manual coordination or knowledge lookup is slowing the team down.`
      : "Lead with curiosity and relationship-building rather than treating this as a client conversation.";
    output.innerHTML = `<div class="ai-out"><strong>Best angle</strong><br>${clientAngle}<br><br><strong>Ask</strong><br>What work still depends on spreadsheets, email, or one person’s know-how?<br><br><strong>Repeatable description</strong><br>Andre helps established teams figure out where AI is genuinely useful, then builds or teaches what fits.</div>`;
  };

  window.genReconnectEmail = async function generateDemoReconnect(contactId) {
    const c = contacts.find((contact) => contact.id === contactId);
    if (!c) return;
    _tyState = { contactId, mode: "reconnect" };
    document.getElementById("thankYouModal").classList.add("open");
    document.getElementById("tyModalTitle").textContent = "Would love to reconnect!";
    document.getElementById("tyFlavorControls").style.display = "none";
    document.getElementById("tyContactLabel").textContent = `To: ${c.email} · Fictional demo contact`;
    document.getElementById("thankYouModalTA").value = `Subject: Checking in

Hey ${c.firstName},

I’ve been meaning to reach out and see how you’re doing. I’d love to hear how things are going at ${c.company} and what you’ve been working on.

On my side, I’ve started helping organizations figure out where AI can make work easier in practical, useful ways. There’s a quick overview at https://andremosk.com. I’d also be curious to hear how AI is showing up in your world, if at all.

Open to catching up sometime in the next few weeks? Feel free to find a slot in my Calendly below.

Best Regards,
Andre
Website: https://andremosk.com
Calendly: https://calendly.com/andre-moskowitz/30min`;
    document.getElementById("tyLoading").style.display = "none";
    document.getElementById("tyError").style.display = "none";
  };

  document.querySelectorAll('[onclick="openSettingsModal()"], [onclick="openSwitchModal()"], [onclick="exportData()"], [onclick="openImportModal()"]').forEach((element) => {
    element.title = "Disabled in public demo";
  });
})();
