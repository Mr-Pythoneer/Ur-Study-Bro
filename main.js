// Copyright (c) 2026 Mr_Pythoneer — MIT License
//
// ══════════════════════════════════════════════════════════════════
//  main.js — Electron MAIN process for "Ur Study Bro"
// ══════════════════════════════════════════════════════════════════
//
// WHAT THIS IS
//   The app's single privileged process. It owns the BrowserWindow, and it is
//   the ONLY place with Node access: the renderer runs with contextIsolation
//   and nodeIntegration:false, so every filesystem read, network call to an AI
//   provider, AppleScript invocation and shell-out has to be brokered here.
//   Essentially this whole file is one flat list of ipcMain handlers.
//
// THE THREE-LAYER CONTRACT (change one, change all three)
//   main.js       — registers ipcMain.handle('x:y') / ipcMain.on('x:y')
//   preload.js    — exposes it on window.api via contextBridge
//   renderer/**   — calls window.api.*
//   Adding a handler here does NOTHING until preload.js bridges it. There is no
//   dynamic discovery.
//
// ipcMain.handle vs ipcMain.on
//   .handle  = request/response, renderer awaits a return value.
//   .on      = fire-and-forget, or the main process pushes back later via
//              event.sender.send(...) / win.webContents.send(...) on a channel
//              the renderer subscribed to in preload.js.
//
// ERROR CONVENTION — IMPORTANT
//   Handlers do NOT throw across IPC. They return a plain object and encode
//   failure in a field: {error} / {ok:false,error} / {reply}. In particular
//   'ai:chat' ALWAYS resolves to {reply} or {error}, never rejects — every
//   caller MUST check .error. Keep new handlers consistent with this; a thrown
//   error surfaces in the renderer as an opaque "Error invoking remote method".
//
// PLATFORM
//   macOS-first. Mail fetch, Apple Notes sync, the focus guard and the
//   permission checks are all AppleScript/osascript. Windows gets a PowerShell
//   path for email only; Linux gets nothing but the IMAP fallback.
//
// MAIN-PROCESS BLOCKING — READ BEFORE ADDING CODE
//   This process runs the UI. Anything synchronous here (execSync, spawnSync,
//   fs.*Sync) freezes the entire window, including animations and clicks. A few
//   deliberate, user-initiated one-shots remain sync (notes:sync, the focus
//   guard); do not add more. Prefer async fs / spawn with a callback.
//
const {
  app, BrowserWindow, ipcMain, shell,
  Notification, desktopCapturer, session, dialog,
} = require('electron')

// ── Global crash / unhandled error handler ────────────────────────
// Last-resort net. Registered before anything else so a throw during module
// load or window creation still shows a human-readable box instead of dying
// silently (a packaged Electron app has no visible console).
// Note this quits the app: it is a crash reporter, not a recovery path. Do NOT
// rely on it to swallow routine errors — handle those where they happen.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  try {
    dialog.showErrorBox(
      'Ur Study Bro — Unexpected Error',
      `Something went wrong and the app couldn't continue.\n\n${err.message}\n\nPlease report this at:\ngithub.com/Mr-Pythoneer/Ur-Study-Bro/issues`
    )
  } catch {}
  app.quit()
})

// ── Dependencies ──────────────────────────────────────────────────
// Imap / mailparser are required up top for the IMAP fallback but ALSO
// re-required inside the handler below — the top-level ones are effectively
// unused there. `electron`'s `net` is deliberately required lazily inside each
// handler instead (it is only valid after app-ready).
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { execSync, spawnSync, execFile } = require('child_process')
const Imap = require('imap')
const { simpleParser } = require('mailparser')

// ── Preferred source for screen recorder ─────────────────────────
// Handshake with the renderer: getDisplayMedia() gives the main process no way
// to know WHICH source the user picked in our own custom picker UI, so the
// renderer stashes the id here first, then calls getDisplayMedia(). The handler
// below reads it and clears it (single-use — see the leak note there).
let _preferredSourceId = null
ipcMain.on('recorder:setPreferredSource', (_e, id) => { _preferredSourceId = id })

// ── Window factory ────────────────────────────────────────────────
function createWindow() {
  // Allow renderer to call getDisplayMedia — picks user-selected source if set
  // Without a handler here Electron denies every getDisplayMedia() call, so the
  // screen recorder cannot work at all. Installing one means WE are the consent
  // dialog: whatever this callback returns is captured, no OS prompt follows.
  // (Re-registered per createWindow(); defaultSession is global so the last one
  // wins — harmless today because there is only ever one window.)
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      const preferred = _preferredSourceId
        ? sources.find(s => s.id === _preferredSourceId)
        : null
      // No source explicitly picked (or the stale id no longer matches): DENY
      // rather than silently falling back to sources[0] (the whole primary
      // screen), which would capture the full desktop without any consent.
      if (!preferred) { _preferredSourceId = null; return callback({}) }
      callback({ video: preferred })
      _preferredSourceId = null
    }).catch(() => callback({}))
  })

  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    fullscreenable: true,
    backgroundColor: '#f5f5f0',
    icon: path.join(__dirname, 'assets', 'icon_1024.png'),
    // Security baseline — do not relax these. The renderer loads user content
    // (email bodies, friend names from Firebase) into innerHTML in places, so
    // the isolation boundary is what keeps that from reaching Node. All
    // privileged work goes through the explicit window.api surface in preload.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      // Keep timers/repaints running when the window is minimized or in the
      // background — otherwise Chromium throttles setInterval and the focus/
      // study timers stall. study.html also tracks wall-clock as a backstop.
      backgroundThrottling: false,
    },
  })
  // Single-page shell. Every "page" under renderer/pages/*.html is fetched and
  // injected into THIS document by loadPage() — there is no second window and
  // no navigation, so main-process state keyed to a window survives page moves.
  win.loadFile('renderer/index.html')

  // ── Dev: inject test profile if QA_INJECT env var set ────────────
  // Fakes a completed cognitive assessment so QA can reach the Study Plan /
  // Study Kit screens (which are gated on cogProfile) without sitting through
  // the 35-minute brain test. Writes straight to the renderer's localStorage
  // under the per-account cs_<user>_ prefix — the same key csSet would use.
  // Never fires in a normal run; the env var is set by the test harness only.
  if (process.env.QA_INJECT === '1') {
    win.webContents.on('did-finish-load', () => {
      const fakeProfile = JSON.stringify({
        adhdRisk:28, riskLabel:'Low', commission:3, omission:2, avgRT:380,
        forwardSpan:7, backwardSpan:5, vark:{V:2,A:1,R:3,K:1}, varkDominant:'R',
        switchCost:145, matrixAccuracy:83, tlx:{mental:5,temporal:4,frustration:3},
        sessionLen:35, completedAt:new Date().toISOString(),
        strengths:['Strong Impulse Control','Above-Average Working Memory','Sustained Attention'],
        growth:['Context-Switching Cost','Fast Reaction Speed']
      })
      // The JSON is spliced into a single-quoted JS string literal, hence the
      // .replace(/'/g,...) below. Safe only because fakeProfile is a hardcoded
      // literal above — do not extend this to accept outside input.
      win.webContents.executeJavaScript(`
        (function(){
          const user = localStorage.getItem('cs_currentUser') || 'testuser';
          localStorage.setItem('cs_'+user+'_cogProfile', '${fakeProfile.replace(/'/g,"\\'")}');
          console.log('[QA] Injected cogProfile for', user);
        })()
      `).catch(()=>{})
    })
  }

  return win
}

