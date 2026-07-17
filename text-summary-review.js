(function () {
  let pendingSummaries = [];
  let pendingConversations = [];
  let pendingCreateKey = null;
  let contactChoices = new Map();

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
        @media (max-width:700px) {
          .text-review-trigger { grid-column:auto; grid-row:auto; }
          .text-review-controls { grid-template-columns:1fr; }
          .text-review-actions { justify-content:flex-start; }
        }
      `;
      document.head.appendChild(style);
    }

    if (!document.getElementById("textReviewBtn")) {
      const button = document.createElement("button");
      button.id = "textReviewBtn";
      button.className = "btn btn-ghost text-review-trigger";
      button.title = "Text Review";
      button.setAttribute("aria-label", "Open Text Review");
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
    const count = pendingSummaries.length + pendingConversations.length;
    const badge = document.getElementById("textReviewBadge");
    if (badge) {
      badge.textContent = String(count);
      badge.classList.toggle("visible", count > 0);
    }
    const button = document.getElementById("textReviewBtn");
    if (button) button.title = count ? `Text Review · ${count} pending` : "Text Review";
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

  function renderTextReviewModal() {
    ensureTextReviewUi();
    const content = document.getElementById("textReviewContent");
    if (!content) return;
    const total = pendingSummaries.length + pendingConversations.length;
    content.innerHTML = `<div class="text-review-header">
      <div><h2 style="margin:0">Text Review</h2><div class="text-summary-subtitle">Match conversations and approve durable CRM updates</div></div>
      <button class="btn btn-ghost btn-sm" onclick="closeTextReview()" aria-label="Close">×</button>
    </div>
    ${total ? `
      ${pendingConversations.length ? `<section class="text-review-section"><div class="text-review-section-title"><span>Needs matching</span><span>${pendingConversations.length}</span></div><div class="text-review-list">${pendingConversations.map(renderConversation).join("")}</div></section>` : ""}
      ${pendingSummaries.length ? `<section class="text-review-section"><div class="text-review-section-title"><span>Summary review</span><span>${pendingSummaries.length}</span></div><div class="text-review-list">${pendingSummaries.map(renderSummary).join("")}</div></section>` : ""}
      <datalist id="textReviewContacts">${buildContactChoices()}</datalist>
    ` : `<div class="text-review-empty">No text conversations need attention.</div>`}`;
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
      const response = await fetch("/api/crm/text-summaries", { cache: "no-store" });
      if (response.status === 401) return;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || "Could not load Text Review.");
      pendingSummaries = Array.isArray(data.summaries) ? data.summaries : [];
      pendingConversations = Array.isArray(data.conversations) ? data.conversations : [];
      updateBadge();
      if (document.getElementById("textReviewModal")?.classList.contains("open")) renderTextReviewModal();
      const signature = pendingConversations.map((item) => item.conversation_key).sort().join(",");
      if (signature && localStorage.getItem("network_crm_text_notice") !== signature) {
        localStorage.setItem("network_crm_text_notice", signature);
        if (typeof window.toast === "function") window.toast(`${pendingConversations.length} text conversation${pendingConversations.length === 1 ? "" : "s"} need review`);
      }
    } catch (error) {
      console.warn("Text Review unavailable:", error);
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

  async function patchReview(body) {
    const response = await fetch("/api/crm/text-summaries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || "Could not update Text Review.");
    return data;
  }

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
