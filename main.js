// Copyright (c) 2026 Mr_Pythoneer — MIT License
const {
  app, BrowserWindow, ipcMain, shell,
  Notification, desktopCapturer,
} = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { execSync, spawnSync } = require('child_process')
const Imap = require('imap')
const { simpleParser } = require('mailparser')

// ── Window factory ────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    fullscreenable: true,
    backgroundColor: '#f5f5f0',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  win.loadFile('renderer/index.html')
  return win
}

// ── Open URLs in default browser ──────────────────────────────────
ipcMain.on('shell:open', (_e, url) => {
  if (url && /^https?:\/\//i.test(url)) shell.openExternal(url)
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
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  })
  return sources.map(s => ({
    id:        s.id,
    name:      s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }))
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
  if (_guardInterval) return
  _guardInterval = setInterval(_checkFrontmost, 2000)
})

ipcMain.on('guard:stop', () => {
  clearInterval(_guardInterval)
  _guardInterval = null
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
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.show()
        app.focus({ steal: true })
        // Tell renderer to show a toast
        win.webContents.send('guard:nudge', frontmost)
      }
    }
  } catch { /* ignore — user may not have granted Accessibility access */ }
}

// ── Email: fetch & summarise via IMAP ────────────────────────────
ipcMain.handle('email:fetch', async (_e, { host, port, user, password, tls, limit = 20 }) => {
  return new Promise((resolve) => {
    const imap = new Imap({ host, port: port || 993, user, password, tls: tls !== false, tlsOptions: { rejectUnauthorized: false } })
    const emails = []

    function finish(err) {
      try { imap.end() } catch {}
      if (err) resolve({ error: err.message || String(err) })
      else resolve({ emails })
    }

    imap.once('error', finish)
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) return finish(err)
        const total = box.messages.total
        if (total === 0) return finish(null)
        const start = Math.max(1, total - limit + 1)
        const fetch = imap.seq.fetch(`${start}:${total}`, { bodies: '', struct: true })
        const pending = []

        fetch.on('message', (msg) => {
          const p = new Promise((res) => {
            let raw = ''
            msg.on('body', (stream) => stream.on('data', d => raw += d.toString()))
            msg.once('end', () => res(raw))
          })
          pending.push(p)
        })

        fetch.once('error', finish)
        fetch.once('end', async () => {
          const raws = await Promise.all(pending)
          for (const raw of raws) {
            try {
              const parsed = await simpleParser(raw)
              const text = (parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '').slice(0, 3000)
              emails.push({
                id:      parsed.messageId || String(Math.random()),
                subject: parsed.subject   || '(no subject)',
                from:    parsed.from?.text || '',
                date:    parsed.date?.toISOString() || new Date().toISOString(),
                text,
                meeting: detectMeeting(text, parsed.subject || ''),
              })
            } catch { /* skip malformed */ }
          }
          emails.reverse() // newest first
          finish(null)
        })
      })
    })
    imap.connect()
  })
})

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

// ── App lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  clearInterval(_guardInterval)
  if (process.platform !== 'darwin') app.quit()
})
