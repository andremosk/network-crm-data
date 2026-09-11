(function () {
  let pendingSummaries = [];
  let pendingConversations = [];
  let pendingProposals = [];
  let pendingCreateKey = null;
  let contactChoices = new Map();
  let emailReviewStatus = null;
  let emailReviewBusy = "";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recent exchange";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function allContacts() {
    try {
      return Array.isArray(contacts) ? contacts : [];
    } catch {
      return [];
    }
  }

  function contactById(id) {
    return allContacts().find((contact) => String(contact.id) === String(id));
  }

  function summariesForContact(contactId) {
    return pendingSummaries.filter((item) => String(item.contact_id) === String(contactId));
  }

  function ensureTextReviewUi() {
    if (!document.getElementById("textReviewStyles")) {
      const style = document.createElement("style");
      style.id = "textReviewStyles";
      style.textContent = `
        .text-review-trigger { position:relative; min-width:42px; padding:7px 10px; }
        .text-review-badge { position:absolute; top:-6px; right:-6px; min-width:18px; height:18px; padding:0 5px; display:none; align-items:center; justify-content:center; border:2px solid var(--surface); border-radius:9px; background:#b44b4b; color:#fff; font-size:10px; font-weight:700; }
        .text-review-badge.visible { display:inline-flex; }
        .text-review-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
        .text-review-header-actions { display:flex; gap:7px; align-items:center; }
        .text-review-header-actions button[disabled] { cursor:wait; opacity:.65; }
        .email-review-status { margin:-5px 0 14px; padding:9px 11px; border:1px solid var(--border); border-radius:6px; background:var(--surface2); color:var(--muted); font-size:12px; line-height:1.45; }
        .email-review-status.error { border-color:#e6c1c1; background:#fff7f7; color:#a33f3f; }
        .text-review-section { padding:14px 0; border-top:1px solid var(--border); }
        .text-review-section:first-of-type { border-top:0; }
        .text-review-section-title { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; font-size:12px; font-weight:700; }
        .text-review-list { border-top:1px solid var(--border); }
        .text-review-row { padding:14px 0; border-bottom:1px solid var(--border); }
        .text-review-row-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .text-review-name { font-size:14px; font-weight:700; }
        .text-review-meta { color:var(--muted); font-size:11px; margin-top:2px; }
        .text-review-controls { display:grid; grid-template-columns:minmax(180px,1fr) auto; gap:8px; margin-top:10px; }
        .text-review-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; margin-top:9px; }
        .text-review-empty { padding:30px 10px; text-align:center; color:var(--muted); font-size:13px; }
        .text-review-contact { color:var(--muted); font-size:12px; }
        .text-review-summary { width:100%; min-height:74px; margin-top:9px; resize:vertical; padding:10px 12px; border:1px solid var(--border); border-radius:7px; background:var(--surface2); color:var(--text); font:13px/1.55 'DM Sans',sans-serif; outline:none; }
        .text-review-summary:focus { border-color:var(--accent); }
        .communication-review-labels { display:flex; flex-wrap:wrap; gap:6px; margin-top:5px; }
        .communication-review-label { padding:2px 7px; border:1px solid var(--border); border-radius:4px; color:var(--muted); font-size:10px; font-weight:700; text-transform:uppercase; }
        .communication-review-evidence { margin-top:10px; color:var(--text); font-size:13px; line-height:1.55; }
        .communication-review-fields { margin-top:10px; padding:12px; border:1px solid var(--border); border-radius:7px; background:var(--surface2); }
        .communication-review-fields summary { cursor:pointer; color:var(--muted); font-size:11px; font-weight:700; }
        .communication-review-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }
        .communication-review-grid .wide { grid-column:1 / -1; }
        .communication-review-field label { display:block; margin-bottom:4px; color:var(--muted); font-size:10px; font-weight:700; text-transform:uppercase; }
        @media (max-width:700px) {
          .text-review-trigger { grid-column:auto; grid-row:auto; }
          .text-review-controls { grid-template-columns:1fr; }
          .text-review-actions { justify-content:flex-start; }
          .communication-review-grid { grid-template-columns:1fr; }
          .communication-review-grid .wide { grid-column:auto; }
        }
      `;
      document.head.appendChild(style);
    }

    if (!document.getElementById("textReviewBtn")) {
      const button = document.createElement("button");
      button.id = "textReviewBtn";
      button.className = "btn btn-ghost text-review-trigger";
      button.title = "Communication Review";
      button.setAttribute("aria-label", "Open Communication Review");
      button.innerHTML = `<span aria-hidden="true">💬</span><span class="text-review-badge" id="textReviewBadge"></span>`;
      button.onclick = window.openTextReview;
      const anchor = document.getElementById("ghSyncBar");
      anchor?.parentNode?.insertBefore(button, anchor);
    }

    if (!document.getElementById("textReviewModal")) {
      const modal = document.createElement("div");
      modal.className = "modal-overlay";
      modal.id = "textReviewModal";
      modal.onclick = (event) => { if (event.target === modal) window.closeTextReview(); };
      modal.innerHTML = `<div class="modal" style="width:720px;max-height:90vh" id="textReviewContent"></div>`;
      document.body.appendChild(modal);
    }
  }

  function updateBadge() {
    ensureTextReviewUi();
    const count = pendingSummaries.length + pendingConversations.length + pendingProposals.length;
    const badge = document.getElementById("textReviewBadge");
    if (badge) {
      badge.textContent = String(count);
      badge.classList.toggle("visible", count > 0);
    }
    const button = document.getElementById("textReviewBtn");
    if (button) button.title = count ? `Communication Review · ${count} pending` : "Communication Review";
  }

  function buildContactChoices() {
    contactChoices = new Map();
    return allContacts()
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((contact) => {
        const display = `${contact.name || "Unknown"}${contact.company ? ` — ${contact.company}` : ""} [${contact.id}]`;
        contactChoices.set(display, contact.id);
        return `<option value="${escapeHtml(display)}"></option>`;
      })
      .join("");
  }

  function renderConversation(item) {
    return `<div class="text-review-row">
      <div class="text-review-row-head">
        <div>
          <div class="text-review-name">${escapeHtml(item.participant_label)}</div>
          <div class="text-review-meta">Latest text ${escapeHtml(formatDate(item.latest_message_at))}</div>
          <div class="communication-review-labels"><span class="communication-review-label">SMS</span><span class="communication-review-label">Create contact</span></div>
        </div>
      </div>
      <div class="text-review-controls">
        <input class="form-input" id="textMatch_${item.conversation_key}" list="textReviewContacts" placeholder="Search existing contacts">
        <button class="btn btn-primary btn-sm" onclick="matchTextConversation('${item.conversation_key}')">Match</button>
      </div>
      <div class="text-review-actions">
        <button class="btn btn-ghost btn-sm" onclick="createContactFromText('${item.conversation_key}')">Create Contact</button>
        <button class="btn btn-ghost btn-sm" onclick="reviewTextConversation('${item.conversation_key}','dismiss')">Not CRM Relevant</button>
        <button class="btn btn-ghost btn-sm" onclick="reviewTextConversation('${item.conversation_key}','ignore')">Always Ignore</button>
      </div>
    </div>`;
  }

  function renderSummary(item) {
    const contact = contactById(item.contact_id);
    return `<div class="text-review-row">
      <div class="text-review-row-head">
        <div>
          <div class="text-review-name">${escapeHtml(contact?.name || "CRM contact")}</div>
          <div class="text-review-meta">${escapeHtml(formatDate(item.conversation_ended_at))} · ${Number(item.message_count) || 0} messages</div>
          <div class="communication-review-labels"><span class="communication-review-label">SMS</span><span class="communication-review-label">Update contact</span></div>
        </div>
        <div class="text-review-contact">Ready for Notes</div>
      </div>
      <textarea class="text-review-summary" id="textReviewSummary_${item.id}" aria-label="Edit text summary">${escapeHtml(item.summary)}</textarea>
      <div class="text-review-actions">
        <button class="btn btn-ghost btn-sm" onclick="dismissTextSummary(${item.id})">Dismiss</button>
        <button class="btn btn-primary btn-sm" onclick="approveTextSummary(${item.id},'${escapeHtml(String(item.contact_id))}')">Add to Notes</button>
      </div>
    </div>`;
  }

  function proposalTypeLabel(type) {
    return type === "create_contact" ? "Create contact" : type === "update_contact" ? "Update contact" : "No CRM action";
  }

  function renderProposal(item) {
    const proposed = item.proposed || {};
    const create = item.proposal_type === "create_contact";
    const displayName = create ? proposed.name : (item.matched_contact_name || "CRM contact");
    const field = (id, label, value, extra = "") => `<div class="communication-review-field ${extra}"><label for="comm_${id}_${item.id}">${label}</label><input class="form-input" id="comm_${id}_${item.id}" value="${escapeHtml(value)}"></div>`;
    return `<div class="text-review-row" id="communicationProposal_${item.id}">
      <div class="text-review-row-head">
        <div>
          <div class="text-review-name">${escapeHtml(displayName)}</div>
          <div class="text-review-meta">${escapeHtml(formatDate(item.occurred_at))}${item.recipient_email ? ` · ${escapeHtml(item.recipient_email)}` : ""}</div>
          <div class="communication-review-labels"><span class="communication-review-label">Email</span><span class="communication-review-label">${proposalTypeLabel(item.proposal_type)}</span></div>
        </div>
        <div class="text-review-contact">Awaiting approval</div>
      </div>
      <div class="communication-review-evidence">${escapeHtml(item.evidence)}</div>
      <details class="communication-review-fields" open>
        <summary>Proposed CRM fields</summary>
        <div class="communication-review-grid">
          ${create ? `${field("name", "Name", proposed.name)}${field("email", "Email", proposed.email)}${field("company", "Company", proposed.company)}${field("position", "Position", proposed.position)}
          <div class="communication-review-field"><label for="comm_tier_${item.id}">Relationship</label><select class="form-input" id="comm_tier_${item.id}">${[1,2,3,4].map((tier) => `<option value="${tier}" ${Number(proposed.tier) === tier ? "selected" : ""}>T${tier}</option>`).join("")}</select></div>` : ""}
          ${!create && proposed.email ? field("email", "Email to save", proposed.email, "wide") : ""}
          <div class="communication-review-field"><label for="comm_status_${item.id}">Status</label><select class="form-input" id="comm_status_${item.id}"><option value="">No change</option><option value="follow_up" ${proposed.status === "follow_up" ? "selected" : ""}>Follow Up</option></select></div>
          <div class="communication-review-field"><label for="comm_followUpDate_${item.id}">Follow-up date</label><input class="form-input" type="date" id="comm_followUpDate_${item.id}" value="${escapeHtml(proposed.followUpDate)}"></div>
          <div class="communication-review-field wide"><label for="comm_note_${item.id}">Initial note</label><textarea class="text-review-summary" id="comm_note_${item.id}">${escapeHtml(proposed.notes || proposed.note)}</textarea></div>
        </div>
      </details>
      <div class="text-review-actions">
        <button class="btn btn-ghost btn-sm" onclick="ignoreCommunicationProposal(${item.id})">Ignore</button>
        <button class="btn btn-ghost btn-sm" onclick="editCommunicationProposal(${item.id})">Save Edit</button>
        ${item.proposal_type !== "no_action" ? `<button class="btn btn-primary btn-sm" onclick="applyCommunicationProposal(${item.id})">${create ? "Create" : "Apply"}</button>` : ""}
      </div>
    </div>`;
  }

  function renderTextReviewModal() {
    ensureTextReviewUi();
    const content = document.getElementById("textReviewContent");
    if (!content) return;
    const total = pendingSummaries.length + pendingConversations.length + pendingProposals.length;
    content.innerHTML = `<div class="text-review-header">
      <div><h2 style="margin:0">Communication Review</h2><div class="text-summary-subtitle">Review SMS and email proposals before changing the CRM</div></div>
      <div class="text-review-header-actions"><button class="btn btn-ghost btn-sm" id="checkEmailButton" onclick="refreshEmailReview()" ${emailReviewBusy ? "disabled" : ""}>${emailReviewBusy === "review" ? "Checking…" : "Check email"}</button><button class="btn btn-ghost btn-sm" id="findEmailsButton" onclick="enrichContactEmails()" ${emailReviewBusy ? "disabled" : ""}>${emailReviewBusy === "enrichment" ? "Searching…" : "Find missing emails"}</button><button class="btn btn-ghost btn-sm" onclick="closeTextReview()" aria-label="Close">×</button></div>
    </div>
    ${emailReviewStatus ? `<div class="email-review-status ${emailReviewStatus.kind === "error" ? "error" : ""}" id="emailReviewStatus">${escapeHtml(emailReviewStatus.message)}</div>` : ""}
    ${total ? `
      ${pendingConversations.length ? `<section class="text-review-section"><div class="text-review-section-title"><span>Needs matching</span><span>${pendingConversations.length}</span></div><div class="text-review-list">${pendingConversations.map(renderConversation).join("")}</div></section>` : ""}
      ${pendingSummaries.length ? `<section class="text-review-section"><div class="text-review-section-title"><span>Summary review</span><span>${pendingSummaries.length}</span></div><div class="text-review-list">${pendingSummaries.map(renderSummary).join("")}</div></section>` : ""}
      ${pendingProposals.length ? `<section class="text-review-section"><div class="text-review-section-title"><span>Email proposals</span><span>${pendingProposals.length}</span></div><div class="text-review-list">${pendingProposals.map(renderProposal).join("")}</div></section>` : ""}
      <datalist id="textReviewContacts">${buildContactChoices()}</datalist>
    ` : `<div class="text-review-empty">No communications need attention.</div>`}`;
  }

  window.renderTextSummarySection = function renderTextSummarySection(contactId) {
    const items = summariesForContact(contactId);
    if (!items.length) return "";
    return `<section class="text-summary-review" aria-label="Text summaries awaiting review">
      <div class="text-summary-heading"><div><div class="sec-title" style="margin:0">Text summaries</div><div class="text-summary-subtitle">Review before adding these to Notes</div></div><span class="text-summary-count">${items.length}</span></div>
      ${items.map((item) => `<article class="text-summary-draft"><div class="text-summary-meta">${escapeHtml(formatDate(item.conversation_ended_at))} · ${Number(item.message_count) || 0} messages</div><textarea class="text-summary-editor" id="textSummary_${item.id}" aria-label="Edit text summary">${escapeHtml(item.summary)}</textarea><div class="text-summary-actions"><button class="btn btn-ghost btn-sm" onclick="dismissTextSummary(${item.id})">Dismiss</button><button class="btn btn-primary btn-sm" onclick="approveTextSummary(${item.id},'${escapeHtml(String(contactId))}')">Add to Notes</button></div></article>`).join("")}
    </section>`;
  };

  window.loadTextSummaries = async function loadTextSummaries() {
    try {
      const [textResponse, proposalResponse] = await Promise.all([
        fetch("/api/crm/text-summaries", { cache: "no-store" }),
        fetch("/api/crm/communication-proposals", { cache: "no-store" })
      ]);
      if (textResponse.status === 401 || proposalResponse.status === 401) return;
      const [data, proposalData] = await Promise.all([
        textResponse.json().catch(() => ({})), proposalResponse.json().catch(() => ({}))
      ]);
      if (!textResponse.ok) throw new Error(data.error?.message || "Could not load Communication Review.");
      if (!proposalResponse.ok) throw new Error(proposalData.error?.message || "Could not load email proposals.");
      pendingSummaries = Array.isArray(data.summaries) ? data.summaries : [];
      pendingConversations = Array.isArray(data.conversations) ? data.conversations : [];
      pendingProposals = Array.isArray(proposalData.proposals) ? proposalData.proposals : [];
      updateBadge();
      if (document.getElementById("textReviewModal")?.classList.contains("open")) renderTextReviewModal();
      const signature = pendingConversations.map((item) => item.conversation_key).sort().join(",");
      if (signature && localStorage.getItem("network_crm_text_notice") !== signature) {
        localStorage.setItem("network_crm_text_notice", signature);
        if (typeof window.toast === "function") window.toast(`${pendingConversations.length} text conversation${pendingConversations.length === 1 ? "" : "s"} need review`);
      }
    } catch (error) {
      console.warn("Communication Review unavailable:", error);
    }
  };

  window.openTextReview = async function openTextReview() {
    ensureTextReviewUi();
    document.getElementById("textReviewModal")?.classList.add("open");
    renderTextReviewModal();
    await window.loadTextSummaries();
  };

  window.closeTextReview = function closeTextReview() {
    document.getElementById("textReviewModal")?.classList.remove("open");
  };

  window.refreshEmailReview = async function refreshEmailReview() {
    if (emailReviewBusy) return;
    emailReviewBusy = "review";
    emailReviewStatus = { kind: "info", message: "Checking a small recent batch of inbox email against your CRM contacts…" };
    renderTextReviewModal();
    try {
      const response = await fetch("/api/crm/gmail-review-sync", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || "Could not check Gmail.");
      await window.loadTextSummaries();
      const scanned = Number(data.scanned) || 0;
      const skipped = Number(data.skipped) || 0;
      const duplicates = Number(data.duplicates) || 0;
      emailReviewStatus = {
        kind: "info",
        message: data.proposed
          ? `${data.proposed} email proposal${data.proposed === 1 ? " is" : "s are"} ready for review. Checked ${scanned} recent email${scanned === 1 ? "" : "s"}.`
          : `Checked ${scanned} recent email${scanned === 1 ? "" : "s"}. ${skipped} did not meet the direct relationship rules${duplicates ? `; ${duplicates} was already queued` : ""}.`
      };
      if (typeof window.toast === "function") {
        if (data.proposed) {
          window.toast(`${data.proposed} email proposal${data.proposed === 1 ? "" : "s"} ready for review (${scanned} checked)`);
        } else if (scanned) {
          window.toast(`Checked ${scanned} recent emails. No new proposals (${skipped} skipped by the review rules).`);
        } else {
          window.toast("No recent inbox emails found to review.");
        }
      }
    } catch (error) {
      const message = /quota|rate limit/i.test(error.message)
        ? "Gmail is temporarily rate-limited. Try again in about a minute; no CRM records were changed."
        : error.message;
      emailReviewStatus = { kind: "error", message };
      if (typeof window.toast === "function") window.toast(message);
    } finally {
      emailReviewBusy = "";
      renderTextReviewModal();
    }
  };

  window.enrichContactEmails = async function enrichContactEmails() {
    if (emailReviewBusy) return;
    emailReviewBusy = "enrichment";
    emailReviewStatus = { kind: "info", message: "Searching a small archive batch for unique email matches. Suggestions always require review." };
    renderTextReviewModal();
    try {
      const response = await fetch("/api/crm/gmail-email-enrichment", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || "Could not look for missing emails.");
      await window.loadTextSummaries();
      const suffix = data.completed ? " Email archive scan complete." : " More archive messages remain; run again for the next batch.";
      const scanned = Number(data.scanned) || 0;
      const duplicates = Number(data.duplicates) || 0;
      emailReviewStatus = {
        kind: "info",
        message: data.proposed
          ? `${data.proposed} email suggestion${data.proposed === 1 ? " is" : "s are"} ready for review from ${scanned} archive message${scanned === 1 ? "" : "s"}.${suffix}`
          : `No new email suggestions from ${scanned} archive message${scanned === 1 ? "" : "s"}${duplicates ? `; ${duplicates} was already queued` : ""}.${suffix}`
      };
      if (typeof window.toast === "function") {
        window.toast(data.proposed ? `${data.proposed} email suggestion${data.proposed === 1 ? "" : "s"} ready for review.${suffix}` : `No new email suggestions.${suffix}`);
      }
    } catch (error) {
      const message = /quota|rate limit/i.test(error.message)
        ? "Gmail is temporarily rate-limited. Try again in about a minute; no CRM records were changed."
        : error.message;
      emailReviewStatus = { kind: "error", message };
      if (typeof window.toast === "function") window.toast(message);
    } finally {
      emailReviewBusy = "";
      renderTextReviewModal();
    }
  };

  async function patchReview(body) {
    const response = await fetch("/api/crm/text-summaries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || "Could not update Communication Review.");
    return data;
  }

  async function patchCommunicationReview(body) {
    const response = await fetch("/api/crm/communication-proposals", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || "Could not update Communication Review.");
    return data;
  }

  function proposalFromEditor(id) {
    const item = pendingProposals.find((candidate) => Number(candidate.id) === Number(id));
    if (!item) return null;
    const value = (name) => document.getElementById(`comm_${name}_${id}`)?.value.trim() || "";
    const common = { note: value("note"), notes: value("note"), email: value("email"), status: value("status"), followUpDate: value("followUpDate"), lastContact: item.proposed?.lastContact || "" };
    return item.proposal_type === "create_contact" ? {
      ...common, name: value("name"), email: value("email"), company: value("company"), position: value("position"), tier: Number(value("tier")) || 3
    } : common;
  }

  async function completeCommunicationProposal(id, action) {
    const proposed = proposalFromEditor(id);
    const data = await patchCommunicationReview({ id, action, proposed });
    if (action !== "edit") pendingProposals = pendingProposals.filter((item) => Number(item.id) !== Number(id));
    else {
      const item = pendingProposals.find((candidate) => Number(candidate.id) === Number(id));
      if (item) item.proposed = data.proposal || proposed;
    }
    updateBadge();
    renderTextReviewModal();
    return data;
  }

  window.editCommunicationProposal = async function editCommunicationProposal(id) {
    try {
      await completeCommunicationProposal(id, "edit");
      if (typeof window.toast === "function") window.toast("Proposal edits saved");
    } catch (error) { if (typeof window.toast === "function") window.toast(error.message); }
  };

  window.ignoreCommunicationProposal = async function ignoreCommunicationProposal(id) {
    try {
      await completeCommunicationProposal(id, "ignore");
      if (typeof window.toast === "function") window.toast("Communication ignored");
    } catch (error) { if (typeof window.toast === "function") window.toast(error.message); }
  };

  window.applyCommunicationProposal = async function applyCommunicationProposal(id) {
    try {
      const data = await completeCommunicationProposal(id, "apply");
      if (typeof window.refreshCloudState === "function") await window.refreshCloudState();
      if (typeof window.toast === "function") window.toast(data.status === "applied" ? "CRM proposal applied" : "Proposal updated");
    } catch (error) { if (typeof window.toast === "function") window.toast(error.message); }
  };

  window.reviewTextConversation = async function reviewTextConversation(key, action, contactId) {
    try {
      await patchReview({ resource: "conversation", key, action, contactId });
      pendingConversations = pendingConversations.filter((item) => item.conversation_key !== key);
      updateBadge();
      renderTextReviewModal();
      if (typeof window.toast === "function") window.toast(action === "match" ? "Text conversation matched" : action === "ignore" ? "Conversation will stay ignored" : "Conversation dismissed until a new text");
    } catch (error) {
      if (typeof window.toast === "function") window.toast(error.message);
    }
  };

  window.matchTextConversation = function matchTextConversation(key) {
    buildContactChoices();
    const value = document.getElementById(`textMatch_${key}`)?.value || "";
    const contactId = contactChoices.get(value);
    if (!contactId) {
      if (typeof window.toast === "function") window.toast("Choose a contact from the list");
      return;
    }
    window.reviewTextConversation(key, "match", contactId);
  };

  window.createContactFromText = function createContactFromText(key) {
    const item = pendingConversations.find((candidate) => candidate.conversation_key === key);
    if (!item) return;
    pendingCreateKey = key;
    const words = String(item.participant_label || "").trim().split(/\s+/);
    document.getElementById("nFirst").value = words.shift() || "";
    document.getElementById("nLast").value = words.join(" ");
    window.closeTextReview();
    if (typeof window.openAddContactModal === "function") window.openAddContactModal();
  };

  window.completeTextContactCreation = function completeTextContactCreation(contactId) {
    if (!pendingCreateKey) return;
    const key = pendingCreateKey;
    pendingCreateKey = null;
    setTimeout(() => window.reviewTextConversation(key, "match", contactId), 2200);
  };

  async function reviewSummary(id, action, summary) {
    const data = await patchReview({ id, action, summary });
    pendingSummaries = pendingSummaries.filter((item) => Number(item.id) !== Number(id));
    updateBadge();
    renderTextReviewModal();
    return data;
  }

  window.approveTextSummary = async function approveTextSummary(id, contactId) {
    const editor = document.getElementById(`textReviewSummary_${id}`) || document.getElementById(`textSummary_${id}`);
    const summary = editor?.value.trim() || "";
    if (!summary) return;
    try {
      await reviewSummary(id, "approve", summary);
      if (typeof window.refreshCloudState === "function") await window.refreshCloudState();
      if (!document.getElementById("textReviewModal")?.classList.contains("open") && typeof window.openDetail === "function") window.openDetail(Number(contactId));
      if (typeof window.toast === "function") window.toast("Text summary added to Notes");
    } catch (error) {
      if (typeof window.toast === "function") window.toast(error.message);
    }
  };

  window.dismissTextSummary = async function dismissTextSummary(id) {
    try {
      await reviewSummary(id, "dismiss");
      if (typeof window.toast === "function") window.toast("Text summary dismissed");
    } catch (error) {
      if (typeof window.toast === "function") window.toast(error.message);
    }
  };

  ensureTextReviewUi();
})();