// ── Open URLs in default browser ──────────────────────────────────
// The scheme allowlist is a security control, not a nicety: shell.openExternal
// hands the string to the OS, so an unfiltered `file:`/`smb:`/custom-scheme URL
// from an email body could launch arbitrary things. Only http(s) and the one
// System Settings deep link (used by the permissions prompts) get through.
ipcMain.on('shell:open', (_e, url) => {
  if (url && /^(https?:\/\/|x-apple\.systempreferences:)/i.test(url)) shell.openExternal(url)
})

// ── Focus main window ─────────────────────────────────────────────
ipcMain.on('window:focus', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) { win.show(); win.focus() }
})

// ── Native macOS notification with "Join Meeting" action ──────────
// Fired by the calendar scheduler ~5 min before an event. Lives in main rather
// than the renderer because renderer Notifications die with the page and cannot
// carry native action buttons.
// NOTE: ev.link ultimately originates from detectMeeting()'s regex over email
// bodies — i.e. it is attacker-influenceable content being handed to
// shell.openExternal on click, so the handlers below re-check the scheme and
// show the real hostname. detectMeeting also host-anchors its match.
ipcMain.on('notify:event', (_e, ev) => {
  if (!Notification.isSupported()) return
  // Only ever open http(s) links (same scheme guard as shell:open), and surface
  // the real hostname so a spoofed "Join Meeting" destination is visible.
  let safeLink = null, linkHost = ''
  if (ev.link && /^https?:\/\//i.test(ev.link)) {
    safeLink = ev.link
    try { linkHost = new URL(ev.link).hostname } catch {}
  }
  const body = [`⏰ Starting in ~5 minutes`]
  if (ev.startLabel) body.push(`🕐 ${ev.startLabel}`)
  if (safeLink)      body.push(`🔗 ${linkHost || ev.linkLabel || 'Meeting link ready'}`)

  const n = new Notification({
    title:           ev.title,
    body:            body.join('\n'),
    actions:         safeLink ? [{ type: 'button', text: 'Join Meeting' }] : [],
    closeButtonText: 'Dismiss',
  })
  n.on('click',   () => { BrowserWindow.getAllWindows()[0]?.focus(); if (safeLink) shell.openExternal(safeLink) })
  n.on('action',  (_e2, i) => { if (i === 0 && safeLink) shell.openExternal(safeLink) })
  n.show()
})

// ── Screen recorder: get sources ──────────────────────────────────
// Powers our custom picker grid. Thumbnails are downscaled to 320x180 and
// converted to data URLs because NativeImage cannot cross the IPC boundary.
// On macOS this is also the de-facto Screen Recording permission probe: without
// the TCC grant getSources rejects, which we surface as 'permission_denied' so
// the UI can show the "Open System Settings" nudge.
ipcMain.handle('recorder:getSources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    })
    return { ok: true, sources: sources.map(s => ({
      id:        s.id,
      name:      s.name,
      thumbnail: s.thumbnail.toDataURL(),
    })) }
  } catch (err) {
    return { ok: false, error: 'permission_denied', message: err.message }
  }
})

