# Contact note dictation

The microphone in the contact note toolbar starts browser speech recognition in
English (US). Click again to stop. Final transcripts append as plain text to the
existing rich-text draft; interim words appear only in the listening status.
Review and save with the existing Save button. Nothing is automatically saved.

The first use in each page session explains that the browser may send audio to
its speech provider. Network CRM does not record or store audio and introduces
no transcription API key or server endpoint. Browser support, microphone
permission, connectivity, and a secure HTTPS origin are required. Browsers
without SpeechRecognition/webkitSpeechRecognition can use keyboard dictation.

Saving, clearing, leaving the page, or switching profiles cancels the current
session. Late recognition callbacks cannot refill the draft or affect another
contact. Existing note storage and cloud synchronization are unchanged.

## Verification

Run `node --test test/contact-dictation.test.js`. For a real microphone check on
HTTPS or localhost, open a fictional contact, type a short draft, allow the
microphone, dictate, stop, and verify the draft retains both typed and spoken
text. Check Save/reload with a test contact only. Also deny microphone permission
and confirm an actionable error appears with no change to the draft.
