// Copyright (c) 2026 Mr_Pythoneer — MIT License
const {
  app, BrowserWindow, ipcMain, shell,
  Notification, desktopCapturer, session, dialog,
} = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { execSync, spawnSync } = require('child_process')
const Imap = require('imap')
const { simpleParser } = require('mailparser')

// ── Preferred source for screen recorder ─────────────────────────
let _preferredSourceId = null
ipcMain.on('recorder:setPreferredSource', (_e, id) => { _preferredSourceId = id })

// ── Window factory ────────────────────────────────────────────────
function createWindow() {
  // Allow renderer to call getDisplayMedia — picks user-selected source if set
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      const preferred = _preferredSourceId
        ? sources.find(s => s.id === _preferredSourceId)
        : null
      callback({ video: preferred || sources[0] })
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  win.loadFile('renderer/index.html')

  // ── Dev: inject test profile if QA_INJECT env var set ────────────
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
ipcMain.on('shell:open', (_e, url) => {
  if (url && /^(https?:\/\/|x-apple\.systempreferences:)/i.test(url)) shell.openExternal(url)
})

// ── Focus main window ─────────────────────────────────────────────
ipcMain.on('window:focus', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) { win.show(); win.focus() }
})

// ── Native macOS notification with "Join Meeting" action ──────────
ipcMain.on('notify:event', (_e, ev) => {
  if (!Notification.isSupported()) return
  const body = [`⏰ Starting in ~5 minutes`]
  if (ev.startLabel) body.push(`🕐 ${ev.startLabel}`)
  if (ev.link)       body.push(`🔗 ${ev.linkLabel || 'Meeting link ready'}`)

  const n = new Notification({
    title:           ev.title,
    body:            body.join('\n'),
    actions:         ev.link ? [{ type: 'button', text: 'Join Meeting' }] : [],
    closeButtonText: 'Dismiss',
  })
  n.on('click',   () => { BrowserWindow.getAllWindows()[0]?.focus(); if (ev.link) shell.openExternal(ev.link) })
  n.on('action',  (_e2, i) => { if (i === 0 && ev.link) shell.openExternal(ev.link) })
  n.show()
})

// ── Screen recorder: get sources ──────────────────────────────────
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
ipcMain.handle('recorder:save', async (_e, { buffer, filename }) => {
  const dir = path.join(os.homedir(), 'Documents', 'Ur Study Bro', 'Recordings')
  fs.mkdirSync(dir, { recursive: true })
  const filepath = path.join(dir, filename)
  fs.writeFileSync(filepath, Buffer.from(buffer))
  return { filepath, size: fs.statSync(filepath).size }
})

// ── Screen recorder: list saved recordings ────────────────────────
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
ipcMain.handle('ai:transcribe', async (_e, { audioBuffer, provider, apiKey }) => {
  try {
    const { net } = require('electron')
    const buf = Buffer.from(audioBuffer)
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)

    // Build multipart/form-data manually (no DOM FormData in main process)
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
    })
    const data = await res.json()
    if (!res.ok) return { error: data.error?.message || JSON.stringify(data) }
    return { transcript: data.text || '', segments: data.segments || [] }
  } catch(e) {
    return { error: e.message }
  }
})

// ── AI chat (proxied through main to avoid CORS) ──────────────────
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

    } else if (provider === 'gemini') {
      const m = model || 'gemini-2.0-flash'
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
      const ollamaModel = model || 'gemma3:1b'
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

    const res = await net.fetch(url, { method: 'POST', headers, body })
    const data = await res.json()
    if (!res.ok) return { error: data.error?.message || data.error?.status || JSON.stringify(data) }
    return { reply: extractReply(data) || '' }
  } catch (e) {
    return { error: e.message }
  }
})