// ── Screen recorder: save .webm file ─────────────────────────────
// ~/Documents/Ur Study Bro/Recordings is the canonical location — recorder:list
// and recorder:delete recompute this same path independently, so if you move it
// you must change all three.
// `filename` comes from the renderer and is NOT sanitised; it is joined into a
// path directly.
ipcMain.handle('recorder:save', async (_e, { buffer, filename }) => {
  const fsp = require('fs/promises')
  const dir = path.join(os.homedir(), 'Documents', 'Ur Study Bro', 'Recordings')
  await fsp.mkdir(dir, { recursive: true })
  const filepath = path.join(dir, filename)
  // Async write so a large recording does not freeze the UI, and a zero-copy
  // Buffer view over the transferred bytes rather than Buffer.from(buffer),
  // which would duplicate the (already IPC-copied) payload a second time.
  await fsp.writeFile(filepath, Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  const { size } = await fsp.stat(filepath)
  return { filepath, size }
})

// ── Screen recorder: list saved recordings ────────────────────────
// Newest-first. mtime is compared as an ISO string, which sorts correctly only
// because toISOString() is fixed-width UTC — don't switch it to a locale format.
ipcMain.handle('recorder:list', async () => {
  const dir = path.join(os.homedir(), 'Documents', 'Ur Study Bro', 'Recordings')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.webm'))
    .map(f => {
      const fp   = path.join(dir, f)
      const stat = fs.statSync(fp)
      return { name: f, filepath: fp, size: stat.size, mtime: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
})

// ── Screen recorder: open file in Finder / QuickLook ─────────────
ipcMain.handle('recorder:open', async (_e, filepath) => shell.openPath(filepath))

// ── Screen recorder: delete file ─────────────────────────────────
ipcMain.handle('recorder:delete', async (_e, filepath) => {
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
})

// ── Audio transcription via Whisper (OpenAI or Groq) ─────────────
// Used by the lecture recorder on meetings.html. Only openai/groq are wired up
// (Groq mirrors OpenAI's endpoint shape) — there is no local/Ollama fallback,
// so with the default provider this feature has no backend and the caller must
// surface the missing-key error itself.
// Returns {transcript, segments} or {error}; never throws across IPC.
ipcMain.handle('ai:transcribe', async (_e, { audioBuffer, provider, apiKey }) => {
  try {
    const { net } = require('electron')
    const buf = Buffer.from(audioBuffer)
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)

    // Build multipart/form-data manually (no DOM FormData in main process)
    // Order matters: the binary file part is pushed FIRST and the scalar fields
    // after, because the raw audio bytes must not be run through a template
    // literal (that would stringify/corrupt them) — hence append() is only used
    // for the text fields, and the file part is assembled by hand around `buf`.
    // Every separator here is CRLF per RFC 7578; LF alone is rejected.
    const parts = []
    const append = (name, value) => {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`))
    parts.push(buf)
    parts.push(Buffer.from('\r\n'))
    append('model', provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1')
    append('response_format', 'verbose_json')
    parts.push(Buffer.from(`--${boundary}--\r\n`))
    const body = Buffer.concat(parts)

    const url = provider === 'groq'
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions'

    const res = await net.fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(60000),
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error?.message || JSON.stringify(data) }
    return { transcript: data.text || '', segments: data.segments || [] }
  } catch(e) {
    return { error: e.message }
  }
})

// ── AI chat (proxied through main to avoid CORS) ──────────────────
// THE single AI entry point for the whole app:
//   window.aiChat -> window.api.askAI -> here.
// It lives in main because provider APIs send no CORS headers, so a fetch from
// the renderer origin would be blocked; net.fetch runs outside that sandbox.
//
// CONTRACT: this ALWAYS resolves to {reply} or {error} — it never rejects and
// never returns both. Every caller MUST check .error first; several renderer
// pages forget to and render an empty bubble instead (see audit).
//
// Shape of each provider branch: set url/headers/body + an extractReply(d)
// that digs the text out of that provider's response. To add a provider, add a
// branch — nothing else in this handler is provider-specific.
// Note the fallthrough `else` is Anthropic, so an unknown/typo'd provider
// string is silently sent to Anthropic rather than erroring.
ipcMain.handle('ai:chat', async (_e, { provider, apiKey, model, messages, systemPrompt }) => {
  try {
    const { net } = require('electron')
    let url, headers, body, extractReply

    if (provider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions'
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
      body = JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 1024,
      })
      extractReply = d => d.choices?.[0]?.message?.content

    } else if (provider === 'groq') {
      // Groq exposes an OpenAI-compatible chat completions endpoint.
      url = 'https://api.groq.com/openai/v1/chat/completions'
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
      body = JSON.stringify({
        model: model || 'llama-3.1-8b-instant',
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens: 1024,
      })
      extractReply = d => d.choices?.[0]?.message?.content

    } else if (provider === 'gemini') {
      const m = model || 'gemini-2.0-flash'
      // Gemini is the odd one out: the key goes in the query string, not a
      // header, so it can end up in any URL logging along this path.
      url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`
      headers = { 'Content-Type': 'application/json' }
      // Gemini uses 'model' role (not 'assistant') and its own contents format
      const contents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }))
      body = JSON.stringify({
        system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        contents,
        generationConfig: { maxOutputTokens: 1024 },
      })
      extractReply = d => d.candidates?.[0]?.content?.parts?.[0]?.text

    } else if (provider === 'ollama') {
      // Local Ollama — OpenAI-compatible endpoint at localhost:11434
      // This is the app's DEFAULT provider and it needs no apiKey. Renderer
      // pages that gate the send button on a key being present are therefore
      // dead out of the box — a recurring bug class in this codebase.
      // stream:false here; the streaming path is the separate ollama:stream
      // channel below.
      const ollamaModel = model || 'qwen2.5:7b'
      url = 'http://localhost:11434/v1/chat/completions'
      headers = { 'Content-Type': 'application/json' }
      body = JSON.stringify({
        model: ollamaModel,
        messages: [{ role: 'system', content: systemPrompt || '' }, ...messages],
        stream: false,
      })
      extractReply = d => d.choices?.[0]?.message?.content

    } else {
      // Anthropic (default)
      url = 'https://api.anthropic.com/v1/messages'
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }
      body = JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      })
      extractReply = d => d.content?.[0]?.text
    }

    // 60s AbortSignal so a hung provider or an unreachable Ollama rejects (caught
    // below as {error}) instead of leaving the await — and the caller's spinner —
    // pending forever.
    const res = await net.fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) })
    const data = await res.json()
    // Each provider nests its error differently, hence the || chain; the final
    // JSON.stringify is the "unknown shape" catch-all so something is always shown.
    if (!res.ok) return { error: data.error?.message || data.error?.status || JSON.stringify(data) }
    // `|| ''` means a refusal/empty completion arrives as an empty reply, NOT an
    // error — callers checking only .error will render a blank bubble.
    return { reply: extractReply(data) || '' }
  } catch (e) {
    return { error: e.message }
  }
})

