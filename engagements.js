(function () {
  let engagementFilter = 'open';
  let newContactIds = [];
  let newGroupId = '';
  let engagementView = 'forecast';
  let forecastExpanded = new Set();
  let displayedForecast = [];

  const style = document.createElement('style');
  style.textContent = `
    #engagementsView { overflow:auto; }
    .eng-view-tools { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:12px 22px;border-bottom:1px solid var(--border);background:var(--surface); }
    .eng-view-tools > div { display:flex;flex-wrap:wrap;gap:6px;align-items:center; }
    .eng-view-tools [aria-pressed=true] { background:var(--accent);color:white; }
    .eng-forecast-totals { display:flex;flex-wrap:wrap;gap:22px;padding:16px 22px;background:var(--surface2);border-bottom:1px solid var(--border);font-size:12px; }
    .eng-forecast-totals strong { display:block;font-size:20px;margin-top:4px; }
    .eng-forecast-scroll { overflow:auto;padding-bottom:28px; }
    .eng-forecast { width:100%;min-width:1160px;border-collapse:collapse;table-layout:fixed; }
    .eng-forecast th,.eng-forecast td { padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:top;text-align:left;font-size:12px;overflow-wrap:anywhere; }
    .eng-forecast th { background:var(--surface2);font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:0; }
    .eng-forecast td { background:var(--surface); }
    .eng-forecast .form-input { min-width:0;width:100%;padding:6px;font-size:12px; }
    .eng-forecast-title { border:0;padding:0;background:none;text-align:left;font:inherit;font-weight:700;color:var(--accent);cursor:pointer; }
    .eng-forecast small { display:block;margin-top:5px;color:var(--muted);line-height:1.5; }
    .eng-cash-flow { display:flex;flex-wrap:wrap;gap:14px 26px;padding:12px 22px;border-bottom:1px solid var(--border);font-size:12px; }
    .eng-cash-flow span { display:block;color:var(--muted);font-size:11px;margin-bottom:3px; }
    .eng-payment-editor { padding:12px 0; }
    .eng-payment-editor table { width:100%;border-collapse:collapse; }
    .eng-payment-editor th,.eng-payment-editor td { text-align:left;font-size:12px;padding:7px 5px;border-bottom:1px solid var(--border); }
    .eng-payment-editor .form-input { width:100%;min-width:0;font-size:12px; }
    .eng-payment-actions { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:12px; }
    .eng-plan-warning { color:#9a5f16;font-size:12px; }
    .eng-forecast-expanded td { background:var(--surface2); }
    .eng-list-head,.eng-list-row { display:grid;grid-template-columns:minmax(220px,1.5fr) minmax(150px,.9fr) 132px minmax(220px,1.35fr) 120px;gap:14px;align-items:center;padding:0 22px; }
    .eng-list-head { height:44px;border-bottom:1px solid var(--border);color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;position:sticky;top:0;background:var(--bg);z-index:2; }
    .eng-list-row { min-height:70px;border-bottom:1px solid var(--border);cursor:pointer;background:var(--surface); }
    .eng-list-row:hover,.eng-list-row.selected { background:var(--surface2); }
    .eng-title { font-size:13px;font-weight:650;color:var(--text); }
    .eng-subtle { font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .eng-status { display:inline-flex;align-items:center;width:max-content;padding:5px 8px;border-radius:6px;background:#e5f1ee;color:#176d62;font-size:11px;font-weight:650; }
    .eng-status.closed { background:#edf0ef;color:#68736f; }
    .eng-status.on_hold { background:#f4eee0;color:#86631b; }
    .eng-group-badge { display:inline-flex;align-items:center;margin-left:7px;padding:3px 6px;border:1px solid #a9d5cd;border-radius:5px;color:#176d62;background:#eef8f5;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px; }
    .eng-group-rollup { margin:8px 0 20px;border:1px solid var(--border);border-radius:7px;background:var(--surface);overflow:hidden; }
    .eng-group-rollup-row { display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:12px 14px;border:0;border-bottom:1px solid var(--border);background:transparent;text-align:left;color:var(--text);cursor:pointer;font:inherit; }
    .eng-group-rollup-row:last-child { border-bottom:0; }
    .eng-group-rollup-row:hover { background:var(--surface2); }
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

  function groupFor(item) {
    return item.groupId ? findEngagement(item.groupId) : null;
  }

  function childrenForGroup(id) {
    return window.EngagementCore.sort(engagements.filter(item => String(item.groupId) === String(id) && !item.isGroup));
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
      if (item.deleted || item.archived) return false;
      if (engagementFilter === 'open' && (item.status === 'closed' || (engagementView === 'forecast' && item.status === 'on_hold'))) return false;
      if (engagementFilter === 'groups' && !item.isGroup) return false;
      if (engagementFilter === 'ungrouped' && (item.isGroup || item.groupId)) return false;
      if (!['all', 'open', 'groups', 'ungrouped'].includes(engagementFilter) && item.status !== engagementFilter) return false;
      if (!query) return true;
      return [item.title, item.organization, item.currentState, item.opportunity, item.nextMilestone]
        .join(' ').toLowerCase().includes(query);
    });
    document.getElementById('statShowing').textContent = visible.length;
    document.getElementById('statTotal').textContent = engagements.length;
    renderEngagementSidebar();
    const view = document.getElementById('engagementsView');
    const tools = `<div class="eng-view-tools"><div role="group" aria-label="Engagement view"><button class="btn btn-ghost btn-sm" aria-pressed="${engagementView === 'forecast'}" onclick="setEngagementView('forecast')">Forecast</button><button class="btn btn-ghost btn-sm" aria-pressed="${engagementView === 'list'}" onclick="setEngagementView('list')">List</button></div>${engagementView === 'forecast' ? '<div><button class="btn btn-ghost btn-sm" onclick="copyEngagementForecast()">Copy recap</button><button class="btn btn-ghost btn-sm" onclick="downloadEngagementForecast()" title="Download opportunities as CSV">&#8595; CSV</button></div>' : ''}</div>`;
    if (engagementView === 'forecast') {
      displayedForecast = window.EngagementCore.forecastRows(visible, engagementFilter === 'open');
      document.getElementById('statShowing').textContent = displayedForecast.length;
      view.innerHTML = tools + renderForecast(displayedForecast);
      return;
    }
    if (!visible.length) {
      view.innerHTML = tools + `<div class="empty-list"><div style="font-size:28px;color:var(--muted)">No engagements here</div></div>`;
      return;
    }
    view.innerHTML = tools + `<div class="eng-list-head"><div>Engagement</div><div>Organization</div><div>Status</div><div>Next milestone</div><div>Date</div></div>
      ${visible.map(item => {
        const overdue = item.nextMilestoneDate && item.nextMilestoneDate < today() && item.status !== 'closed';
        return `<div class="eng-list-row ${String(item.id) === String(selectedEngagementId) ? 'selected' : ''}" onclick="openEngagementDetail('${esc(String(item.id))}')">
          <div><div class="eng-title">${esc(item.title || 'Untitled engagement')}${item.isGroup ? '<span class="eng-group-badge">Group</span>' : ''}</div><div class="eng-subtle">${item.groupId && groupFor(item) ? `Part of ${esc(groupFor(item).title)} · ` : ''}${esc(item.currentState || 'No current state yet')}</div></div>
          <div class="eng-subtle">${esc(item.organization || '—')}</div>
          <div>${statusBadge(item.status)}</div>
          <div class="eng-subtle">${esc(item.nextMilestone || 'Needs a next milestone')}</div>
          <div class="eng-date ${overdue ? 'overdue' : ''}">${fmtDate(item.nextMilestoneDate)}</div>
        </div>`;
      }).join('')}`;
  };

  window.setEngagementView = function(value) {
    engagementView = value === 'list' ? 'list' : 'forecast';
    if (engagementView === 'forecast' && engagementFilter === 'groups') engagementFilter = 'open';
    renderEngagements();
  };

  function forecastField(item, field, type, value, label) {
    return `<input class="form-input" type="${type}" ${type === 'number' ? 'min="0" step="0.01"' : ''} value="${esc(value == null ? '' : String(value))}" aria-label="${esc(label)} for ${esc(item.title)}" onchange="updateForecastField('${esc(String(item.id))}','${field}',this.value)">`;
  }

  function renderForecast(rows) {
    const core = window.EngagementCore;
    if (!rows.length) return '<div class="empty-list">No opportunities in this view.</div>';
    const known = rows.filter(row => row.expectedFees !== null);
    const sum = list => core.currency(list.reduce((total, amount) => total + Math.round(amount * 100), 0) / 100);
    const flow = core.cashFlow(rows);
    return `<div class="eng-forecast-totals"><div>Opportunities<strong>${rows.length}</strong></div><div>Known expected fees · USD<strong>${sum(known.map(row => row.expectedFees))}</strong></div><div>Expected receipts · USD<strong>${sum([...rows.flatMap(row => row.outstanding).filter(payment => payment.amount !== null).map(payment => payment.amount), ...rows.map(row => row.unallocatedFees)])}</strong></div><div>Fees incomplete / TBD<strong>${rows.filter(row => row.feesIncomplete).length}</strong></div></div>
      ${flow.length ? `<div class="eng-cash-flow" aria-label="Expected receipts by month">${flow.map(bucket => `<div><span>${esc(bucket.month)}</span><b>${core.currency(bucket.amount)}</b>${bucket.unknown ? ` + ${bucket.unknown} TBD` : ''}</div>`).join('')}</div>` : ''}
      <div class="eng-forecast-scroll" role="region" aria-label="Opportunity forecast" tabindex="0"><table class="eng-forecast"><colgroup><col style="width:20%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:11%"><col style="width:16%"><col style="width:17%"></colgroup><thead><tr><th scope="col">Opportunity / client</th><th scope="col">Stage</th><th scope="col">Projected start</th><th scope="col">Projected end</th><th scope="col">Expected fees · USD</th><th scope="col">Next receipt</th><th scope="col">Next milestone</th></tr></thead><tbody>${rows.map(item => {
        const id = esc(String(item.id));
        const next = item.nextPayment || (item.unallocatedFees ? {amount: item.unallocatedFees, expectedDate: ''} : null);
        return `<tr><td><button class="eng-forecast-title" onclick="openEngagementDetail('${id}')">${esc(item.title)}</button><small>${esc(item.organization || 'Organization TBD')}${groupFor(item) ? ` · ${esc(groupFor(item).title)}` : ''}</small></td><td><select class="form-input" aria-label="Stage for ${esc(item.title)}" onchange="updateForecastField('${id}','status',this.value)">${statusOptions(item.status)}</select></td><td>${forecastField(item, 'projectedStartDate', 'date', item.projectedStartDate, 'Projected start')}</td><td>${forecastField(item, 'projectedEndDate', 'date', item.projectedEndDate, 'Projected end')}</td><td>${forecastField(item, 'expectedValue', 'number', item.expectedFees, 'Expected fees')}<small>${item.expectedValue === null && item.expectedFees !== null ? 'From payment plan' : ''}</small></td><td>${next ? `${core.currency(next.amount)} · ${esc(next.expectedDate || 'Date TBD')}` : item.payments.length ? 'No expected receipts' : 'Schedule TBD'}<br><button class="btn btn-ghost btn-sm" style="margin-top:7px" aria-expanded="${forecastExpanded.has(String(item.id))}" onclick="toggleForecastPayments('${id}')">${forecastExpanded.has(String(item.id)) ? 'Hide payments' : 'Payments'}</button></td><td>${esc(item.nextMilestone || 'TBD')}<small>${esc(item.nextMilestoneDate || '')}</small></td></tr>${forecastExpanded.has(String(item.id)) ? `<tr class="eng-forecast-expanded"><td colspan="7">${paymentEditor(item)}</td></tr>` : ''}`;
      }).join('')}</tbody></table></div>`;
  }

  function paymentEditor(value) {
    const item = window.EngagementCore.withDefaults(value);
    const id = esc(String(item.id));
    const planned = item.payments.filter(payment => payment.amount !== null).reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0) / 100;
    const complete = item.payments.length && item.payments.every(payment => payment.amount !== null);
    return `<div class="eng-payment-editor"><div class="eng-section-title">Payment schedule · USD</div><table><thead><tr><th scope="col">Payment</th><th scope="col">Amount</th><th scope="col">Expected receipt date</th><th scope="col">Status</th><th scope="col"></th></tr></thead><tbody>${item.payments.map((payment, index) => `<tr><td><input class="form-input" aria-label="Payment label ${index + 1}" value="${esc(payment.label)}" onchange="updateEngagementPayment('${id}',${index},'label',this.value)"></td><td><input class="form-input" type="number" min="0" step="0.01" aria-label="Payment amount ${index + 1}" value="${payment.amount ?? ''}" onchange="updateEngagementPayment('${id}',${index},'amount',this.value)"></td><td><input class="form-input" type="date" aria-label="Payment date ${index + 1}" value="${esc(payment.expectedDate)}" onchange="updateEngagementPayment('${id}',${index},'expectedDate',this.value)"></td><td><select class="form-input" aria-label="Payment status ${index + 1}" onchange="updateEngagementPayment('${id}',${index},'status',this.value)"><option value="expected" ${payment.status === 'expected' ? 'selected' : ''}>Expected</option><option value="received" ${payment.status === 'received' ? 'selected' : ''}>Received</option></select></td><td><button class="btn btn-ghost btn-sm" title="Remove payment ${index + 1}" aria-label="Remove payment ${index + 1}" onclick="removeEngagementPayment('${id}',${index})">&times;</button></td></tr>`).join('')}</tbody></table><div class="eng-payment-actions"><button class="btn btn-ghost btn-sm" onclick="addEngagementPayment('${id}')">+ Payment</button><span>Planned: ${window.EngagementCore.currency(planned)}${complete && item.expectedValue !== null && Math.abs(planned - item.expectedValue) > .009 ? `<span class="eng-plan-warning"> · Fees: ${window.EngagementCore.currency(item.expectedValue)} · Unallocated: ${window.EngagementCore.currency(item.expectedValue - planned)}</span>` : ''}</span></div></div>`;
  }

  function saveForecast(item) {
    item.updatedDate = today();
    saveEngagements(engagements);
    renderEngagements();
    if (String(selectedEngagementId) === String(item.id) && document.getElementById('engagementDetailPanel').classList.contains('open')) renderEngagementDetail(item);
  }

  window.updateForecastField = function(id, field, value) {
    const item = findEngagement(id), core = window.EngagementCore;
    if (!item || !['projectedStartDate', 'projectedEndDate', 'expectedValue', 'status'].includes(field)) return;
    const clean = field === 'expectedValue' ? core.money(value) : field === 'status' ? value : core.dateOnly(value);
    if (value && (clean === null || clean === '' || (field === 'status' && !core.STATUS_LABELS[value]))) { toast('Enter a valid value.'); renderEngagements(); return; }
    const start = field === 'projectedStartDate' ? clean : item.projectedStartDate;
    const end = field === 'projectedEndDate' ? clean : item.projectedEndDate;
    if (start && end && start > end) { toast('Projected end must be on or after the start.'); renderEngagements(); return; }
    item[field] = clean;
    saveForecast(item);
  };

  window.toggleForecastPayments = function(id) {
    id = String(id);
    if (forecastExpanded.has(id)) forecastExpanded.delete(id); else forecastExpanded.add(id);
    renderEngagements();
  };
  window.addEngagementPayment = function(id) {
    const item = findEngagement(id); if (!item) return;
    item.payments = window.EngagementCore.payments(item.payments);
    item.payments.push({id: `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label: '', amount: null, expectedDate: '', status: 'expected'});
    saveForecast(item);
  };
  window.updateEngagementPayment = function(id, index, field, value) {
    const item = findEngagement(id), core = window.EngagementCore;
    if (!item || !['label', 'amount', 'expectedDate', 'status'].includes(field)) return;
    const plan = core.payments(item.payments); if (!plan[index]) return;
    const clean = field === 'amount' ? core.money(value) : field === 'expectedDate' ? core.dateOnly(value) : value;
    if (value && (clean === null || clean === '' || (field === 'status' && !['expected', 'received'].includes(value)))) { toast('Enter a valid payment value.'); return; }
    plan[index][field] = clean;
    item.payments = plan;
    saveForecast(item);
  };
  window.removeEngagementPayment = function(id, index) {
    const item = findEngagement(id); if (!item) return;
    item.payments = window.EngagementCore.payments(item.payments).filter((_, i) => i !== index);
    saveForecast(item);
  };
  window.copyEngagementForecast = async function() {
    const recap = window.EngagementCore.forecastRecap(displayedForecast);
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([recap.html], {type: 'text/html'}), 'text/plain': new Blob([recap.text], {type: 'text/plain'})})]);
      else { await navigator.clipboard.writeText(recap.text); toast('Copied as plain text.'); return; }
      toast('Recap copied with formatting.');
    } catch (_) { toast('Clipboard unavailable. Download the CSV instead.'); }
  };
  window.downloadEngagementForecast = function() {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + window.EngagementCore.forecastCsv(displayedForecast)], {type: 'text/csv;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `opportunity-forecast-${today()}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  function renderEngagementSidebar() {
    const forecast = engagementView === 'forecast';
    const source = engagements.filter(item => !item.deleted && !item.archived && (!forecast || !item.isGroup));
    const filters = forecast ? [['open', 'Active opportunities'], ['all', 'All opportunities'], ...window.EngagementCore.STATUSES] : [['open', 'Open'], ['groups', 'Pursuit groups'], ['ungrouped', 'Standalone'], ['all', 'All'], ...window.EngagementCore.STATUSES];
    document.getElementById('engagementsSidebar').innerHTML = `<div class="sidebar-section"><div class="sidebar-label">Engagements</div>
      ${filters.map(([value, label]) => {
        const count = value === 'all' ? source.length
          : value === 'open' ? source.filter(item => item.status !== 'closed' && (!forecast || item.status !== 'on_hold')).length
          : value === 'groups' ? source.filter(item => item.isGroup).length
          : value === 'ungrouped' ? source.filter(item => !item.isGroup && !item.groupId).length
          : source.filter(item => item.status === value).length;
        return `<button class="tier-btn ${engagementFilter === value ? 'active' : ''}" onclick="setEngagementFilter('${value}')"><span class="tier-dot" style="background:${value === 'closed' ? '#87928e' : '#2f9185'}"></span>${esc(label)}<span class="tier-count">${count}</span></button>`;
      }).join('')}</div>`;
  }

  window.setEngagementFilter = function setEngagementFilter(value) {
    engagementFilter = value;
    renderEngagements();
    toggleMobileFilters(true);
  };

  window.openAddEngagementModal = function openAddEngagementModal(groupId = '') {
    newContactIds = [];
    newGroupId = String(groupId || '');
    const parent = newGroupId ? findEngagement(newGroupId) : null;
    document.getElementById('addEngagementContent').innerHTML = `<h2 style="margin-bottom:18px">${parent ? `Add pursuit to ${esc(parent.title)}` : 'Add engagement'}</h2>
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
      <div class="eng-modal-actions"><button class="btn btn-ghost" onclick="closeAddEngagementModal()">Cancel</button><button class="btn btn-primary" onclick="saveNewEngagement()">Create ${parent ? 'pursuit' : 'engagement'}</button></div>`;
    document.getElementById('addEngagementModal').classList.add('open');
  };

  window.closeAddEngagementModal = function closeAddEngagementModal() {
    document.getElementById('addEngagementModal').classList.remove('open');
    newGroupId = '';
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
      groupId: newGroupId,
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
    const children = item.isGroup ? childrenForGroup(item.id) : [];
    const parent = !item.isGroup ? groupFor(item) : null;
    const groupRollup = item.isGroup ? `<div class="eng-section"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div class="eng-section-title" style="margin:0">Pursuits in this group</div><button class="btn btn-ghost btn-sm" onclick="openAddEngagementModal('${esc(String(item.id))}')">+ Add pursuit</button></div><div class="eng-group-rollup">${children.length ? children.map(child => `<button class="eng-group-rollup-row" onclick="openEngagementDetail('${esc(String(child.id))}')"><span><strong>${esc(child.title || 'Untitled pursuit')}</strong><span class="eng-subtle" style="display:block;margin-top:3px">${esc(child.nextMilestone || child.currentState || 'No next milestone')}</span></span><span>${statusBadge(child.status)} ${child.nextMilestoneDate ? `<span class="eng-date" style="margin-left:8px">${fmtDate(child.nextMilestoneDate)}</span>` : ''}</span></button>`).join('') : '<div class="eng-subtle" style="padding:14px">No child pursuits yet.</div>'}</div></div>` : '';
    const parentNotice = parent ? `<div class="eng-section" style="padding-top:0"><button class="eng-contact-chip" onclick="openEngagementDetail('${esc(String(parent.id))}')">Pursuit group: ${esc(parent.title)}</button></div>` : '';
    document.getElementById('engagementDetailPanel').innerHTML = `<div class="detail-topbar"><button class="back-btn" onclick="closeEngagementDetail()">← Back</button><span style="font-size:13px;color:var(--muted)">${esc(item.organization || item.title)}</span><span style="flex:1"></span><button class="btn btn-ghost btn-sm" style="color:#b74343;border-color:#d9b0b0" onclick="deleteEngagement('${esc(String(item.id))}')">Delete</button></div>
      <div class="eng-detail-content"><div class="eng-detail-shell">
        <div class="eng-detail-heading"><div><input class="form-input eng-detail-title" value="${esc(item.title)}" onblur="updateEngagement('${esc(String(item.id))}','title',this.value)">${item.isGroup ? '<span class="eng-group-badge">Pursuit group</span>' : ''}<input class="form-input eng-org" value="${esc(item.organization)}" placeholder="Organization / client" onblur="updateEngagement('${esc(String(item.id))}','organization',this.value)"></div><select class="form-input" style="width:170px" onchange="updateEngagement('${esc(String(item.id))}','status',this.value)">${statusOptions(item.status)}</select></div>
        ${parentNotice}
        ${groupRollup}
        <div id="engagementSmsReview" data-engagement-id="${esc(String(item.id))}">${window.renderEngagementTextSummaries ? window.renderEngagementTextSummaries(item.id) : ''}</div>
        <div class="eng-focus-grid">
          <div class="eng-focus"><div class="eng-section-title">${item.isGroup ? 'Shared context' : 'Current state'}</div><textarea class="form-input" onblur="updateEngagement('${esc(String(item.id))}','currentState',this.value,false)">${esc(item.currentState)}</textarea></div>
          <div class="eng-focus"><div class="eng-section-title">Next milestone</div><div class="eng-milestone"><input class="form-input" value="${esc(item.nextMilestone)}" placeholder="Define the next milestone" onblur="updateEngagement('${esc(String(item.id))}','nextMilestone',this.value,false)"><input class="form-input" type="date" value="${esc(item.nextMilestoneDate)}" style="margin-top:8px" onchange="updateEngagement('${esc(String(item.id))}','nextMilestoneDate',this.value)"></div></div>
        </div>
        ${!item.isGroup ? `<div class="eng-section"><div class="eng-section-title">Forecast · USD</div><div class="eng-form-grid"><label class="form-group"><span class="form-label">Projected start</span>${forecastField(item, 'projectedStartDate', 'date', item.projectedStartDate || '', 'Projected start')}</label><label class="form-group"><span class="form-label">Projected end</span>${forecastField(item, 'projectedEndDate', 'date', item.projectedEndDate || '', 'Projected end')}</label><label class="form-group"><span class="form-label">Expected fees</span>${forecastField(item, 'expectedValue', 'number', item.expectedValue ?? '', 'Expected fees')}</label></div>${paymentEditor(item)}</div>` : ''}
        <div class="eng-form-grid eng-section"><label class="form-group"><span class="form-label">Opportunity / problem</span><textarea class="form-input" rows="4" onblur="updateEngagement('${esc(String(item.id))}','opportunity',this.value,false)">${esc(item.opportunity)}</textarea></label><label class="form-group"><span class="form-label">Commercial hypothesis / estimate</span><textarea class="form-input" rows="4" onblur="updateEngagement('${esc(String(item.id))}','commercial',this.value,false)">${esc(item.commercial)}</textarea></label></div>
        <div class="eng-section"><div class="eng-section-title">Linked people</div><div class="eng-contact-list">${item.contactIds.length ? item.contactIds.map(contactId => { const contact = contactFor(contactId); return `<span class="eng-contact-chip"><button style="border:0;background:transparent;padding:0;cursor:pointer;color:inherit" onclick="openEngagementContact('${esc(String(contactId))}')">${esc(contact ? contact.name : `Contact ${contactId}`)}</button><button style="border:0;background:transparent;cursor:pointer;color:var(--muted)" title="Remove" onclick="removeEngagementContact('${esc(String(item.id))}','${esc(String(contactId))}')">&times;</button></span>`; }).join('') : '<span class="eng-subtle">No linked people</span>'}</div><div class="eng-add-contact"><input class="form-input" id="engDetailContact" list="engDetailContactOptions" placeholder="Search contacts"><button class="btn btn-ghost" onclick="addEngagementContact('${esc(String(item.id))}')">Add</button></div><datalist id="engDetailContactOptions">${contactOptions()}</datalist></div>
        <div class="eng-section"><div class="eng-section-title">Drive / working documents</div><div class="eng-link-list">${links || '<span class="eng-subtle">No working links</span>'}</div><textarea class="form-input" rows="3" style="margin-top:10px" placeholder="Label | https://..." onblur="updateEngagement('${esc(String(item.id))}','links',this.value,false)">${esc(item.links)}</textarea></div>
        <div class="eng-section"><div class="eng-section-title">Notes timeline</div><div class="rt-toolbar"><button class="rt-btn" onmousedown="event.preventDefault();document.execCommand('bold')"><b>B</b></button><button class="rt-btn" onmousedown="event.preventDefault();document.execCommand('italic')"><i>I</i></button><button class="rt-btn" onmousedown="event.preventDefault();document.execCommand('insertUnorderedList')">•</button></div><div class="eng-rich-note" id="engNoteEditor" contenteditable="true"></div><div style="display:flex;justify-content:flex-end;margin:8px 0 18px"><button class="btn btn-primary btn-sm" onclick="addEngagementNote('${esc(String(item.id))}')">Add note</button></div><div class="eng-notes">${notes.length ? notes.map(note => `<div class="eng-note"><button class="eng-note-delete" title="Delete note" onclick="deleteEngagementNote('${esc(String(item.id))}','${esc(String(note.id))}')">Delete</button><div class="eng-note-date">${fmtDate(note.date)}</div><div class="eng-note-body">${safeRichHtml(note.html)}</div></div>`).join('') : '<div class="eng-subtle">No notes yet</div>'}</div></div>
      </div></div>`;
  }
})();