// ── System info ──────────────────────────────────────────────────
ipcMain.handle('system:info', async () => {
  const cpus    = os.cpus()
  const cpu     = cpus[0] || {}
  const cores   = cpus.length
  const ramGB   = Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10
  const ramFreeGB = Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10
  const platform = os.platform()         // darwin | win32 | linux
  const arch     = os.arch()             // arm64 | x64

  // Apple Silicon detection
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
ipcMain.handle('ollama:status', async () => {
  try {
    const { net } = require('electron')
    const res = await net.fetch('http://localhost:11434/api/tags', { method: 'GET' })
    if (!res.ok) return { running: false, models: [] }
    const data = await res.json()
    const models = (data.models || []).map(m => m.name)
    return { running: true, models }
  } catch {
    return { running: false, models: [] }
  }
})

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
let _guardInterval  = null
let _guardAllowed   = []    // lowercase app name substrings
const ALWAYS_ALLOWED = ['ur study bro', 'electron', 'finder', 'system preferences',
                         'system settings', 'loginwindow', 'dock', 'menubar']

ipcMain.on('guard:start', (_e, allowedApps) => {
  _guardAllowed = allowedApps.map(a => a.toLowerCase())
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

function _checkFrontmost() {
  try {
    const frontmost = execSync(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      { timeout: 1500, stdio: ['pipe','pipe','ignore'] }
    ).toString().trim().toLowerCase()

    const allowed = [...ALWAYS_ALLOWED, ..._guardAllowed]
    const ok = allowed.some(a => frontmost.includes(a))
    if (!ok) {
      // Build the AppleScript allowed-name list for comparison
      const allowedNames = [...ALWAYS_ALLOWED, ..._guardAllowed]
        .map(n => `"${n}"`)
        .join(', ')

      // Hide every process whose name doesn't match any allowed substring
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
      spawnSync('osascript', ['-e', script], { timeout: 3000 })

      // Bring our window to front and send the nudge
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.show()
        win.focus()
        win.webContents.send('guard:nudge', frontmost)
      }
    }
  } catch { /* ignore — Accessibility access not granted */ }
}

// ── Email: platform-aware fetch ───────────────────────────────────
ipcMain.handle('email:fetch', async (_e, { limit = 30 } = {}) => {
  if (process.platform === 'darwin') return _fetchMacMail(limit)
  if (process.platform === 'win32')  return _fetchWinOutlook(limit)
  return { error: 'Auto-fetch not supported on this OS. Use IMAP instead.' }
})

// macOS — AppleScript → Mail.app (any account: Gmail, iCloud, Exchange…)
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
        repeat with m in (messages of mb)
          set end of msgList to m
        end repeat
      end repeat
    end try
  end repeat
  set total to count of msgList
  set startIdx to total - ${limit - 1}
  if startIdx < 1 then set startIdx to 1
  repeat with i from total to startIdx by -1
    try
      set m to item i of msgList
      set bd to (content of m)
      if length of bd > 2000 then set bd to text 1 thru 2000 of bd
      set output to output & (subject of m) & "|||" & (sender of m) & "|||" & ((date received of m) as string) & "|||" & bd & "###"
    end try
  end repeat
end tell
return output`

  const result = spawnSync('osascript', ['-e', script], { timeout: 30000, encoding: 'utf8' })
  if (result.status !== 0) return { error: (result.stderr || '').trim() || 'AppleScript failed. Make sure Mail.app is open and has accounts.' }
  return _parseDelimited((result.stdout || '').trim())
}

// Windows — PowerShell COM → Outlook (any account configured in Outlook)
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

  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30000, encoding: 'utf8' })
  if (result.status !== 0) return { error: (result.stderr || '').trim() || 'Could not open Outlook. Make sure Outlook is installed and has accounts.' }
  return _parseDelimited((result.stdout || '').trim())
}

// IMAP fallback — Gmail, custom, etc.
ipcMain.handle('email:fetch-imap', async (_e, { host, port, user, password, tls, limit = 30 }) => {
  return new Promise((resolve) => {
    const Imap = require('imap')
    const { simpleParser } = require('mailparser')
    const imap = new Imap({ host, port: port || 993, user, password, tls: tls !== false, tlsOptions: { rejectUnauthorized: false } })
    const emails = []

    function done(err) {
      try { imap.end() } catch {}
      if (err) resolve({ error: err.message || String(err) })
      else resolve({ emails })
    }

    imap.once('error', done)
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) return done(err)
        const total = box.messages.total
        if (!total) return done(null)
        const start = Math.max(1, total - limit + 1)
        const fetch = imap.seq.fetch(`${start}:${total}`, { bodies: '' })
        const pending = []
        fetch.on('message', msg => {
          const p = new Promise(res => {
            let raw = ''
            msg.on('body', s => s.on('data', d => raw += d))
            msg.once('end', () => res(raw))
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
          emails.reverse()
          done(null)
        })
        fetch.once('error', done)
      })
    })
    imap.connect()
  })
})

function _parseDelimited(raw) {
  if (!raw) return { emails: [] }
  const emails = raw.split('###').filter(Boolean).map((chunk, i) => {
    const [subject, from, dateStr, text] = chunk.split('|||')
    const body = (text || '').trim()
    let date = new Date().toISOString()
    try { date = new Date(dateStr || '').toISOString() } catch {}
    return { id: String(i), subject: (subject||'(no subject)').trim(), from: (from||'').trim(), date, text: body, meeting: detectMeeting(body, subject||'') }
  })
  return { emails }
}

function detectMeeting(body, subject) {
  const combined = (subject + ' ' + body).toLowerCase()
  const isMeeting = /\b(meeting|call|zoom|webinar|conference|interview|standup|sync|catch[\s-]up|google meet|teams|webex)\b/.test(combined)
  if (!isMeeting) return null

  // Extract link
  const linkMatch = body.match(/https?:\/\/([\w.-]*zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com|whereby\.com|meet\.jit\.si)[^\s"<>]*/i)
  const link = linkMatch ? linkMatch[0] : null

  // Extract date — look for patterns like "May 20", "2026-05-20", "20/05/2026"
  const datePatterns = [
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i,
    /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/,
    /\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/,
  ]
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