// ── Ollama streaming chat ────────────────────────────────────────
// Uses /api/chat with stream:true and pushes tokens to the renderer
// as they arrive so the user sees words appearing in real time.
//
// This is .on (not .handle) because a single request produces MANY replies:
// tokens are pushed back on three channels the renderer subscribes to —
//   ollama:stream-token | ollama:stream-done | ollama:stream-error
// Exactly one terminal event (done or error) is expected per request... except
// the success path can emit stream-done TWICE (once from obj.done inside the
// loop, once after it).
// GOTCHA: these channels carry no request id, so two overlapping streams
// interleave into the same listener. Callers must serialise.
// Note the local /api/chat shape (obj.message.content) differs from the
// OpenAI-compatible /v1 shape used by ai:chat above.
ipcMain.on('ollama:stream', async (event, { model, messages, systemPrompt }) => {
  const { net } = require('electron')
  const ollamaModel = model || 'qwen2.5:7b'
  // Abort the fetch if the connection wedges before headers arrive, or if the
  // renderer that requested the stream is torn down mid-generation — so Ollama
  // stops generating instead of streaming into a socket nobody reads.
  const ac = new AbortController()
  const connTimer = setTimeout(() => ac.abort(), 60000)
  event.sender.once('destroyed', () => ac.abort())
  // Guarded because the renderer can be torn down mid-stream (page navigation,
  // sign-out); sending to a destroyed webContents throws. A dead consumer also
  // aborts the in-flight fetch here rather than silently draining the response.
  const send = (ch, data) => {
    if (event.sender.isDestroyed()) { ac.abort(); return }
    try { event.sender.send(ch, data) } catch {}
  }
  try {
    const res = await net.fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        stream: true,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          ...messages,
        ],
      }),
      signal: ac.signal,
    })
    // Headers received — cancel the connect-phase timer so the generation itself
    // is not capped by the wall clock.
    clearTimeout(connTimer)
    if (!res.ok) {
      const txt = await res.text()
      send('ollama:stream-error', txt)
      return
    }
    // Guard against a 200 with no body (getReader() would otherwise throw).
    if (!res.body) { send('ollama:stream-error', 'Ollama returned an empty response'); return }
    // NDJSON: one JSON object per line. A chunk boundary can land mid-line, so
    // we buffer the trailing partial and only parse complete lines.
    // decode({stream:true}) is likewise required — a multi-byte UTF-8 char can
    // be split across chunks and would otherwise decode to a replacement char.
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() // keep incomplete last line
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            const token = obj.message?.content
            if (token) send('ollama:stream-token', token)
            if (obj.done) send('ollama:stream-done', {})
          } catch {}
        }
      }
      send('ollama:stream-done', {})
    } finally {
      // Always release the reader/socket, even on a mid-drain read failure or abort.
      try { await reader.cancel() } catch {}
    }
  } catch (e) {
    send('ollama:stream-error', e.message)
  } finally {
    clearTimeout(connTimer)
  }
})

// ── Ollama tool-calling agent ────────────────────────────────────
// Unlike ai:chat / ollama:stream (plain chat), this passes a real `tools`
// array through Ollama's native function-calling API and EXECUTES the calls
// the model emits (open apps, web search, notes) before returning a final
// answer. This is what lets the local model actually DO things instead of
// describing them in prose. Tool defs + loop live in ./agent.js.
// Renderer usage:  const { reply, error } = await window.api.runAgent({ message })
// Optional live logs: window.api.onAgentStep(evt => …)  // {type:'tool_call'|'tool_result', …}
ipcMain.handle('ollama:agent', async (_e, { model, message } = {}) => {
  try {
    const { runAgent } = require('./agent')
    return await runAgent(message, {
      model: model || 'qwen2.5:7b',
      onStep: evt => { try { _e.sender.send('ollama:agent-step', evt) } catch {} },
    })
  } catch (e) {
    return { error: e.message }
  }
})

// ── System info ──────────────────────────────────────────────────
// Feeds the onboarding "which local model should I run?" step. The only field
// with real logic is `recommended`; the rest is raw os/GPU data for display.
// The thresholds below are heuristics tuned to keep a model resident in RAM/
// VRAM without swapping — they are not derived from anything, so adjust freely.
ipcMain.handle('system:info', async () => {
  const cpus    = os.cpus()
  const cpu     = cpus[0] || {}
  const cores   = cpus.length
  const ramGB   = Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10
  const ramFreeGB = Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10
  const platform = os.platform()         // darwin | win32 | linux
  const arch     = os.arch()             // arm64 | x64

  // Apple Silicon detection
  // Checks the CPU model string as well as darwin+arm64 to exclude an arm64
  // build running under some other environment; on real Apple Silicon the
  // unified memory means ramGB is effectively usable VRAM, which is why the
  // Apple branch below is more generous than the discrete-GPU one.
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64' &&
    (cpu.model || '').toLowerCase().includes('apple')

  // GPU info via Electron built-in
  let gpuName = 'Unknown', hasDiscreteGPU = false
  try {
    const gpuInfo = await app.getGPUInfo('basic')
    const devices = gpuInfo.gpuDevice || []
    if (devices.length > 0) {
      // vendorId 0x10de = NVIDIA, 0x1002 = AMD, 0x8086 = Intel
      hasDiscreteGPU = devices.some(d =>
        d.vendorId === 0x10de || d.vendorId === 0x1002
      )
      gpuName = devices[0].deviceString || devices[0].description || 'Unknown GPU'
    }
  // Swallowed on purpose: GPU probing is best-effort. Failing here just means
  // the recommendation falls back to the CPU-only tier.
  } catch {}

  // Recommend best Ollama model based on hardware
  let recommended
  if (isAppleSilicon) {
    if      (ramGB >= 32) recommended = 'llama3.1:8b'
    else if (ramGB >= 16) recommended = 'mistral:7b'
    else if (ramGB >= 8)  recommended = 'phi3.5:mini'
    else                  recommended = 'gemma3:1b'
  } else if (hasDiscreteGPU) {
    if      (ramGB >= 16) recommended = 'llama3.1:8b'
    else if (ramGB >= 8)  recommended = 'mistral:7b'
    else if (ramGB >= 6)  recommended = 'llama3.2:3b'
    else if (ramGB >= 4)  recommended = 'llama3.2:1b'
    else                  recommended = 'gemma3:1b'
  } else {
    if      (ramGB >= 16) recommended = 'llama3.2:3b'
    else if (ramGB >= 8)  recommended = 'phi3.5:mini'
    else if (ramGB >= 4)  recommended = 'gemma3:1b'
    else                  recommended = 'qwen2.5:0.5b'
  }

  return { cpu: cpu.model, cores, ramGB, ramFreeGB, platform, arch, isAppleSilicon, gpuName, hasDiscreteGPU, recommended }
})

// ── Ollama helpers ────────────────────────────────────────────────
// "Is Ollama running, and what's installed?" — /api/tags is the cheapest probe.
// Any throw (connection refused = daemon not running) is intentionally reported
// as running:false rather than an error; callers just want the boolean.
ipcMain.handle('ollama:status', async () => {
  try {
    const { net } = require('electron')
    const res = await net.fetch('http://localhost:11434/api/tags', { method: 'GET', signal: AbortSignal.timeout(2000) })
    if (!res.ok) return { running: false, models: [] }
    const data = await res.json()
    const models = (data.models || []).map(m => m.name)
    return { running: true, models }
  } catch {
    return { running: false, models: [] }
  }
})

