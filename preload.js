// Copyright (c) 2026 Mr_Pythoneer — MIT License
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // ── External links ──────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.send('shell:open', url),
  focusWindow:  ()    => ipcRenderer.send('window:focus'),

  // ── Native notifications ────────────────────────────────────────
  scheduleNotify: (ev) => ipcRenderer.send('notify:event', ev),

  // ── Focus guard ─────────────────────────────────────────────────
  startGuard: (allowedApps) => ipcRenderer.send('guard:start', allowedApps),
  stopGuard:  ()            => ipcRenderer.send('guard:stop'),
  onGuardNudge:  (cb) => ipcRenderer.on('guard:nudge', (_e, app) => cb(app)),
  offGuardNudge: ()   => ipcRenderer.removeAllListeners('guard:nudge'),

  // ── Screen recorder ─────────────────────────────────────────────
  getSources:           ()        => ipcRenderer.invoke('recorder:getSources'),
  setPreferredSource:   (id)      => ipcRenderer.send('recorder:setPreferredSource', id),
  saveRecording:   (buffer, filename)   => ipcRenderer.invoke('recorder:save', { buffer, filename }),
  listRecordings:  ()                   => ipcRenderer.invoke('recorder:list'),
  openRecording:   (filepath)           => ipcRenderer.invoke('recorder:open', filepath),
  deleteRecording: (filepath)           => ipcRenderer.invoke('recorder:delete', filepath),

  // ── App scanner ─────────────────────────────────────────────────
  scanApps: () => ipcRenderer.invoke('apps:scan'),

  // ── Email fetch ─────────────────────────────────────────────────
  fetchEmails:     (cfg) => ipcRenderer.invoke('email:fetch', cfg),
  fetchEmailsIMAP: (cfg) => ipcRenderer.invoke('email:fetch-imap', cfg),

  // ── Apple Notes sync ────────────────────────────────────────────
  syncToNotes: (payload) => ipcRenderer.invoke('notes:sync', payload),

  // ── AI chat ─────────────────────────────────────────────────────
  askAI:          (payload) => ipcRenderer.invoke('ai:chat', payload),
  transcribeAudio:(payload) => ipcRenderer.invoke('ai:transcribe', payload),

  // ── System info ─────────────────────────────────────────────────
  systemInfo: () => ipcRenderer.invoke('system:info'),

  // ── Ollama (local AI) ────────────────────────────────────────────
  ollamaStatus: ()           => ipcRenderer.invoke('ollama:status'),
  ollamaPull:   (model)      => ipcRenderer.invoke('ollama:pull', model),
  onOllamaPullProgress:  (cb) => ipcRenderer.on('ollama:pull-progress', (_e, d) => cb(d)),
  offOllamaPullProgress: ()   => ipcRenderer.removeAllListeners('ollama:pull-progress'),

  // ── First launch + permissions + update ─────────────────────────
  firstLaunchCheck: ()    => ipcRenderer.invoke('app:firstLaunchCheck'),
  firstLaunchDone:  ()    => ipcRenderer.send('app:firstLaunchDone'),
  permStatus:       ()    => ipcRenderer.invoke('app:permStatus'),
  checkUpdate:      ()    => ipcRenderer.invoke('app:checkUpdate'),

  // ── Generic IPC ─────────────────────────────────────────────────
  send:    (channel, ...args) => ipcRenderer.send(channel, ...args),
  receive: (channel, cb)      => ipcRenderer.on(channel, (_e, ...args) => cb(...args)),
})
