(function () {
  'use strict';
  let active = null;
  let consent = false;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function cancel() {
    if (!active) return;
    const session = active;
    active = null;
    session.recognition.abort();
    session.button.setAttribute('aria-pressed', 'false');
    session.button.setAttribute('aria-label', 'Dictate note');
    session.button.title = 'Dictate note';
    session.button.textContent = '\uD83C\uDFA4';
    session.status.textContent = '';
  }

  function mount() {
    const editor = document.getElementById('noteInput');
    if (active && active.editor !== editor) cancel();
    if (!editor || document.getElementById('contactDictation')) return;
    const toolbar = editor.parentElement.querySelector('.rt-toolbar');
    if (!toolbar) return;
    const button = document.createElement('button');
    button.id = 'contactDictation';
    button.type = 'button';
    button.className = 'rt-btn';
    button.textContent = '\uD83C\uDFA4';
    button.title = 'Dictate note';
    button.setAttribute('aria-label', 'Dictate note');
    button.setAttribute('aria-pressed', 'false');
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:12px;color:var(--muted);white-space:normal';
    toolbar.style.flexWrap = 'wrap';
    toolbar.append(button, status);
    button.onclick = function () {
      if (active) {
        active.recognition.stop();
        status.textContent = 'Finishing...';
        return;
      }
      if (!Recognition) {
        status.textContent = 'Dictation unavailable. Use your keyboard microphone.';
        return;
      }
      if (!consent) {
        consent = window.confirm('Dictate this note? Your browser may send audio to its speech provider for transcription. Network.crm does not store audio. You can review the text before saving.');
        if (!consent) return;
      }
      const recognition = new Recognition();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      const session = { recognition, editor, button, status, seen: new Set() };
      active = session;
      recognition.onresult = function (event) {
        if (active !== session || !editor.isConnected || document.getElementById('noteInput') !== editor) return;
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result.isFinal) { interim += result[0].transcript; continue; }
          if (session.seen.has(i)) continue;
          session.seen.add(i);
          const text = result[0].transcript.trim();
          if (!text) continue;
          // Insert as text, preserving existing rich formatting and avoiding HTML injection.
          const prefix = editor.textContent && !/\s$/.test(editor.textContent) ? ' ' : '';
          editor.appendChild(document.createTextNode(prefix + text));
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        status.textContent = interim || 'Listening...';
      };
      recognition.onerror = function (event) {
        if (active !== session) return;
        cancel();
        const messages = {
          'not-allowed': 'Microphone permission denied. Allow it in browser site settings.',
          'service-not-allowed': 'Speech recognition is blocked by your browser.',
          'audio-capture': 'No microphone available.',
          'no-speech': 'No speech detected. Try again.',
          network: 'Speech service unavailable. Check your connection and try again.'
        };
        status.textContent = messages[event.error] || 'Dictation stopped. Your text is still here.';
      };
      recognition.onend = function () {
        if (active !== session) return;
        active = null;
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', 'Dictate note');
        button.title = 'Dictate note';
        button.textContent = '\uD83C\uDFA4';
        status.textContent = '';
      };
      try {
        recognition.start();
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', 'Stop dictation');
        button.title = 'Stop dictation';
        button.textContent = '\u25A0';
        status.textContent = 'Listening...';
      } catch (error) {
        cancel();
        status.textContent = 'Unable to start dictation. Try again.';
      }
    };
  }

  // Stop before Save/Clear handlers run, so delayed transcripts cannot refill a saved note.
  document.addEventListener('click', function (event) {
    if (!active) return;
    const button = event.target.closest('button');
    if (button && button !== active.button && active.editor.closest('.add-note-wrap').contains(button) && !button.closest('.rt-toolbar')) cancel();
  }, true);
  window.addEventListener('pagehide', cancel);
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  mount();
})();
