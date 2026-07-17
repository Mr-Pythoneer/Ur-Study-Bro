// Copyright (c) 2026 Mr_Pythoneer — MIT License
//
// ══════════════════════════════════════════════════════════════════════
//  preload.js — the ONLY bridge between the renderer and the main process
// ══════════════════════════════════════════════════════════════════════
//
// The app runs with contextIsolation: true, so renderer pages have NO access
// to Node, `require`, or ipcRenderer. Everything the UI can ask the OS to do
// must pass through the `window.api` object built below. If a page needs a new
// native capability, you add a method HERE and a matching handler in main.js —
// there is no other door.
//
// Two IPC flavours are used, and picking the wrong one is the most common
// mistake when adding a method:
//   • ipcRenderer.send(...)   → fire-and-forget, returns undefined. Replies (if
//                               any) come back on a separate channel that you
//                               must subscribe to with an on*/off* pair.
//   • ipcRenderer.invoke(...) → returns a Promise resolving to main's return
//                               value. Use this for anything with a result.
//
// Callback-registration convention: every `onXxx(cb)` has a matching `offXxx()`
// that calls removeAllListeners on the channel. This matters because of how
// pages load — see the note on the listener channels below. Any page that calls
// an on* method MUST unregister via the off* method in window._pageCleanup, or
// the listener survives the page swap and stacks up one more per visit.
//
// Note on the shapes returned here: main.js handlers are written to RESOLVE
// with an error payload rather than reject. In particular askAI (ipc 'ai:chat')
// always resolves to {reply} or {error} and never throws — callers must check
// .error rather than relying on try/catch.
//
// SECURITY: whatever is added to this surface is reachable by any script the
// renderer executes. Keep methods narrow and specific; avoid adding anything
// that lets a page name an arbitrary file path or shell command. (See the
// "Generic IPC" section at the bottom — it already breaks that rule.)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // ── External links ──────────────────────────────────────────────
  // Links must never be plain <a href> — a navigation would replace the SPA
  // shell and there is no way back. Route them to the OS browser instead.
  openExternal: (url) => ipcRenderer.send('shell:open', url),
  focusWindow:  ()    => ipcRenderer.send('window:focus'),

  // ── Native notifications ────────────────────────────────────────
  // Scheduling lives in main so reminders still fire while the window is
  // hidden/minimised; a renderer-side setTimeout would be throttled or lost.
  scheduleNotify: (ev) => ipcRenderer.send('notify:event', ev),

  // ── Focus guard ─────────────────────────────────────────────────
  // Main polls the frontmost app; when it isn't in `allowedApps` it pushes a
  // 'guard:nudge'. Guard state is owned by main and is NOT reset by a page
  // swap — a page that starts the guard is responsible for stopping it.
  startGuard: (allowedApps) => ipcRenderer.send('guard:start', allowedApps),
  stopGuard:  ()            => ipcRenderer.send('guard:stop'),
  // Pair these: register in the page's IIFE, unregister in window._pageCleanup,
  // or every revisit adds another nudge handler and the user gets N popups.
  onGuardNudge:  (cb) => ipcRenderer.on('guard:nudge', (_e, app) => cb(app)),
  offGuardNudge: ()   => ipcRenderer.removeAllListeners('guard:nudge'),

  // ── Screen recorder ─────────────────────────────────────────────
  // desktopCapturer is main-only in modern Electron, so the picker list has to
  // be fetched over IPC. setPreferredSource stashes the chosen id in main,
  // which is what the display-media request handler answers with when the
  // renderer later calls getDisplayMedia() — the two are ordered: set first,
  // then capture, or main answers with the stale/default source.
  getSources:           ()        => ipcRenderer.invoke('recorder:getSources'),
  setPreferredSource:   (id)      => ipcRenderer.send('recorder:setPreferredSource', id),
  // `buffer` crosses IPC by structured clone; pass an ArrayBuffer/Uint8Array
  // from the MediaRecorder blob, not the Blob itself (Blobs don't survive).
  saveRecording:   (buffer, filename)   => ipcRenderer.invoke('recorder:save', { buffer, filename }),
  listRecordings:  ()                   => ipcRenderer.invoke('recorder:list'),
  // filepath is expected to be one main itself handed back from listRecordings.
  openRecording:   (filepath)           => ipcRenderer.invoke('recorder:open', filepath),
  deleteRecording: (filepath)           => ipcRenderer.invoke('recorder:delete', filepath),

  // ── App scanner ─────────────────────────────────────────────────
  // Enumerates installed apps to populate the focus-guard allow-list picker.
  scanApps: () => ipcRenderer.invoke('apps:scan'),

  // ── Email fetch ─────────────────────────────────────────────────
  // Two backends: 'email:fetch' (provider API) and 'email:fetch-imap' (raw
  // IMAP). `cfg` carries credentials — it is passed straight through to main
  // and must never be logged or persisted on the renderer side.
  fetchEmails:     (cfg) => ipcRenderer.invoke('email:fetch', cfg),
  fetchEmailsIMAP: (cfg) => ipcRenderer.invoke('email:fetch-imap', cfg),

  // ── Apple Notes sync ────────────────────────────────────────────
  // macOS-only; main drives Notes via AppleScript. Fails (resolved, not thrown)
  // on other platforms and when automation permission was never granted.
  syncToNotes: (payload) => ipcRenderer.invoke('notes:sync', payload),

  // ── AI chat ─────────────────────────────────────────────────────
  // Non-streaming, provider-agnostic entry point (main picks the provider from
  // the shared `ai_provider` / `ai_key_*` keys). The wrapper window.aiChat sits
  // on top of this.
  // INVARIANT: 'ai:chat' ALWAYS resolves to {reply} or {error} — it never
  // rejects, so a try/catch around askAI() will never fire. Callers MUST test
  // the .error field on the resolved value.
  askAI:          (payload) => ipcRenderer.invoke('ai:chat', payload),
  transcribeAudio:(payload) => ipcRenderer.invoke('ai:transcribe', payload),

  // ── System info ─────────────────────────────────────────────────
  // Used to decide whether local models are realistic on this machine (RAM/CPU).
  systemInfo: () => ipcRenderer.invoke('system:info'),

  // ── Ollama (local AI) ────────────────────────────────────────────
  // ollamaStatus reports whether the local daemon is reachable — call it before
  // offering local-model UI, since Ollama is an optional external install.
  ollamaStatus: ()           => ipcRenderer.invoke('ollama:status'),
  // Model pulls are GBs and take minutes: the invoke resolves only at the end,
  // so drive the progress bar from onOllamaPullProgress rather than awaiting.
  ollamaPull:   (model)      => ipcRenderer.invoke('ollama:pull', model),
  onOllamaPullProgress:  (cb) => ipcRenderer.on('ollama:pull-progress', (_e, d) => cb(d)),
  offOllamaPullProgress: ()   => ipcRenderer.removeAllListeners('ollama:pull-progress'),

  // Streaming chat (Ollama only — tokens arrive in real time)
  // Unlike askAI this is send(), not invoke(): there is no return value and no
  // promise to await. The lifecycle is token* → (done | error), delivered on
  // three sibling channels you subscribe to below.
  ollamaStream:     (payload) => ipcRenderer.send('ollama:stream', payload),
  // FIXME(medium): the stream channels carry no stream/request id, and the only
  // way to unsubscribe is removeAllListeners — so two overlapping streams
  // interleave tokens into whichever handlers are attached, and tearing one
  // down kills the other's. Only ever run one stream at a time. See audit.
  onOllamaToken:    (cb) => ipcRenderer.on('ollama:stream-token', (_e, t) => cb(t)),
  onOllamaDone:     (cb) => ipcRenderer.on('ollama:stream-done',  (_e)    => cb()),
  onOllamaError:    (cb) => ipcRenderer.on('ollama:stream-error', (_e, e) => cb(e)),
  // Call from window._pageCleanup. Also call before starting a new stream:
  // re-registering without this stacks a second copy of every handler and each
  // token gets rendered twice.
  offOllamaStream:  ()   => {
    ipcRenderer.removeAllListeners('ollama:stream-token')
    ipcRenderer.removeAllListeners('ollama:stream-done')
    ipcRenderer.removeAllListeners('ollama:stream-error')
  },

  // Tool-calling agent (model can open apps, search, make notes — not just chat)
  // The tool loop runs entirely in main; this invoke resolves once with the
  // final answer. Intermediate "thinking/using tool X" events stream over
  // 'ollama:agent-step' — subscribe to those if you want live progress, as the
  // run can take many seconds with nothing to show otherwise.
  runAgent:     (payload) => ipcRenderer.invoke('ollama:agent', payload),
  onAgentStep:  (cb) => ipcRenderer.on('ollama:agent-step', (_e, evt) => cb(evt)),
  offAgentStep: ()   => ipcRenderer.removeAllListeners('ollama:agent-step'),

  // ── First launch + permissions + update ─────────────────────────
  // Two-step handshake so a crash mid-onboarding doesn't mark it complete:
  // firstLaunchCheck asks whether to show the wizard, and firstLaunchDone is
  // only sent once the user actually finishes it.
  firstLaunchCheck: ()    => ipcRenderer.invoke('app:firstLaunchCheck'),
  firstLaunchDone:  ()    => ipcRenderer.send('app:firstLaunchDone'),
  // macOS TCC status (screen recording / automation). The OS grants these out
  // of band, so re-poll on window focus rather than caching the first answer.
  permStatus:       ()    => ipcRenderer.invoke('app:permStatus'),
  checkUpdate:      ()    => ipcRenderer.invoke('app:checkUpdate'),

  // ── Generic IPC ─────────────────────────────────────────────────
  // Escape hatch for channels that don't have a typed wrapper above.
  //
  // Prefer adding a named method: `channel` is unvalidated, so this lets any
  // renderer script reach EVERY ipcMain handler in the app with arbitrary
  // arguments, which defeats the point of having a curated bridge. Treat new
  // uses as a smell — and never widen this to expose `invoke`.
  //
  // `receive` and `on` are the same function under two names (kept for
  // backwards compatibility with older pages); note neither returns an
  // unsubscribe handle, so a page using them has no way to clean up.
  send:    (channel, ...args) => ipcRenderer.send(channel, ...args),
  receive: (channel, cb)      => ipcRenderer.on(channel, (_e, ...args) => cb(...args)),
  on:      (channel, cb)      => ipcRenderer.on(channel, (_e, ...args) => cb(...args)),
})
