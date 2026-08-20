(function () {
  let engagementFilter = 'open';
  let newContactIds = [];

  const style = document.createElement('style');
  style.textContent = `
    #engagementsView { overflow:auto; }
    .eng-list-head,.eng-list-row { display:grid;grid-template-columns:minmax(220px,1.5fr) minmax(150px,.9fr) 132px minmax(220px,1.35fr) 120px;gap:14px;align-items:center;padding:0 22px; }
    .eng-list-head { height:44px;border-bottom:1px solid var(--border);color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;position:sticky;top:0;background:var(--bg);z-index:2; }
    .eng-list-row { min-height:70px;border-bottom:1px solid var(--border);cursor:pointer;background:var(--surface); }
    .eng-list-row:hover,.eng-list-row.selected { background:var(--surface2); }
    .eng-title { font-size:13px;font-weight:650;color:var(--text); }
    .eng-subtle { font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .eng-status { display:inline-flex;align-items:center;width:max-content;padding:5px 8px;border-radius:6px;background:#e5f1ee;color:#176d62;font-size:11px;font-weight:650; }
    .eng-status.closed { background:#edf0ef;color:#68736f; }
    .eng-status.on_hold { background:#f4eee0;color:#86631b; }
    .eng-date { font-size:12px;color:var(--muted); }
    .eng-date.overdue { color:#b74343;font-weight:650; }
    .eng-detail-content { overflow:auto;padding:26px 30px 60px; }
    .eng-detail-shell { max-width:1040px;margin:0 auto; }
    .eng-detail-heading { display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:24px; }
    .eng-detail-title { font-family:'DM Serif Display',serif;font-size:30px;line-height:1.15;margin:0 0 4px; }
    .eng-org { color:var(--muted);font-size:14px; }
    .eng-focus-grid { display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.8fr);gap:18px;margin-bottom:22px; }
    .eng-section { border-top:1px solid var(--border);padding:18px 0;margin-top:4px; }
    .eng-section-title { color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:9px; }
    .eng-focus { background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:16px; }
    .eng-focus textarea { min-height:108px; }
    .eng-milestone { border-left:3px solid var(--accent);padding:4px 0 4px 14px; }
    .eng-form-grid { display:grid;grid-template-columns:1fr 1fr;gap:14px; }
    .eng-contact-list,.eng-link-list { display:flex;gap:7px;flex-wrap:wrap; }
    .eng-contact-chip,.eng-link { border:1px solid var(--border);background:var(--surface);border-radius:6px;padding:7px 9px;font-size:12px;color:var(--text);text-decoration:none; }
    button.eng-contact-chip { cursor:pointer; }
    .eng-add-contact { display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:8px;max-width:520px;margin-top:10px; }
    .eng-notes { display:flex;flex-direction:column;gap:0; }
    .eng-note { border-left:2px solid #b8d9d2;padding:2px 0 18px 15px;position:relative; }
    .eng-note-date { color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:7px; }
    .eng-note-body { font-size:13px;line-height:1.6; }
    .eng-note-delete { position:absolute;right:0;top:-3px;border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:12px; }
    .eng-rich-note { min-height:94px;border:1px solid var(--border);border-radius:0 0 7px 7px;padding:12px;background:var(--surface);outline:none; }
    .eng-modal-actions { display:flex;justify-content:flex-end;gap:8px;margin-top:20px; }
    @media(max-width:900px) {
      .eng-list-head { display:none; }
      .eng-list-row { grid-template-columns:1fr auto;padding:15px 16px;gap:7px; }
      .eng-list-row > :nth-child(2),.eng-list-row > :nth-child(4) { grid-column:1; }
      .eng-list-row > :nth-child(3) { grid-row:1;grid-column:2; }
      .eng-list-row > :nth-child(5) { grid-row:2;grid-column:2; }
      .eng-focus-grid,.eng-form-grid { grid-template-columns:1fr; }
      .eng-detail-content { padding:18px 16px 48px; }
      .eng-detail-heading { flex-direction:column; }
    }
  `;
  document.head.appendChild(style);

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function findEngagement(id) {
    return engagements.find(item => String(item.id) === String(id));
  }

  function statusOptions(selected) {
    return window.EngagementCore.STATUSES.map(([value, label]) =>
      `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`
    ).join('');
  }

  function statusBadge(status) {
    return `<span class="eng-status ${esc(status)}">${esc(window.EngagementCore.STATUS_LABELS[status] || status)}</span>`;
  }

  function contactFor(id) {
    return contacts.find(contact => String(contact.id) === String(id));
  }

  function contactOptions() {
    return [...contacts].sort((a, b) => a.name.localeCompare(b.name)).map(contact =>
      `<option value="${esc(contact.name)} [${esc(String(contact.id))}]">${esc(contact.company || '')}</option>`
    ).join('');
  }

  function parseContactChoice(value) {
    const match = String(value || '').match(/\[([^\]]+)\]\s*$/);
    if (match && contactFor(match[1])) return Number(match[1]) || match[1];
    const normalized = String(value || '').trim().toLowerCase();
    const exact = contacts.find(contact => contact.name.toLowerCase() === normalized);
    return exact ? exact.id : null;
  }

  function contactChips(ids, removable) {
    if (!ids.length) return '<span class="eng-subtle">No linked people</span>';
    return ids.map(id => {
      const contact = contactFor(id);
      if (!contact) return `<span class="eng-contact-chip">Contact ${esc(String(id))}</span>`;
      if (removable) return `<span class="eng-contact-chip">${esc(contact.name)} <button style="border:0;background:transparent;cursor:pointer;color:var(--muted)" title="Remove" onclick="removeNewContact('${esc(String(id))}')">&times;</button></span>`;
      return `<button class="eng-contact-chip" onclick="openEngagementContact('${esc(String(id))}')">${esc(contact.name)}</button>`;
    }).join('');
  }

  function safeLinks(value) {
    return String(value || '').split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => {
      const separator = line.indexOf('|');
      const label = separator > 0 ? line.slice(0, separator).trim() : line.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const rawUrl = separator > 0 ? line.slice(separator + 1).trim() : line;
      try {
        const url = new URL(rawUrl);
        if (!['http:', 'https:'].includes(url.protocol)) return '';
        return `<a class="eng-link" href="${esc(url.href)}" target="_blank" rel="noopener">${esc(label)}</a>`;
      } catch (_) { return ''; }
    }).filter(Boolean).join('');
  }

  function safeRichHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    template.content.querySelectorAll('script,style,iframe,object,embed,img').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
      [...node.attributes].forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const unsafeUrl = ['href', 'src'].includes(name) && /^\s*javascript:/i.test(attribute.value);
        if (name.startsWith('on') || unsafeUrl) node.removeAttribute(attribute.name);
      });
    });
    return template.innerHTML;
  }

  window.renderEngagements = function renderEngagements() {
    const query = document.getElementById('searchInput').value.toLowerCase().trim();
    const visible = window.EngagementCore.sort(engagements).filter(item => {
      if (engagementFilter === 'open' && item.status === 'closed') return false;
      if (engagementFilter !== 'all' && engagementFilter !== 'open' && item.status !== engagementFilter) return false;
      if (!query) return true;
      return [item.title, item.organization, item.currentState, item.opportunity, item.nextMilestone]
        .join(' ').toLowerCase().includes(query);
    });
    document.getElementById('statShowing').textContent = visible.length;
    document.getElementById('statTotal').textContent = engagements.length;
    renderEngagementSidebar();
    const view = document.getElementById('engagementsView');
    if (!visible.length) {
      view.innerHTML = `<div class="empty-list"><div style="font-size:28px;color:var(--muted)">No engagements here</div><div style="font-size:12px;color:var(--muted)">Use Add Engagement to create one.</div></div>`;
      return;
    }
    view.innerHTML = `<div class="eng-list-head"><div>Engagement</div><div>Organization</div><div>Status</div><div>Next milestone</div><div>Date</div></div>
      ${visible.map(item => {
        const overdue = item.nextMilestoneDate && item.nextMilestoneDate < today() && item.status !== 'closed';
        return `<div class="eng-list-row ${String(item.id) === String(selectedEngagementId) ? 'selected' : ''}" onclick="openEngagementDetail('${esc(String(item.id))}')">
          <div><div class="eng-title">${esc(item.title || 'Untitled engagement')}</div><div class="eng-subtle">${esc(item.currentState || 'No current state yet')}</div></div>
          <div class="eng-subtle">${esc(item.organization || '—')}</div>
          <div>${statusBadge(item.status)}</div>
          <div class="eng-subtle">${esc(item.nextMilestone || 'Needs a next milestone')}</div>
          <div class="eng-date ${overdue ? 'overdue' : ''}">${fmtDate(item.nextMilestoneDate)}</div>
        </div>`;
      }).join('')}`;
  };

  function renderEngagementSidebar() {
    const filters = [['open', 'Open'], ['all', 'All'], ...window.EngagementCore.STATUSES];
    document.getElementById('engagementsSidebar').innerHTML = `<div class="sidebar-section"><div class="sidebar-label">Engagements</div>
      ${filters.map(([value, label]) => {
        const count = value === 'all' ? engagements.length : value === 'open' ? engagements.filter(item => item.status !== 'closed').length : engagements.filter(item => item.status === value).length;
        return `<button class="tier-btn ${engagementFilter === value ? 'active' : ''}" onclick="setEngagementFilter('${value}')"><span class="tier-dot" style="background:${value === 'closed' ? '#87928e' : '#2f9185'}"></span>${esc(label)}<span class="tier-count">${count}</span></button>`;
      }).join('')}</div>`;
  }

  window.setEngagementFilter = function setEngagementFilter(value) {
    engagementFilter = value;
    renderEngagements();
    toggleMobileFilters(true);
  };

  window.openAddEngagementModal = function openAddEngagementModal() {
    newContactIds = [];
    document.getElementById('addEngagementContent').innerHTML = `<h2 style="margin-bottom:18px">Add engagement</h2>
      <div class="eng-form-grid">
        <label class="form-group"><span class="form-label">Title</span><input class="form-input" id="engNewTitle" autofocus></label>
        <label class="form-group"><span class="form-label">Organization / client</span><input class="form-input" id="engNewOrg"></label>
        <label class="form-group"><span class="form-label">Status</span><select class="form-input" id="engNewStatus">${statusOptions('pursuit')}</select></label>
        <label class="form-group"><span class="form-label">Next milestone date</span><input class="form-input" type="date" id="engNewDate"></label>
      </div>
      <label class="form-group"><span class="form-label">Current state</span><textarea class="form-input" id="engNewState" rows="3"></textarea></label>
      <label class="form-group"><span class="form-label">Opportunity / problem</span><textarea class="form-input" id="engNewOpportunity" rows="3"></textarea></label>
      <div class="eng-form-grid">
        <label class="form-group"><span class="form-label">Next milestone</span><input class="form-input" id="engNewMilestone"></label>
        <label class="form-group"><span class="form-label">Commercial hypothesis / estimate</span><input class="form-input" id="engNewCommercial"></label>
      </div>
      <label class="form-group"><span class="form-label">Drive / working-document links</span><textarea class="form-input" id="engNewLinks" rows="2" placeholder="Label | https://..."></textarea></label>
      <div class="form-group"><span class="form-label">Linked people</span><div class="eng-contact-list" id="engNewContactChips"><span class="eng-subtle">No linked people</span></div>
        <div class="eng-add-contact"><input class="form-input" id="engNewContact" list="engContactOptions" placeholder="Search contacts"><button class="btn btn-ghost" type="button" onclick="addNewEngagementContact()">Add</button></div>
        <datalist id="engContactOptions">${contactOptions()}</datalist>
      </div>
      <div class="eng-modal-actions"><button class="btn btn-ghost" onclick="closeAddEngagementModal()">Cancel</button><button class="btn btn-primary" onclick="saveNewEngagement()">Create engagement</button></div>`;
    document.getElementById('addEngagementModal').classList.add('open');
  };

  window.closeAddEngagementModal = function closeAddEngagementModal() {
    document.getElementById('addEngagementModal').classList.remove('open');
  };

  window.addNewEngagementContact = function addNewEngagementContact() {
    const input = document.getElementById('engNewContact');
    const id = parseContactChoice(input.value);
    if (!id) { toast('Choose a contact from the list.'); return; }
    if (!newContactIds.some(value => String(value) === String(id))) newContactIds.push(id);
    input.value = '';
    document.getElementById('engNewContactChips').innerHTML = contactChips(newContactIds, true);
  };

  window.removeNewContact = function removeNewContact(id) {
    newContactIds = newContactIds.filter(value => String(value) !== String(id));
    document.getElementById('engNewContactChips').innerHTML = contactChips(newContactIds, true);
  };

  window.saveNewEngagement = function saveNewEngagement() {
    const title = document.getElementById('engNewTitle').value.trim();
    if (!title) { toast('Please enter a title.'); return; }
    const maxId = engagements.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
    const id = cloudSyncReady && window.CloudSyncCore ? window.CloudSyncCore.createTemporaryId(engagements) : maxId + 1;
    const item = window.EngagementCore.withDefaults({
      id,
      _syncPendingCreate: cloudSyncReady,
      title,
      organization: document.getElementById('engNewOrg').value.trim(),
      status: document.getElementById('engNewStatus').value,
      currentState: document.getElementById('engNewState').value.trim(),
      opportunity: document.getElementById('engNewOpportunity').value.trim(),
      commercial: document.getElementById('engNewCommercial').value.trim(),
      nextMilestone: document.getElementById('engNewMilestone').value.trim(),
      nextMilestoneDate: document.getElementById('engNewDate').value,
      contactIds: newContactIds,
      links: document.getElementById('engNewLinks').value.trim(),
      createdDate: today(),
      updatedDate: today()
    });
    engagements.push(item);
    saveEngagements(engagements);
    closeAddEngagementModal();
    renderEngagements();
    openEngagementDetail(id);
  };

  window.openEngagementDetail = function openEngagementDetail(id) {
    selectedEngagementId = Number(id) || id;
    const item = findEngagement(id);
    if (!item) return;
    document.getElementById('engagementDetailPanel').classList.add('open');
    renderEngagementDetail(item);
  };

  window.closeEngagementDetail = function closeEngagementDetail() {
    document.getElementById('engagementDetailPanel').classList.remove('open');
    renderEngagements();
  };

  window.updateEngagement = function updateEngagement(id, field, value, rerender) {
    const item = findEngagement(id);
    if (!item) return;
    item[field] = value;
    item.updatedDate = today();
    saveEngagements(engagements);
    if (rerender !== false) {
      renderEngagements();
      renderEngagementDetail(item);
    }
  };

  window.deleteEngagement = function deleteEngagement(id) {
    const item = findEngagement(id);
    if (!item || !confirm(`Delete ${item.title}?`)) return;
    engagements = engagements.filter(value => String(value.id) !== String(id));
    saveEngagements(engagements);
    selectedEngagementId = null;
    closeEngagementDetail();
    toast('Engagement deleted.');
  };

  window.openEngagementContact = function openEngagementContact(id) {
    const contact = contactFor(id);
    if (!contact) { toast('That contact is no longer available.'); return; }
    switchView('contacts');
    openDetail(contact.id);
  };

  window.addEngagementContact = function addEngagementContact(id) {
    const item = findEngagement(id);
    const input = document.getElementById('engDetailContact');
    const contactId = parseContactChoice(input.value);
    if (!item || !contactId) { toast('Choose a contact from the list.'); return; }
    if (!item.contactIds.some(value => String(value) === String(contactId))) item.contactIds.push(contactId);
    input.value = '';
    item.updatedDate = today();
    saveEngagements(engagements);
    renderEngagementDetail(item);
  };

  window.removeEngagementContact = function removeEngagementContact(id, contactId) {
    const item = findEngagement(id);
    if (!item) return;
    item.contactIds = item.contactIds.filter(value => String(value) !== String(contactId));
    item.updatedDate = today();
    saveEngagements(engagements);
    renderEngagementDetail(item);
  };

  window.addEngagementNote = function addEngagementNote(id) {
    const item = findEngagement(id);
    const editor = document.getElementById('engNoteEditor');
    const html = editor.innerHTML.trim();
    if (!item || !html || html === '<br>') { toast('Add a note first.'); return; }
    item.notes.push({ id: `note-${Date.now()}`, date: today(), html });
    item.updatedDate = today();
    saveEngagements(engagements);
    renderEngagementDetail(item);
  };

  window.deleteEngagementNote = function deleteEngagementNote(id, noteId) {
    const item = findEngagement(id);
    if (!item) return;
    item.notes = item.notes.filter(note => String(note.id) !== String(noteId));
    item.updatedDate = today();
    saveEngagements(engagements);
    renderEngagementDetail(item);
  };

  function renderEngagementDetail(item) {
    const links = safeLinks(item.links);
    const notes = [...item.notes].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    document.getElementById('engagementDetailPanel').innerHTML = `<div class="detail-topbar"><button class="back-btn" onclick="closeEngagementDetail()">← Back</button><span style="font-size:13px;color:var(--muted)">${esc(item.organization || item.title)}</span><span style="flex:1"></span><button class="btn btn-ghost btn-sm" style="color:#b74343;border-color:#d9b0b0" onclick="deleteEngagement('${esc(String(item.id))}')">Delete</button></div>
      <div class="eng-detail-content"><div class="eng-detail-shell">
        <div class="eng-detail-heading"><div><input class="form-input eng-detail-title" value="${esc(item.title)}" onblur="updateEngagement('${esc(String(item.id))}','title',this.value)"><input class="form-input eng-org" value="${esc(item.organization)}" placeholder="Organization / client" onblur="updateEngagement('${esc(String(item.id))}','organization',this.value)"></div><select class="form-input" style="width:170px" onchange="updateEngagement('${esc(String(item.id))}','status',this.value)">${statusOptions(item.status)}</select></div>
        <div class="eng-focus-grid">
          <div class="eng-focus"><div class="eng-section-title">Current state</div><textarea class="form-input" onblur="updateEngagement('${esc(String(item.id))}','currentState',this.value,false)">${esc(item.currentState)}</textarea></div>
          <div class="eng-focus"><div class="eng-section-title">Next milestone</div><div class="eng-milestone"><input class="form-input" value="${esc(item.nextMilestone)}" placeholder="Define the next milestone" onblur="updateEngagement('${esc(String(item.id))}','nextMilestone',this.value,false)"><input class="form-input" type="date" value="${esc(item.nextMilestoneDate)}" style="margin-top:8px" onchange="updateEngagement('${esc(String(item.id))}','nextMilestoneDate',this.value)"></div></div>
        </div>
        <div class="eng-form-grid eng-section"><label class="form-group"><span class="form-label">Opportunity / problem</span><textarea class="form-input" rows="4" onblur="updateEngagement('${esc(String(item.id))}','opportunity',this.value,false)">${esc(item.opportunity)}</textarea></label><label class="form-group"><span class="form-label">Commercial hypothesis / estimate</span><textarea class="form-input" rows="4" onblur="updateEngagement('${esc(String(item.id))}','commercial',this.value,false)">${esc(item.commercial)}</textarea></label></div>
        <div class="eng-section"><div class="eng-section-title">Linked people</div><div class="eng-contact-list">${item.contactIds.length ? item.contactIds.map(contactId => { const contact = contactFor(contactId); return `<span class="eng-contact-chip"><button style="border:0;background:transparent;padding:0;cursor:pointer;color:inherit" onclick="openEngagementContact('${esc(String(contactId))}')">${esc(contact ? contact.name : `Contact ${contactId}`)}</button><button style="border:0;background:transparent;cursor:pointer;color:var(--muted)" title="Remove" onclick="removeEngagementContact('${esc(String(item.id))}','${esc(String(contactId))}')">&times;</button></span>`; }).join('') : '<span class="eng-subtle">No linked people</span>'}</div><div class="eng-add-contact"><input class="form-input" id="engDetailContact" list="engDetailContactOptions" placeholder="Search contacts"><button class="btn btn-ghost" onclick="addEngagementContact('${esc(String(item.id))}')">Add</button></div><datalist id="engDetailContactOptions">${contactOptions()}</datalist></div>
        <div class="eng-section"><div class="eng-section-title">Drive / working documents</div><div class="eng-link-list">${links || '<span class="eng-subtle">No working links</span>'}</div><textarea class="form-input" rows="3" style="margin-top:10px" placeholder="Label | https://..." onblur="updateEngagement('${esc(String(item.id))}','links',this.value,false)">${esc(item.links)}</textarea></div>
        <div class="eng-section"><div class="eng-section-title">Notes timeline</div><div class="rt-toolbar"><button class="rt-btn" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button><button class="rt-btn" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button><button class="rt-btn" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')">•</button></div><div class="eng-rich-note" id="engNoteEditor" contenteditable="true"></div><div style="display:flex;justify-content:flex-end;margin:8px 0 18px"><button class="btn btn-primary btn-sm" onclick="addEngagementNote('${esc(String(item.id))}')">Add note</button></div><div class="eng-notes">${notes.length ? notes.map(note => `<div class="eng-note"><button class="eng-note-delete" title="Delete note" onclick="deleteEngagementNote('${esc(String(item.id))}','${esc(String(note.id))}')">Delete</button><div class="eng-note-date">${fmtDate(note.date)}</div><div class="eng-note-body">${safeRichHtml(note.html)}</div></div>`).join('') : '<div class="eng-subtle">No notes yet</div>'}</div></div>
      </div></div>`;
  }
})();
