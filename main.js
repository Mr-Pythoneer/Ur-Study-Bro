const {
  app, BrowserWindow, ipcMain, shell,
  Notification, desktopCapturer,
} = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const { execSync, spawnSync } = require('child_process')

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
