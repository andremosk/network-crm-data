(() => {
  const dialog = document.getElementById('referrerDialog');
  const trigger = document.getElementById('referrerTrigger');
  if (!dialog || !trigger || /^\/demo(?:\/|$)/.test(location.pathname)) return;
  const form = dialog.querySelector('form');
  const input = dialog.querySelector('input');
  const submit = form.querySelector('button');
  const status = dialog.querySelector('[role=status]');
  const results = dialog.querySelector('.referrer-results');
  let pending;

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function openContact(match) {
    const contact = contacts.find(c => String(c.id) === match.id);
    if (!contact) { status.textContent = 'This contact is not available in the current dataset.'; return; }
    dialog.close();
    clearProfileSearch();
    switchView('contacts');
    openDetail(contact.id);
    if (!match.evidence) return;
    const note = [...document.querySelectorAll('#notesArea .note-text')].find(node =>
      node.innerText.replace(/\s+/g,' ').includes(match.evidence));
    if (note) note.scrollIntoView({block:'center'});
  }

  function render(items) {
    results.replaceChildren();
    for (const [track, heading] of [['direct','Direct matches'],['connector','Potential connectors']]) {
      const matches = items.filter(item => item.track === track);
      if (!matches.length) continue;
      const section = el('section');
      section.append(el('h3',heading));
      const list = el('ol');
      matches.forEach(match => {
        const row = el('li');
        const head = el('div',null,'referrer-row-head');
        const link = el('button',match.name,'referrer-contact');
        link.type = 'button';
        link.onclick = () => openContact(match);
        head.append(link,el('span',match.confidence,`referrer-confidence ${match.confidence.toLowerCase()}`));
        row.append(head);
        const profile = [match.position,match.company].filter(Boolean).join(' · ');
        if (profile) row.append(el('div',profile,'referrer-profile'));
        row.append(el('p',match.reason));
        if (match.evidence) {
          const note = el('button',`“${match.evidence}”`,'referrer-note');
          note.type = 'button'; note.title = 'Open supporting contact note';
          note.onclick = () => openContact(match);
          row.append(note);
        }
        list.append(row);
      });
      section.append(list); results.append(section);
    }
  }

  trigger.hidden = false;
  trigger.onclick = () => { dialog.showModal(); input.focus(); };
  dialog.querySelector('.referrer-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { pending?.abort(); pending = null; submit.disabled = false; status.textContent = ''; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query || pending) return;
    const request = new AbortController();
    pending = request;
    submit.disabled = true;
    results.replaceChildren();
    status.textContent = 'Searching contacts and notes…';
    const timeout = setTimeout(() => request.abort(), 25000);
    try {
      const response = await fetch('/api/crm/referrer', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({query}), signal:request.signal});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed. Try again.');
      if (pending !== request) return;
      render(data.results);
      const count = data.results.length;
      status.textContent = count ? `${count} suggestion${count === 1 ? '' : 's'}${data.mode === 'crm' ? ' · CRM ranking' : ''}` : 'No eligible contacts in your CRM.';
    } catch (error) {
      if (pending === request) status.textContent = request.signal.aborted ? 'Search timed out. Try again.' : (error.message || 'Search failed. Try again.');
    } finally {
      clearTimeout(timeout);
      if (pending === request) { pending = null; submit.disabled = false; }
    }
  });
})();
