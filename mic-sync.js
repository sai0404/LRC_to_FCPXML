/**
 * mic-sync.js — Real-time mic word highlighting for LyricSync → FCP
 * Drop-in: <script src="mic-sync.js"></script> at end of index.html
 *
 * Features:
 *  • 🎙 Mic button injected into panel-preview header
 *  • Modal: paste plain lyrics (no timestamps) + pick language
 *  • Chrome Web Speech API streams recognition in real-time
 *  • Each recognised word matched against lyrics → highlighted live
 *  • Timestamps recorded per word → exported as word-level LRC
 *  • "Use as Input" feeds the generated LRC into the main converter
 *
 * Works with ALL scripts: Hindi (hi-IN), Telugu (te-IN),
 * Malayalam (ml-IN), Sanskrit (sa-IN), Kannada (kn-IN),
 * Tamil (ta-IN), English (en-US/en-GB), etc.
 */

(function () {
  'use strict';

  // ── Guard: only run once ────────────────────────────────────
  if (window.__micSyncLoaded) return;
  window.__micSyncLoaded = true;

  // ── Check browser support ───────────────────────────────────
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  // ── CSS ─────────────────────────────────────────────────────
  const CSS = `
  /* ── Mic button ── */
  #mic-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 500;
    background: transparent; color: #5a6070; border: 1px solid rgba(255,255,255,0.07);
    cursor: pointer; font-family: var(--font); transition: all 0.15s;
  }
  #mic-btn:hover { background: #222730; color: #e8eaf0; border-color: #5a6070; }
  #mic-btn.recording {
    background: rgba(232,85,85,0.15); border-color: rgba(232,85,85,0.5);
    color: #e85555; animation: micPulse 1.2s ease-in-out infinite;
  }
  @keyframes micPulse { 0%,100%{box-shadow:0 0 0 0 rgba(232,85,85,0.4)} 50%{box-shadow:0 0 0 6px rgba(232,85,85,0)} }

  /* ── Modal backdrop ── */
  #mic-modal-backdrop {
    display: none; position: fixed; inset: 0; z-index: 6000;
    background: rgba(0,0,0,0.7); backdrop-filter: blur(5px);
    align-items: center; justify-content: center;
  }
  #mic-modal-backdrop.open { display: flex; animation: micFadeIn 0.15s ease both; }
  @keyframes micFadeIn { from{opacity:0} to{opacity:1} }

  /* ── Modal box ── */
  #mic-modal {
    background: #1a1e25; border: 1px solid rgba(255,255,255,0.07);
    border-radius: 16px; padding: 24px 26px; width: 540px; max-width: 95vw;
    box-shadow: 0 32px 80px rgba(0,0,0,0.75);
    animation: micModalIn 0.22s cubic-bezier(0.34,1.4,0.64,1) both;
    display: flex; flex-direction: column; gap: 14px; max-height: 90vh; overflow: hidden;
  }
  @keyframes micModalIn { from{opacity:0;transform:scale(0.88) translateY(20px)} to{opacity:1;transform:scale(1) translateY(0)} }

  .mic-modal-title {
    font-size: 0.9rem; font-weight: 600; color: #e8eaf0;
    display: flex; align-items: center; gap: 10px;
  }
  .mic-modal-title .mic-icon {
    width: 32px; height: 32px; border-radius: 8px;
    background: rgba(232,85,85,0.15); border: 1px solid rgba(232,85,85,0.35);
    display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;
  }
  .mic-modal-title em { font-style: normal; color: #5a6070; font-size: 0.75rem; font-weight: 400; }

  /* ── Settings row ── */
  .mic-settings-row {
    display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
    padding: 10px 12px; background: #13161b; border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .mic-setting { display: flex; align-items: center; gap: 6px; }
  .mic-setting label { font-size: 0.68rem; color: #5a6070; white-space: nowrap; }
  .mic-select {
    background: #222730; color: #e8eaf0; border: 1px solid rgba(255,255,255,0.07);
    border-radius: 5px; padding: 3px 8px; font-size: 0.72rem;
    cursor: pointer; outline: none; font-family: var(--font);
  }
  .mic-select:focus { border-color: #e8a820; }

  /* ── Lyrics textarea ── */
  .mic-textarea-label { font-size: 0.72rem; color: #9aa0b0; }
  #mic-lyrics-input {
    width: 100%; height: 120px; resize: none;
    background: #13161b; border: 1px solid rgba(255,255,255,0.07);
    border-radius: 8px; color: #e8eaf0; font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem; padding: 10px 12px; outline: none; line-height: 1.7;
    caret-color: #e8a820; transition: border-color 0.15s;
  }
  #mic-lyrics-input:focus { border-color: #e8a820; }
  #mic-lyrics-input::placeholder { color: #3a4050; }

  /* ── Live display ── */
  #mic-live-display {
    min-height: 80px; max-height: 160px; overflow-y: auto;
    background: #0d0f12; border: 1px solid rgba(255,255,255,0.05);
    border-radius: 8px; padding: 12px 14px;
    font-family: 'Noto Sans Devanagari','Noto Sans Telugu','Noto Sans Malayalam','Inter',sans-serif;
    font-size: 1rem; line-height: 1.8; display: none; flex-wrap: wrap; gap: 4px;
    align-content: flex-start;
  }
  #mic-live-display.active { display: flex; }
  .mlw { display: inline-block; padding: 1px 3px; border-radius: 3px; transition: all 0.08s; }
  .mlw.mw-future { color: rgba(232,232,240,0.25); }
  .mlw.mw-spoken { color: rgba(232,168,32,0.6); }
  .mlw.mw-active {
    color: #fff; background: rgba(232,168,32,0.15);
    text-shadow: 0 0 12px rgba(232,168,32,0.8);
  }
  .mlw.mw-unmatched { color: rgba(79,163,232,0.7); font-style: italic; }

  /* ── Status bar ── */
  #mic-status-bar {
    display: flex; align-items: center; gap: 8px;
    font-size: 0.7rem; color: #5a6070; min-height: 22px;
  }
  .mic-status-dot {
    width: 7px; height: 7px; border-radius: 50%; background: #5a6070;
    flex-shrink: 0; transition: background 0.2s;
  }
  .mic-status-dot.listening { background: #e85555; animation: micPulse 1.2s ease-in-out infinite; }
  .mic-status-dot.done { background: #3ecf8e; animation: none; }
  #mic-interim { color: #4fa3e8; font-style: italic; }
  #mic-word-count { margin-left: auto; color: #3a4050; }

  /* ── LRC preview ── */
  #mic-lrc-preview {
    display: none; background: #0d0f12; border: 1px solid rgba(255,255,255,0.05);
    border-radius: 8px; padding: 10px 14px; max-height: 120px; overflow-y: auto;
    font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: #9aa0b0;
    line-height: 1.7; white-space: pre;
  }
  #mic-lrc-preview.active { display: block; }

  /* ── Actions ── */
  .mic-actions {
    display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;
  }
  .mic-btn {
    padding: 6px 14px; border-radius: 7px; border: none; cursor: pointer;
    font-family: var(--font); font-size: 0.78rem; font-weight: 500;
    transition: all 0.12s; display: inline-flex; align-items: center; gap: 6px;
  }
  .mic-btn-record {
    background: #e85555; color: #fff; min-width: 110px; justify-content: center;
  }
  .mic-btn-record:hover { background: #f06060; }
  .mic-btn-record.recording { background: #c03030; }
  .mic-btn-use {
    background: #e8a820; color: #0d0f12;
  }
  .mic-btn-use:hover { background: #f0b830; }
  .mic-btn-use:disabled { opacity: 0.4; cursor: not-allowed; }
  .mic-btn-cancel {
    background: #222730; color: #9aa0b0; border: 1px solid rgba(255,255,255,0.07);
  }
  .mic-btn-cancel:hover { background: #2a303c; color: #e8eaf0; }

  /* ── Unsupported notice ── */
  .mic-unsupported {
    padding: 10px 14px; background: rgba(232,168,32,0.08);
    border: 1px solid rgba(232,168,32,0.25); border-radius: 8px;
    font-size: 0.75rem; color: #e8a820; line-height: 1.6;
  }
  `;

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // ── Language options ─────────────────────────────────────────
  const LANGS = [
    { code: 'hi-IN',  label: 'Hindi (हिन्दी)' },
    { code: 'te-IN',  label: 'Telugu (తెలుగు)' },
    { code: 'ml-IN',  label: 'Malayalam (മലയാളം)' },
    { code: 'kn-IN',  label: 'Kannada (ಕನ್ನಡ)' },
    { code: 'ta-IN',  label: 'Tamil (தமிழ்)' },
    { code: 'sa-IN',  label: 'Sanskrit (संस्कृतम्)' },
    { code: 'mr-IN',  label: 'Marathi (मराठी)' },
    { code: 'gu-IN',  label: 'Gujarati (ગુજરાતી)' },
    { code: 'pa-IN',  label: 'Punjabi (ਪੰਜਾਬੀ)' },
    { code: 'bn-IN',  label: 'Bengali (বাংলা)' },
    { code: 'or-IN',  label: 'Odia (ଓଡ଼ିଆ)' },
    { code: 'en-US',  label: 'English (US)' },
    { code: 'en-GB',  label: 'English (UK)' },
    { code: 'ar-SA',  label: 'Arabic (العربية)' },
  ];

  // ── Inject mic button into panel-preview header ───────────────
  function injectMicButton() {
    const previewHeader = document.querySelector('#panel-preview .panel-right');
    if (!previewHeader) { console.warn('[mic-sync] panel-preview .panel-right not found'); return; }

    const btn = document.createElement('button');
    btn.id = 'mic-btn';
    btn.title = 'Auto-Sync from Microphone';
    btn.innerHTML = '🎙 Auto-Sync';
    btn.addEventListener('click', openMicModal);

    // Insert before the existing "Player" popout button
    previewHeader.insertBefore(btn, previewHeader.firstChild);
  }

  // ── Build modal HTML ─────────────────────────────────────────
  function buildModal() {
    const backdrop = document.createElement('div');
    backdrop.id = 'mic-modal-backdrop';
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeMicModal(); });

    const langOptions = LANGS.map(l =>
      `<option value="${l.code}">${l.label}</option>`
    ).join('');

    backdrop.innerHTML = `
    <div id="mic-modal">
      <div class="mic-modal-title">
        <div class="mic-icon">🎙</div>
        <div>
          Auto-Sync from Microphone
          <br/><em>Speak / sing → words highlighted live → exports word-level LRC</em>
        </div>
      </div>

      ${!supported ? `<div class="mic-unsupported">
        ⚠️ Web Speech API is not supported in this browser.<br/>
        Please use <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong> on desktop.
      </div>` : ''}

      <div class="mic-settings-row">
        <div class="mic-setting">
          <label>Language</label>
          <select class="mic-select" id="mic-lang-sel">${langOptions}</select>
        </div>
        <div class="mic-setting">
          <label>Mode</label>
          <select class="mic-select" id="mic-mode-sel">
            <option value="match">Match to lyrics</option>
            <option value="free">Free transcription</option>
          </select>
        </div>
        <div class="mic-setting">
          <label>Offset (ms)</label>
          <input type="number" class="mic-select" id="mic-offset-inp"
            value="-1500" step="50" style="width:70px" title="Add ms to all timestamps. -1500ms = real-time WhisperX sync"/>
        </div>
      </div>

      <div class="mic-textarea-label">
        Paste plain lyrics here (no timestamps) — one line per row:
      </div>
      <textarea id="mic-lyrics-input" placeholder="सुन्दरतर पिनाकधरहर&#10;గంగాధర గజచర్మాంబరధర&#10;Hello world how are you&#10;&#10;Any script works — Devanagari, Telugu, Malayalam, Latin…"></textarea>

      <div id="mic-live-display"></div>

      <div id="mic-status-bar">
        <div class="mic-status-dot" id="mic-dot"></div>
        <span id="mic-status-text">Ready — paste lyrics and click Record</span>
        <span id="mic-interim"></span>
        <span id="mic-word-count"></span>
      </div>

      <div id="mic-lrc-preview"></div>

      <div class="mic-actions">
        <button class="mic-btn mic-btn-cancel" onclick="window.__micSync.close()">Cancel</button>
        <button class="mic-btn mic-btn-use" id="mic-use-btn" disabled
          onclick="window.__micSync.useInApp()">↗ Use as LRC Input</button>
        <button class="mic-btn mic-btn-record" id="mic-record-btn"
          onclick="window.__micSync.toggleRecord()"
          ${!supported ? 'disabled' : ''}>🎙 Record</button>
      </div>
    </div>`;

    document.body.appendChild(backdrop);
  }

  // ── State ────────────────────────────────────────────────────
  let recognition = null;
  let isRecording = false;
  let sessionStart = 0;          // performance.now() at record start
  let lrcOffset = 0;             // ms offset from input
  let lyricWords = [];           // [{word, lineIdx, wordIdx}]
  let matchedUpTo = 0;           // index into lyricWords
  let recordedWords = [];        // [{word, ts, endTs, lineIdx}]
  let freeTranscript = [];       // [{word, ts}] for free mode
  let generatedLRC = '';

  // ── Open / close modal ───────────────────────────────────────
  function openMicModal() {
    document.getElementById('mic-modal-backdrop').classList.add('open');
    // Pre-fill with content from main input if it has plain text (no LRC timestamps)
    const mainInput = document.getElementById('lrc-input');
    if (mainInput && mainInput.value.trim() && !/^\[/.test(mainInput.value.trim())) {
      document.getElementById('mic-lyrics-input').value = mainInput.value.trim();
    }
  }
  function closeMicModal() {
    if (isRecording) stopRecording();
    document.getElementById('mic-modal-backdrop').classList.remove('open');
  }

  // ── Parse lyrics into word list ──────────────────────────────
  function parseLyricWords(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const words = [];
    lines.forEach((line, li) => {
      line.split(/\s+/).filter(Boolean).forEach((w, wi) => {
        words.push({ word: normaliseWord(w), raw: w, lineIdx: li, wordIdx: wi });
      });
    });
    return words;
  }

  function normaliseWord(w) {
    // Remove punctuation, lowercase Latin, keep Unicode scripts intact
    return w.replace(/[.,!?;:'"()[\]{}\-–—]/g, '').toLowerCase();
  }

  // ── Build live display spans ──────────────────────────────────
  function buildLiveDisplay() {
    const el = document.getElementById('mic-live-display');
    el.innerHTML = '';
    el.classList.add('active');
    const text = document.getElementById('mic-lyrics-input').value;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach((line, li) => {
      line.split(/\s+/).filter(Boolean).forEach((word, wi) => {
        const span = document.createElement('span');
        span.className = 'mlw mw-future';
        span.id = `mlw-${li}-${wi}`;
        span.textContent = word;
        el.appendChild(span);
        el.appendChild(document.createTextNode(' '));
      });
      // Line break after each lyric line
      el.appendChild(document.createElement('br'));
    });
  }

  // ── Highlight word ────────────────────────────────────────────
  function highlightWord(lineIdx, wordIdx, state) {
    const el = document.getElementById(`mlw-${lineIdx}-${wordIdx}`);
    if (!el) return;
    el.className = `mlw ${state}`;
  }

  // ── Fuzzy word match ─────────────────────────────────────────
  function fuzzyMatch(a, b) {
    a = normaliseWord(a); b = normaliseWord(b);
    if (a === b) return 1.0;
    if (a.startsWith(b) || b.startsWith(a)) return 0.8;
    // Levenshtein distance for short words
    if (Math.abs(a.length - b.length) > 3) return 0;
    const dist = levenshtein(a, b);
    return dist <= 2 ? (1 - dist / Math.max(a.length, b.length)) : 0;
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({length: m+1}, (_, i) => Array.from({length: n+1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
  }

  // ── Process recognised words ──────────────────────────────────
  function processWords(wordResults, isFinal) {
    const mode = document.getElementById('mic-mode-sel').value;
    const now = performance.now() - sessionStart;

    if (mode === 'free') {
      // Free mode: just record everything with timestamps
      wordResults.forEach(w => {
        const ts = (w.startTime != null ? w.startTime * 1000 : now) + lrcOffset;
        freeTranscript.push({ word: w.word, ts: Math.max(0, ts) });
        // Show in live display as unmatched
        const span = document.createElement('span');
        span.className = 'mlw mw-unmatched';
        span.textContent = w.word;
        document.getElementById('mic-live-display').appendChild(span);
        document.getElementById('mic-live-display').appendChild(document.createTextNode(' '));
      });
      setStatus(`Transcribed ${freeTranscript.length} words`, 'listening');
      return;
    }

    // Match mode: align spoken words to lyric words
    wordResults.forEach(w => {
      const spokenNorm = normaliseWord(w.word);
      const ts = (w.startTime != null ? w.startTime * 1000 : now) + lrcOffset;

      // Search forward in lyricWords from matchedUpTo (window of 12)
      let bestScore = 0, bestIdx = -1;
      const searchEnd = Math.min(lyricWords.length, matchedUpTo + 12);
      for (let i = matchedUpTo; i < searchEnd; i++) {
        const score = fuzzyMatch(spokenNorm, lyricWords[i].word);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }

      if (bestScore >= 0.6 && bestIdx >= 0) {
        // Mark skipped words as spoken
        for (let i = matchedUpTo; i < bestIdx; i++) {
          highlightWord(lyricWords[i].lineIdx, lyricWords[i].wordIdx, 'mw-spoken');
        }
        // Mark current word active
        if (matchedUpTo > 0) {
          const prev = lyricWords[matchedUpTo - 1];
          highlightWord(prev.lineIdx, prev.wordIdx, 'mw-spoken');
        }
        highlightWord(lyricWords[bestIdx].lineIdx, lyricWords[bestIdx].wordIdx, 'mw-active');
        recordedWords.push({
          word: lyricWords[bestIdx].raw,
          ts: Math.max(0, ts),
          lineIdx: lyricWords[bestIdx].lineIdx,
          wordIdx: lyricWords[bestIdx].wordIdx
        });
        matchedUpTo = bestIdx + 1;

        // Scroll live display
        const activeEl = document.getElementById(`mlw-${lyricWords[bestIdx].lineIdx}-${lyricWords[bestIdx].wordIdx}`);
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });

    setStatus(`Matched ${matchedUpTo} / ${lyricWords.length} words`, 'listening');
    updateWordCount();
  }

  // ── Generate LRC from recorded data ──────────────────────────
  function generateLRCFromRecording() {
    const mode = document.getElementById('mic-mode-sel').value;

    if (mode === 'free') {
      return generateFreeLRC();
    }

    // Match mode: group by lyric line
    const text = document.getElementById('mic-lyrics-input').value;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const lineWordMap = {};

    recordedWords.forEach(rw => {
      if (!lineWordMap[rw.lineIdx]) lineWordMap[rw.lineIdx] = [];
      lineWordMap[rw.lineIdx].push(rw);
    });

    let lrc = '';
    lines.forEach((line, li) => {
      const lineWords = lineWordMap[li];
      if (!lineWords || lineWords.length === 0) return;

      // Line timestamp = first word in line
      const lineTs = lineWords[0].ts;
      const mm = Math.floor(lineTs / 1000 / 60).toString().padStart(2, '0');
      const ss = Math.floor((lineTs / 1000) % 60).toString().padStart(2, '0');
      const cs = Math.floor((lineTs % 1000) / 10).toString().padStart(2, '0');
      const lineTag = `[${mm}:${ss}.${cs}]`;

      // Word-level tags
      const wordTags = lineWords.map(rw => {
        const wts = rw.ts;
        const wmm = Math.floor(wts / 1000 / 60).toString().padStart(2, '0');
        const wss = Math.floor((wts / 1000) % 60).toString().padStart(2, '0');
        const wcs = Math.floor((wts % 1000) / 10).toString().padStart(2, '0');
        return `<${wmm}:${wss}.${wcs}>${rw.word}`;
      }).join('');

      lrc += `${lineTag}${wordTags}\n`;
    });

    return lrc;
  }

  function generateFreeLRC() {
    if (!freeTranscript.length) return '';
    // Group into lines of ~8 words
    const WORDS_PER_LINE = 8;
    let lrc = '';
    for (let i = 0; i < freeTranscript.length; i += WORDS_PER_LINE) {
      const chunk = freeTranscript.slice(i, i + WORDS_PER_LINE);
      const lineTs = chunk[0].ts;
      const mm = Math.floor(lineTs / 1000 / 60).toString().padStart(2, '0');
      const ss = Math.floor((lineTs / 1000) % 60).toString().padStart(2, '0');
      const cs = Math.floor((lineTs % 1000) / 10).toString().padStart(2, '0');
      const lineTag = `[${mm}:${ss}.${cs}]`;
      const wordTags = chunk.map(w => {
        const wts = w.ts;
        const wmm = Math.floor(wts / 1000 / 60).toString().padStart(2, '0');
        const wss = Math.floor((wts / 1000) % 60).toString().padStart(2, '0');
        const wcs = Math.floor((wts % 1000) / 10).toString().padStart(2, '0');
        return `<${wmm}:${wss}.${wcs}>${w.word}`;
      }).join('');
      lrc += `${lineTag}${wordTags}\n`;
    }
    return lrc;
  }

  // ── Start / stop recording ────────────────────────────────────
  function startRecording() {
    if (!supported) { setStatus('Web Speech API not supported. Use Chrome.', ''); return; }

    const lang = document.getElementById('mic-lang-sel').value;
    lrcOffset = parseInt(document.getElementById('mic-offset-inp').value) || 0;
    const mode = document.getElementById('mic-mode-sel').value;
    const lyricsText = document.getElementById('mic-lyrics-input').value.trim();

    if (mode === 'match' && !lyricsText) {
      setStatus('Paste your lyrics first!', '');
      document.getElementById('mic-lyrics-input').focus();
      return;
    }

    // Reset state
    matchedUpTo = 0;
    recordedWords = [];
    freeTranscript = [];
    generatedLRC = '';
    document.getElementById('mic-lrc-preview').classList.remove('active');
    document.getElementById('mic-lrc-preview').textContent = '';
    document.getElementById('mic-use-btn').disabled = true;

    if (mode === 'match') {
      lyricWords = parseLyricWords(lyricsText);
      buildLiveDisplay();
    } else {
      document.getElementById('mic-live-display').innerHTML = '';
      document.getElementById('mic-live-display').classList.add('active');
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      sessionStart = performance.now();
      isRecording = true;
      setStatus('Listening… speak now', 'listening');
      document.getElementById('mic-record-btn').textContent = '⏹ Stop';
      document.getElementById('mic-record-btn').classList.add('recording');
      document.getElementById('mic-btn').classList.add('recording');
      document.getElementById('mic-btn').innerHTML = '🔴 Recording';
    };

    recognition.onresult = e => {
      let interimText = '';
      const wordResults = [];

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0].transcript.trim();

        if (result.isFinal) {
          // Break transcript into words with estimated timestamps
          const words = transcript.split(/\s+/).filter(Boolean);
          const now = (performance.now() - sessionStart) / 1000;
          const dur = result[0].confidence ? 1 : 0.5;
          words.forEach((w, wi) => {
            wordResults.push({
              word: w,
              startTime: now - dur * (words.length - wi) / words.length,
              isFinal: true
            });
          });
        } else {
          interimText = transcript;
        }
      }

      if (wordResults.length) processWords(wordResults, true);
      document.getElementById('mic-interim').textContent = interimText ? `"${interimText}"` : '';
    };

    recognition.onerror = e => {
      if (e.error === 'not-allowed') {
        setStatus('Microphone permission denied. Allow mic in browser settings.', '');
        stopRecording();
      } else if (e.error === 'no-speech') {
        setStatus('No speech detected. Try speaking louder.', '');
      } else {
        console.warn('[mic-sync] error:', e.error);
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        // Auto-restart for continuous listening
        try { recognition.start(); } catch(e) {}
      }
    };

    try {
      recognition.start();
    } catch (e) {
      setStatus('Could not start microphone: ' + e.message, '');
    }
  }

  function stopRecording() {
    isRecording = false;
    if (recognition) { try { recognition.stop(); } catch(e) {} recognition = null; }

    document.getElementById('mic-record-btn').textContent = '🎙 Record';
    document.getElementById('mic-record-btn').classList.remove('recording');
    document.getElementById('mic-btn').classList.remove('recording');
    document.getElementById('mic-btn').innerHTML = '🎙 Auto-Sync';

    // Mark remaining words as spoken
    if (lyricWords.length && matchedUpTo > 0) {
      for (let i = matchedUpTo; i < lyricWords.length; i++) {
        highlightWord(lyricWords[i].lineIdx, lyricWords[i].wordIdx, 'mw-future');
      }
    }

    generatedLRC = generateLRCFromRecording();

    if (generatedLRC.trim()) {
      document.getElementById('mic-lrc-preview').textContent = generatedLRC;
      document.getElementById('mic-lrc-preview').classList.add('active');
      document.getElementById('mic-use-btn').disabled = false;
      setStatus(`Done! ${recordedWords.length || freeTranscript.length} words captured. Preview below ↓`, 'done');
    } else {
      setStatus('No words captured. Try again.', '');
    }

    document.getElementById('mic-interim').textContent = '';
  }

  function toggleRecord() {
    if (isRecording) stopRecording();
    else startRecording();
  }

  // ── Use generated LRC in app ──────────────────────────────────
  function useInApp() {
    if (!generatedLRC.trim()) return;
    const mainInput = document.getElementById('lrc-input');
    if (!mainInput) { alert('Could not find the LRC input box.'); return; }
    mainInput.value = generatedLRC;
    closeMicModal();

    // Trigger the main app's processInput
    if (typeof processInput === 'function') {
      processInput();
    } else {
      // Fallback: fire input event
      mainInput.dispatchEvent(new Event('input'));
    }

    // Show toast via app's showToast if available
    if (typeof showToast === 'function') {
      showToast('✓ Mic LRC loaded — ready to convert!', 'success');
    }
  }

  // ── UI helpers ────────────────────────────────────────────────
  function setStatus(msg, state) {
    document.getElementById('mic-status-text').textContent = msg;
    const dot = document.getElementById('mic-dot');
    dot.className = 'mic-status-dot' + (state ? ' ' + state : '');
  }

  function updateWordCount() {
    const total = lyricWords.length || freeTranscript.length;
    const matched = recordedWords.length || freeTranscript.length;
    if (total) {
      document.getElementById('mic-word-count').textContent =
        `${matched}/${total} words`;
    }
  }

  // ── Expose API ────────────────────────────────────────────────
  window.__micSync = {
    open: openMicModal,
    close: closeMicModal,
    toggleRecord,
    useInApp
  };

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    buildModal();
    injectMicButton();
    console.log('[mic-sync] loaded —', supported ? 'Web Speech API available' : 'NOT supported (use Chrome)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
