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
  onGuardNudge: (cb) => ipcRenderer.on('guard:nudge', (_e, app) => cb(app)),

  // ── Screen recorder ─────────────────────────────────────────────
  getSources:      ()                   => ipcRenderer.invoke('recorder:getSources'),
  saveRecording:   (buffer, filename)   => ipcRenderer.invoke('recorder:save', { buffer, filename }),
  listRecordings:  ()                   => ipcRenderer.invoke('recorder:list'),
  openRecording:   (filepath)           => ipcRenderer.invoke('recorder:open', filepath),
  deleteRecording: (filepath)           => ipcRenderer.invoke('recorder:delete', filepath),

  // ── App scanner ─────────────────────────────────────────────────
  scanApps: () => ipcRenderer.invoke('apps:scan'),

  // ── Apple Notes sync ────────────────────────────────────────────
  syncToNotes: (payload) => ipcRenderer.invoke('notes:sync', payload),
})
