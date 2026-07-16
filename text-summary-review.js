(function () {
  let pending = [];

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
    if (Number.isNaN(date.getTime())) return "Recent text exchange";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function forContact(contactId) {
    return pending.filter((item) => String(item.contact_id) === String(contactId));
  }

  window.renderTextSummarySection = function renderTextSummarySection(contactId) {
    const items = forContact(contactId);
    if (!items.length) return "";
    return `<section class="text-summary-review" aria-label="Text summaries awaiting review">
      <div class="text-summary-heading">
        <div>
          <div class="sec-title" style="margin:0">Text summaries</div>
          <div class="text-summary-subtitle">Review before adding these to Notes</div>
        </div>
        <span class="text-summary-count">${items.length}</span>
      </div>
      ${items.map((item) => `<article class="text-summary-draft" data-summary-id="${item.id}">
        <div class="text-summary-meta">${escapeHtml(formatDate(item.conversation_ended_at))} · ${Number(item.message_count) || 0} messages</div>
        <textarea class="text-summary-editor" id="textSummary_${item.id}" aria-label="Edit text summary">${escapeHtml(item.summary)}</textarea>
        <div class="text-summary-actions">
          <button class="btn btn-ghost btn-sm" onclick="dismissTextSummary(${item.id})">Dismiss</button>
          <button class="btn btn-primary btn-sm" onclick="approveTextSummary(${item.id}, ${JSON.stringify(String(contactId))})">Add to Notes</button>
        </div>
      </article>`).join("")}
    </section>`;
  };

  function refreshOpenContact(contactId) {
    if (typeof window.openDetail === "function") window.openDetail(Number(contactId));
  }

  window.loadTextSummaries = async function loadTextSummaries() {
    try {
      const response = await fetch("/api/crm/text-summaries", { cache: "no-store" });
      if (response.status === 401) return;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || "Could not load text summaries.");
      pending = Array.isArray(data.summaries) ? data.summaries : [];
    } catch (error) {
      console.warn("Text summaries unavailable:", error);
    }
  };

  async function review(id, action, summary) {
    const response = await fetch("/api/crm/text-summaries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, summary })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || "Could not review this summary.");
    pending = pending.filter((item) => Number(item.id) !== Number(id));
    return data;
  }

  window.approveTextSummary = async function approveTextSummary(id, contactId) {
    const editor = document.getElementById(`textSummary_${id}`);
    const summary = editor?.value.trim() || "";
    if (!summary) return;
    try {
      await review(id, "approve", summary);
      if (typeof window.refreshCloudState === "function") await window.refreshCloudState();
      refreshOpenContact(contactId);
      if (typeof window.toast === "function") window.toast("Text summary added to Notes");
    } catch (error) {
      if (typeof window.toast === "function") window.toast(error.message);
    }
  };

  window.dismissTextSummary = async function dismissTextSummary(id) {
    const item = pending.find((candidate) => Number(candidate.id) === Number(id));
    try {
      await review(id, "dismiss");
      if (item) refreshOpenContact(item.contact_id);
      if (typeof window.toast === "function") window.toast("Text summary dismissed");
    } catch (error) {
      if (typeof window.toast === "function") window.toast(error.message);
    }
  };
})();