// Downloads a model (multi-GB, multi-minute). Progress is pushed out-of-band on
// 'ollama:pull-progress' while the handle's own promise stays pending until the
// pull finishes — so the renderer both awaits a result AND subscribes to updates.
ipcMain.handle('ollama:pull', async (_e, modelName) => {
  try {
    // Stream the pull via Ollama API so we can track progress
    const { net } = require('electron')
    const win = BrowserWindow.getAllWindows()[0]
    const res = await net.fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    })
    if (!res.ok) return { error: 'Pull failed — is Ollama installed?' }

    // Stream the NDJSON response and send progress to renderer
    // Unlike ollama:stream above this does NOT buffer partial lines, so a JSON
    // object split across chunks is dropped by the inner catch. Tolerable only
    // because these are progress ticks, not content.
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let done = false
    while (!done) {
      const { value, done: d } = await reader.read()
      done = d
      if (value) {
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const obj = JSON.parse(line)
            if (win) win.webContents.send('ollama:pull-progress', obj)
            if (obj.status === 'success') return { ok: true }
          } catch {}
        }
      }
    }
    return { ok: true }
  } catch (e) {
    return { error: e.message }
  }
})

// ── Sync note to Apple Notes ──────────────────────────────────────
// macOS only (osascript). This handler is the REFERENCE for how to build
// AppleScript safely in this file — copy its approach, not _checkFrontmost's:
//   1. arbitrary/large content goes via a temp file, never into the script text
//   2. short strings that must be inlined go through asStr()
// The focus guard below does neither and is exploitable as a result.
ipcMain.handle('notes:sync', async (_e, { title, html, folder }) => {
  // Build a dated header then append the editor's HTML body.
  // Notes.app renders HTML, so we produce a clean <h1> + meta line + content block.
  const now       = new Date()
  const dateLabel = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const timeLabel = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })
  const noteTitle = (title || 'Meeting Note').trim()
  const subject   = (folder || '').trim()

  const bodyHtml = [
    `<h1>${noteTitle}</h1>`,
    `<p><em>${dateLabel} at ${timeLabel}${subject ? ' &mdash; ' + subject : ''}</em></p>`,
    `<hr>`,
    html || '<p>(no content)</p>',
  ].join('\n')

  // Write body to a temp file — avoids ALL string-escaping issues for arbitrary content.
  const tmpPath = path.join(os.tmpdir(), `ursb-note-${Date.now()}.html`)
  fs.writeFileSync(tmpPath, bodyHtml, 'utf8')

  // Only title and folder name go into the AppleScript string literal.
  // These are short user-supplied strings; we escape " and \ only (no newlines expected).
  function asStr(s) { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') }
  const asTitle  = asStr(noteTitle)
  const asFolder = subject ? asStr(subject) : ''

  // Escape the temp path for use in shell double-quotes (spaces, special chars)
  const escapedTmp = tmpPath.replace(/'/g, "'\\''")

  // Build the AppleScript.
  // Strategy: read note body from disk to avoid multi-line string embedding.
  // If a folder is specified, find-or-create it; otherwise use the default Notes location.
  const folderBlock = asFolder
    ? `
  -- Find or create the subject folder
  if exists folder "${asFolder}" then
    set targetFolder to folder "${asFolder}"
  else
    set targetFolder to make new folder with properties {name:"${asFolder}"}
  end if
  make new note at targetFolder with properties {name:"${asTitle}", body:noteBody}`
    : `
  make new note with properties {name:"${asTitle}", body:noteBody}`

  const script = `tell application "Notes"
  activate
  -- Read the note body from a temp file (safe for any HTML content)
  set noteBody to do shell script "cat '" & "${escapedTmp}" & "'"
  ${folderBlock.trim()}
end tell`

  // Script arrives on stdin ('-') rather than -e so multi-line source stays
  // intact. spawnSync blocks the UI for up to 15s — acceptable only because
  // this is an explicit, user-initiated one-shot action.
  const result = spawnSync('osascript', ['-'], {
    input: script, encoding: 'utf8', timeout: 15000,
  })

  // Clean up temp file regardless of outcome
  try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }

  if (result.status !== 0) {
    const msg = (result.stderr || '').trim() || 'AppleScript returned non-zero exit code.'
    return { error: msg }
  }
  return { ok: true }
})

// ── Scan installed apps ───────────────────────────────────────────
ipcMain.handle('apps:scan', async () => {
  const dirs = [
    '/Applications',
    path.join(os.homedir(), 'Applications'),
  ]
  const results = new Set()
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    fs.readdirSync(dir).forEach(f => {
      if (f.endsWith('.app')) results.add(f.replace(/\.app$/, ''))
    })
  }
  return [...results].sort((a, b) => a.localeCompare(b))
})

// ── Focus guard ───────────────────────────────────────────────────
// Study-mode enforcement: every 2s, check the frontmost app; if it isn't on the
// allowlist, hide the offending apps, jump our window to the front and nudge.
// Requires the Accessibility (TCC) grant — without it every osascript call
// fails and the guard silently does nothing (see the catch in _checkFrontmost).
//
// State is module-global, not per-window, because there is only ever one window.
// _guardInterval doubles as the "is the guard running?" flag; guard:start is
// idempotent via the early return, and window-all-closed also clears it so the
// timer can't outlive the UI.
// Matching is SUBSTRING, not equality — 'dock' also matches 'Docker'. Intended
// loose, but it means a short allowlist entry can whitelist far more than meant.
let _guardInterval  = null
let _guardAllowed   = []    // lowercase app name substrings
// System processes that must never be hidden — hiding loginwindow/Dock would
// leave the machine unusable. 'electron' covers the unpackaged dev build, whose
// process name isn't 'ur study bro'.
const ALWAYS_ALLOWED = ['ur study bro', 'electron', 'finder', 'system preferences',
                         'system settings', 'loginwindow', 'dock', 'menubar']

ipcMain.on('guard:start', (_e, allowedApps) => {
  if (!Array.isArray(allowedApps)) return
  _guardAllowed = allowedApps.filter(a => typeof a === 'string').map(a => a.toLowerCase())
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.setAlwaysOnTop(true, 'floating')
  if (_guardInterval) return
  _guardInterval = setInterval(_checkFrontmost, 2000)
})

ipcMain.on('guard:stop', () => {
  clearInterval(_guardInterval)
  _guardInterval = null
  const win = BrowserWindow.getAllWindows()[0]
  if (win) win.setAlwaysOnTop(false)
})

// Runs on the 2s interval. NOTE: execSync/spawnSync here block the main process
// — i.e. the whole UI stutters briefly every 2 seconds while the guard is on.
// The timeouts are the only thing bounding that.
function _checkFrontmost() {
  try {
    const frontmost = execSync(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      { timeout: 1500, stdio: ['pipe','pipe','ignore'] }
    ).toString().trim().toLowerCase()

    const allowed = [...ALWAYS_ALLOWED, ..._guardAllowed]
    const ok = allowed.some(a => frontmost.includes(a))
    if (!ok) {
      // Build the AppleScript allowed-name list for comparison. Each name is
      // escaped (\\ then ") so a name containing a double-quote can no longer
      // break out of the string literal and inject arbitrary AppleScript — the
      // same protection asStr() gives notes:sync. Names reach here from
      // guard:start (the renderer's custom "add an app" field and apps:scan).
      const allowedNames = [...ALWAYS_ALLOWED, ..._guardAllowed]
        .map(n => `"${n.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
        .join(', ')

      // Hide every process whose name doesn't match any allowed substring.
      // The `tr` shell-out is how we lowercase inside AppleScript (it has no
      // native case-folding); quoted form of makes THAT part injection-safe,
      // which makes the unescaped allowedList above all the more inconsistent.
      const script = `
        tell application "System Events"
          set allowedList to {${allowedNames}}
          repeat with proc in (every application process whose visible is true)
            set pname to (name of proc) as text
            set plow to do shell script "echo " & quoted form of pname & " | tr '[:upper:]' '[:lower:]'"
            set isAllowed to false
            repeat with a in allowedList
              if plow contains a then
                set isAllowed to true
                exit repeat
              end if
            end repeat
            if not isAllowed then
              set visible of proc to false
            end if
          end repeat
        end tell
      `
      const guardResult = spawnSync('osascript', ['-e', script], { timeout: 3000 })
      if (guardResult.status !== 0) {
        console.error('[guard] hide script failed:', (guardResult.stderr || '').toString().trim())
      }

      // Bring our window to front and send the nudge
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.show()
        win.focus()
        win.webContents.send('guard:nudge', frontmost)
      }
    }
  // Swallowed because the common case is a missing Accessibility grant, which
  // would otherwise throw every 2s. Downside: it hides every other failure too,
  // including a malformed script from the injection bug above.
  } catch { /* ignore — Accessibility access not granted */ }
}

// ══════════════════════════════════════════════════════════════════
//  EMAIL SUBSYSTEM
// ══════════════════════════════════════════════════════════════════
// Three backends, one output shape. Every path resolves to
//   { emails: [{ id, subject, from, date, text, meeting }] }  or  { error }
// where `meeting` is detectMeeting()'s parse (or null). Keep that shape if you
// add a backend — emails.html/calendar.html depend on it.
//
//   email:fetch       macOS -> Mail.app via AppleScript
//                     Windows -> Outlook via PowerShell COM
//   email:fetch-imap  manual IMAP credentials, any OS
//
// The two native paths deliberately reuse the host mail client's existing
// accounts, so the app never handles the user's password — that is the whole
// point of preferring them over IMAP.

// ── Email: platform-aware fetch ───────────────────────────────────
ipcMain.handle('email:fetch', async (_e, { limit = 30 } = {}) => {
  if (process.platform === 'darwin') return _fetchMacMail(limit)
  if (process.platform === 'win32')  return _fetchWinOutlook(limit)
  return { error: 'Auto-fetch not supported on this OS. Use IMAP instead.' }
})

// Promise-wrapped execFile so the native mail fetch does NOT block the main
// process (spawnSync would freeze the whole UI for the timeout). Resolves to
// {err, stdout, stderr}; a timeout kill shows up as err.killed / err.signal.
function _execFileAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (err, stdout, stderr) =>
      resolve({ err, stdout: stdout || '', stderr: stderr || '' }))
  })
}

// macOS — AppleScript → Mail.app (any account: Gmail, iCloud, Exchange…)
// Output is one flat string, records joined by '###' and fields by '|||', then
// split by _parseDelimited. Crude, and it corrupts any message that literally
// contains those delimiters (the PowerShell path strips them; this one doesn't).
// Bodies are truncated to 2000 chars to bound the payload.
// The per-message `try` means an unreadable message is skipped rather than
// aborting the whole fetch. The inner INBOX/Inbox retry exists because mailbox
// naming differs by account type (Exchange vs IMAP).
async function _fetchMacMail(limit) {
  const script = `
set output to ""
tell application "Mail"
  set allAccounts to every account
  set msgList to {}
  repeat with acc in allAccounts
    try
      set inboxes to every mailbox of acc whose name is "INBOX"
      if (count of inboxes) = 0 then set inboxes to every mailbox of acc whose name is "Inbox"
      repeat with mb in inboxes
        set mcount to (count of messages of mb)
        if mcount > 0 then
          set topN to ${limit}
          if mcount < topN then set topN to mcount
          -- Mail lists messages newest-first, so message 1..topN is the tail we want.
          repeat with i from 1 to topN
            set end of msgList to (message i of mb)
          end repeat
        end if
      end repeat
    end try
  end repeat
  set outCount to count of msgList
  if outCount > ${limit} then set outCount to ${limit}
  repeat with i from 1 to outCount
    try
      set m to item i of msgList
      set bd to (content of m)
      if length of bd > 2000 then set bd to text 1 thru 2000 of bd
      -- Emit a parseable local ISO-ish date (YYYY-MM-DDTHH:MM:SS); the plain
      -- 'as string' form is a locale string JS Date() cannot parse.
      set dr to date received of m
      set moNum to (month of dr) as integer
      set y to (year of dr) as text
      set mo to text -2 thru -1 of ("0" & (moNum as text))
      set dy to text -2 thru -1 of ("0" & ((day of dr) as text))
      set secs to (time of dr)
      set hh to text -2 thru -1 of ("0" & ((secs div 3600) as text))
      set mm to text -2 thru -1 of ("0" & (((secs mod 3600) div 60) as text))
      set ss to text -2 thru -1 of ("0" & ((secs mod 60) as text))
      set dstr to y & "-" & mo & "-" & dy & "T" & hh & ":" & mm & ":" & ss
      set output to output & (subject of m) & "|||" & (sender of m) & "|||" & dstr & "|||" & bd & "###"
    end try
  end repeat
end tell
return output`

  // Async execFile so the UI is not frozen for the fetch, and the script pulls
  // only the newest `limit` messages per inbox instead of materializing every
  // message of every inbox before slicing (cost now scales with `limit`).
  const { err, stdout, stderr } = await _execFileAsync(
    'osascript', ['-e', script], { timeout: 30000, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
  if (err) {
    if (err.killed || err.signal === 'SIGTERM') return { error: 'Mail.app took too long — try a smaller limit.' }
    return { error: (stderr || '').trim() || 'AppleScript failed. Make sure Mail.app is open and has accounts.' }
  }
  return _parseDelimited((stdout || '').trim())
}

// Windows — PowerShell COM → Outlook (any account configured in Outlook)
// Mirrors _fetchMacMail's '|||'/'###' output so both feed _parseDelimited.
// Unlike the mac path this one strips the delimiters out of bodies first, and
// sorts server-side then takes the top N (so it does NOT enumerate everything).
// GetDefaultFolder(6) is olFolderInbox. ReceivedTime is formatted 'o' (ISO
// round-trip); the mac path now emits a comparable local ISO-ish string so both
// feed _parseDelimited cleanly.
// Runs via async execFile so it does not block the UI, same as the mac path.
async function _fetchWinOutlook(limit) {
  const ps = `
$ErrorActionPreference = 'Stop'
try {
  $ol = New-Object -ComObject Outlook.Application
  $ns = $ol.GetNamespace('MAPI')
  $inbox = $ns.GetDefaultFolder(6)
  $items = $inbox.Items
  $items.Sort('[ReceivedTime]', $true)
  $count = [Math]::Min($items.Count, ${limit})
  $out = ''
  for ($i = 1; $i -le $count; $i++) {
    $m = $items.Item($i)
    $body = $m.Body
    if ($body.Length -gt 2000) { $body = $body.Substring(0, 2000) }
    $body = $body -replace '\\|\\|\\|','|' -replace '###',''
    $out += $m.Subject + '|||' + $m.SenderEmailAddress + '|||' + $m.ReceivedTime.ToString('o') + '|||' + $body + '###'
  }
  Write-Output $out
} catch {
  Write-Error $_.Exception.Message
}`

  const { err, stdout, stderr } = await _execFileAsync(
    'powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30000, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
  if (err) {
    if (err.killed || err.signal === 'SIGTERM') return { error: 'Outlook took too long — try a smaller limit.' }
    return { error: (stderr || '').trim() || 'Could not open Outlook. Make sure Outlook is installed and has accounts.' }
  }
  return _parseDelimited((stdout || '').trim())
}

// IMAP fallback — Gmail, custom, etc.
// The only path where the app itself handles the user's mail password (passed
// per-call from the renderer; nothing is persisted here). Callback-based, so the
// whole thing is wrapped in a Promise that ONLY ever resolves — errors come back
// as {error}, matching the other two backends.
ipcMain.handle('email:fetch-imap', async (_e, { host, port, user, password, tls, limit = 30 }) => {
  return new Promise((resolve) => {
    const Imap = require('imap')
    const { simpleParser } = require('mailparser')
    // TLS certificate verification is left at Node's secure default
    // (rejectUnauthorized:true), so a MITM presenting a self-signed cert is
    // rejected rather than handed the user's mail password in cleartext.
    const imap = new Imap({ host, port: port || 993, user, password, tls: tls !== false })
    const emails = []

    // Single funnel for both success and failure — guarantees imap.end() runs
    // exactly once and the outer Promise settles on every path.
    function done(err) {
      try { imap.end() } catch {}
      if (err) resolve({ error: err.message || String(err) })
      else resolve({ emails })
    }

    imap.once('error', done)
    imap.once('ready', () => {
      // openBox(..., true, ...) = READ-ONLY: opening the box must not mark
      // anything as seen in the user's real mailbox.
      imap.openBox('INBOX', true, (err, box) => {
        if (err) return done(err)
        const total = box.messages.total
        if (!total) return done(null)
        // Sequence numbers are 1-based and ordered oldest->newest, so the last
        // `limit` messages are the newest ones. bodies:'' fetches full RFC822.
        const start = Math.max(1, total - limit + 1)
        const fetch = imap.seq.fetch(`${start}:${total}`, { bodies: '' })
        // Message bodies stream in concurrently and out of order; collect a
        // promise per message and await them all at 'end'.
        const pending = []
        fetch.on('message', msg => {
          const p = new Promise(res => {
            // Collect the raw Buffer chunks and concat once, then hand the Buffer
            // to simpleParser so it decodes per the message's own charset header.
            // Concatenating as a string (raw += d) would UTF-8-decode each chunk
            // in isolation, corrupting multi-byte chars split across a chunk
            // boundary and any non-UTF-8 charset before the parser ever runs.
            const chunks = []
            msg.on('body', s => s.on('data', d => chunks.push(d)))
            msg.once('end', () => res(Buffer.concat(chunks)))
          })
          pending.push(p)
        })
        fetch.once('end', async () => {
          const raws = await Promise.all(pending)
          for (const raw of raws) {
            try {
              const parsed = await simpleParser(raw)
              const text = (parsed.text || '').slice(0, 2000)
              emails.push({
                id: parsed.messageId || String(Math.random()),
                subject: parsed.subject || '(no subject)',
                from: parsed.from?.text || '',
                date: parsed.date?.toISOString() || new Date().toISOString(),
                text, meeting: detectMeeting(text, parsed.subject || ''),
              })
            } catch {}
          }
          // Fetched oldest-first; the UI wants newest-first.
          emails.reverse()
          done(null)
        })
        fetch.once('error', done)
      })
    })
    imap.connect()
  })
})

// Shared tail of the two native backends: '###'-separated records of
// subject|||from|||date|||body -> the common email object shape.
// `id` is just the array index, so ids are NOT stable across fetches — anything
// persisting a reference to an email must not rely on it.
function _parseDelimited(raw) {
  if (!raw) return { emails: [] }
  const emails = raw.split('###').filter(Boolean).map((chunk, i) => {
    const [subject, from, dateStr, text] = chunk.split('|||')
    const body = (text || '').trim()
    // The mac path now emits a parseable local ISO-ish date (YYYY-MM-DDTHH:MM:SS)
    // and Windows emits round-trip ISO. If parsing still fails, return null so
    // the UI can show 'unknown date' rather than fabricating the current time.
    const parsedDate = new Date(dateStr || '')
    const date = isNaN(parsedDate) ? null : parsedDate.toISOString()
    return { id: String(i), subject: (subject||'(no subject)').trim(), from: (from||'').trim(), date, text: body, meeting: detectMeeting(body, subject||'') }
  })
  return { emails }
}

// ── Meeting detection (regex heuristics over email text) ─────────
// Turns a raw email into {link, dateStr, timeStr, summary} or null. This drives
// the "Add to Calendar" / "Join Meeting" affordances, including the native
// notification's Join button — so its output is trusted by the UI even though
// its input is arbitrary mail from anyone.
// Purely heuristic and English-only; all four fields are best-effort and any of
// them can be null while the parse still "succeeds".
function detectMeeting(body, subject) {
  const combined = (subject + ' ' + body).toLowerCase()
  const isMeeting = /\b(meeting|call|zoom|webinar|conference|interview|standup|sync|catch[\s-]up|google meet|teams|webex)\b/.test(combined)
  if (!isMeeting) return null

  // Extract link — the host is anchored: any subdomains must each end in a dot,
  // and the matched host must be immediately followed by /, ?, # or end-of-URL.
  // That rejects the lookalikes the old substring match accepted
  // (meet.google.com.evil.tld, evilzoom.us, zoom.us.attacker.tld, and the
  // userinfo trick meet.google.com@evil.tld), so only genuine meeting hosts get
  // a trusted "Join Meeting" button.
  const linkMatch = body.match(/https?:\/\/(?:[\w-]+\.)*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com|whereby\.com|meet\.jit\.si)(?=[\/?#]|$)[^\s"<>]*/i)
  const link = linkMatch ? linkMatch[0] : null

  // Extract date — look for patterns like "May 20", "2026-05-20", "20/05/2026"
  const datePatterns = [
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i,
    /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/,
    /\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/,
  ]
  // First pattern to hit wins, so order encodes priority: a written month is
  // unambiguous, ISO next, and the bare numeric form last because DD/MM vs MM/DD
  // cannot be resolved from the string alone.
  let dateStr = null
  for (const re of datePatterns) {
    const m = body.match(re)
    if (m) { dateStr = m[0]; break }
  }

  // Extract time
  const timeMatch = body.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))?)\b/i)
  const timeStr = timeMatch ? timeMatch[0] : null

  // Summary: first 200 chars of relevant sentences
  const sentences = body.split(/[.\n]+/).filter(s => s.trim().length > 10)
  const summary = sentences.slice(0, 3).join('. ').slice(0, 200).trim()

  return { link, dateStr, timeStr, summary }
}

// ── GitHub release update checker ─────────────────────────────────
const https = require('https')

function _semverGt(a, b) {
  if (!a || !b) return false
  const pa = a.replace(/^v/i, '').split('.').map(Number)
  const pb = b.replace(/^v/i, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

ipcMain.handle('app:checkUpdate', async () => {
  try {
    const data = await new Promise((res, rej) => {
      const req = https.get(
        'https://api.github.com/repos/Mr-Pythoneer/Ur-Study-Bro/releases/latest',
        { headers: { 'User-Agent': 'Ur-Study-Bro-App' } },
        (resp) => {
          let d = ''
          resp.on('data', c => d += c)
          resp.on('end', () => { try { res(JSON.parse(d)) } catch { rej(new Error('parse')) } })
        }
      )
      req.on('error', rej)
      req.setTimeout(8000, () => req.destroy(new Error('timeout')))
    })
    const latest  = (data.tag_name  || '').replace(/^v/i, '')
    const current = app.getVersion()
    return { current, latest, hasUpdate: _semverGt(latest, current), url: data.html_url || '' }
  } catch {
    return { current: app.getVersion(), latest: null, hasUpdate: false, url: '' }
  }
})

// ── Auto-updater setup ────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('update:available', info.version)
  })

  autoUpdater.on('download-progress', (prog) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('update:progress', Math.round(prog.percent))
  })

  autoUpdater.on('update-downloaded', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send('update:downloaded')
  })

  autoUpdater.on('error', (err) => {
    console.error('AutoUpdater error:', err.message)
  })

  // Check on launch, then every 4 hours
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000)
}

ipcMain.on('update:install', () => autoUpdater.quitAndInstall())

// ── First-launch flag ─────────────────────────────────────────────
const _firstLaunchFile = () => path.join(app.getPath('userData'), '.first-launch-done')

ipcMain.handle('app:firstLaunchCheck', () => !fs.existsSync(_firstLaunchFile()))
ipcMain.on('app:firstLaunchDone', () => {
  try { fs.writeFileSync(_firstLaunchFile(), '1') } catch {}
})

// ── Permission status (Screen Recording + Accessibility) ──────────
ipcMain.handle('app:permStatus', () => ({
  screen:        require('electron').systemPreferences.getMediaAccessStatus('screen'),
  accessibility: require('electron').systemPreferences.isTrustedAccessibilityClient(false),
}))

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    try { app.dock.setIcon(path.join(__dirname, 'assets', 'icon_1024.png')) } catch (e) { console.error('dock icon:', e.message) }
  }
  createWindow()
  // Only run updater in packaged app, not during dev
  if (app.isPackaged) setupAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  clearInterval(_guardInterval)
  if (process.platform !== 'darwin') app.quit()
})
