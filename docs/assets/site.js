  // ── site.js — shared JS for the marketing website ──────────────────
  // Loaded (after assets/i18n.js) by every docs/*.html page. Runs on DOM
  // that varies per page, so EVERY DOM lookup is null-guarded — a page
  // without #heroDl / #heatmap / #macWarning simply skips that block.
  // Handles: OS detection, the GitHub-releases-driven download buttons,
  // the macOS Gatekeeper copy helper, FAQ accordion, and nav active-state.
  // Note: uses regex lookbehind — breaks on Safari/iOS < 16.4 (see audit).

  // Heatmap (only on pages that include the rewards mockup)
  const _hm = document.getElementById('heatmap')
  if (_hm) [0,1,0,2,1,3,2,1,0,1,2,3,4,3,2,1,2,3,4,4,3,2,3,4,3,4,3,4,4,3].forEach(l => {
    const d = document.createElement('div'); d.className = 'hm l' + l
    _hm.appendChild(d)
  })

  // OS detection
  const ua = navigator.userAgent
  const isIOS     = /iPhone|iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isMac     = /Mac/.test(ua) && !isIOS
  const isWindows = /Win/.test(ua)
  const isLinux   = /Linux/.test(ua) && !/Android/.test(ua)

  const ICONS = {
    ios:    `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M17 2H7C5.9 2 5 2.9 5 4v16c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 18c-.83 0-1.5-.67-1.5-1.5S11.17 17 12 17s1.5.67 1.5 1.5S12.83 20 12 20zm5-4H7V4h10v12z"/></svg>`,
    mac:    `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`,
    win:    `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M3 12V6.75l6-1.32v6.57H3zm17 0V3.25L11 2v10h9zM3 13h6v6.43l-6-1.29V13zm17 0h-9v10l9-1.75V13z"/></svg>`,
    linux:  `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M20.581 19.049c-.55.366-1.78-.172-2.742-1.196-.96-1.025-1.433-2.277-.883-2.643.55-.365 1.78.172 2.742 1.197.96 1.025 1.432 2.276.883 2.642zm-18.69-2.698c-.508.364-.22 1.398.642 2.311.863.912 1.978 1.363 2.486 1 .509-.366.22-1.4-.64-2.312-.862-.912-1.978-1.364-2.488-1zm10.548-9.849c-1.364 1.283-1.843 3.094-1.06 4.12.781 1.025 2.657.93 4.077-.37 1.42-1.3 1.87-3.154 1.088-4.179-.782-1.025-2.741-.854-4.105.43zM12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"/></svg>`,
    github: `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
  }

  // Build PLATFORMS dynamically from GitHub API so links never go stale
  const FALLBACK = {
    mac:   'https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/latest',
    win:   'https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/latest',
    linux: 'https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/latest',
  }
  // label/sub are i18n KEYS resolved via t() at render time, so switching
  // language re-localises the buttons. Only href/icon/comingSoon are literal.
  let PLATFORMS = {
    ios:          { labelKey: 'dl.ios.label',  subKey: 'dl.comingSoon',          href: 'https://github.com/Mr-Pythoneer/Ur-Study-Bro', comingSoon: true, icon: ICONS.ios },
    mac:          { labelKey: 'dl.mac.label',  subKey: 'dl.mac.sub',             href: FALLBACK.mac, icon: ICONS.mac },
    mac_x64:      { labelKey: 'dl.mac.label',  subKey: 'dl.mac_x64.sub',         href: FALLBACK.mac, icon: ICONS.mac },
    mac_universal:{ labelKey: 'dl.mac.label',  subKey: 'dl.mac_universal.sub',   href: FALLBACK.mac, icon: ICONS.mac },
    win:          { labelKey: 'dl.win.label',  subKey: 'dl.win.sub',             href: FALLBACK.win, icon: ICONS.win },
    linux:        { labelKey: 'dl.linux.label',subKey: 'dl.linux.sub',           href: FALLBACK.linux, icon: ICONS.linux },
    linux_arm64:  { labelKey: 'dl.linux.label',subKey: 'dl.linux_arm64.sub',     href: FALLBACK.linux, icon: ICONS.linux },
    linux_arch:   { labelKey: 'dl.linux.label',subKey: 'dl.linux_arch.sub',      href: FALLBACK.linux, icon: ICONS.linux },
    github:       { labelKey: 'dl.github.label',subKey: 'dl.github.sub',         href: 'https://github.com/Mr-Pythoneer/Ur-Study-Bro', icon: ICONS.github },
  }

  // Fetch real asset URLs from GitHub API
  fetch('https://api.github.com/repos/Mr-Pythoneer/Ur-Study-Bro/releases/latest', {headers:{'User-Agent':'USB-site'}})
    .then(r => r.json()).then(data => {
      const assets = data.assets || []
      const find = (pat) => (assets.find(a => pat.test(a.name)) || {}).browser_download_url
      const macArmUrl  = find(/arm64\.dmg$/)
      // Intel DMG has no arch suffix — match .dmg that isn't arm64 or universal
      const macX64Url  = find(/(?<!arm64|universal)\.dmg$/)
      const macUniUrl  = find(/universal\.dmg$/)
      const winUrl     = find(/\.exe$/)
      // x64 AppImage: no arch suffix
      const linuxUrl   = find(/(?<!arm64)\.AppImage$/)
      const linuxArmUrl= find(/arm64\.AppImage$/)
      const archUrl    = find(/(?<!aarch64)\.pacman$/)
      if (macArmUrl)   { PLATFORMS.mac.href           = macArmUrl }
      if (macX64Url)   { PLATFORMS.mac_x64.href       = macX64Url }
      if (macUniUrl)   { PLATFORMS.mac_universal.href = macUniUrl }
      if (winUrl)      { PLATFORMS.win.href            = winUrl }
      if (linuxUrl)    { PLATFORMS.linux.href          = linuxUrl }
      if (linuxArmUrl) { PLATFORMS.linux_arm64.href   = linuxArmUrl }
      if (archUrl)     { PLATFORMS.linux_arch.href    = archUrl }
      renderDl('heroDl')
      renderDl('ctaDl')
    }).catch(() => {})

  // Primary = detected OS; others = the 2 most common alternatives + GitHub
  const primary = isIOS ? 'ios' : isMac ? 'mac' : isWindows ? 'win' : isLinux ? 'linux' : 'mac'
  const others  = isIOS
    ? ['mac', 'win', 'github']
    : isMac
      ? ['win', 'linux', 'github']
      : isWindows
        ? ['mac', 'linux', 'github']
        : isLinux
          ? ['mac', 'win', 'github']
          : ['win', 'linux', 'github']

  function primaryBtn(p) {
    const pl = PLATFORMS[p]
    if (pl.comingSoon) return `
      <div style="display:inline-flex;align-items:center;gap:10px;padding:10px 20px;border-radius:8px;border:1px solid var(--border);color:var(--text-2);font-size:13px;font-weight:600;">
        ${pl.icon} ${t(pl.labelKey)} <span style="font-size:11px;font-weight:700;background:var(--green-bg);color:var(--green);padding:2px 8px;border-radius:99px;">${t('dl.comingSoon')}</span>
      </div>`
    return `<a class="btn btn-primary" href="${pl.href}">${pl.icon}<span>${t(pl.labelKey)}<br><small style="font-weight:400;opacity:.75;">${t(pl.subKey)}</small></span></a>`
  }
  function secondaryBtn(p) {
    const pl = PLATFORMS[p]
    return `<a class="btn btn-ghost" href="${pl.href}" ${p==='github'?'target="_blank"':''}>${pl.icon}<span style="font-size:12px;">${t(pl.labelKey)}<br><small style="font-weight:400;opacity:.7;">${t(pl.subKey)}</small></span></a>`
  }

  function renderDl(id) {
    const _el = document.getElementById(id)
    if (!_el) return
    _el.innerHTML =
      `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">${primaryBtn(primary)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">${others.map(secondaryBtn).join('')}</div>
        <div style="margin-top:6px;font-size:12px;color:var(--text-3);display:flex;gap:16px;flex-wrap:wrap;justify-content:center;">
          <span>${t('dl.notReady')} <a href="app.html" style="color:var(--green);font-weight:600;">${t('dl.webVersion')}</a></span>
          <span><a href="https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/latest" target="_blank" style="color:var(--text-3);">${t('dl.allVersions')}</a></span>
        </div>
      </div>`
  }

  renderDl('heroDl')
  renderDl('ctaDl')

  // Only show the Gatekeeper fix note to macOS users
  // Show macOS fix for Mac users, and also for anyone who downloaded for Mac
  // (show always if primary platform is mac, or if on mac)
  if (isMac || primary === 'mac') {
    const w = document.getElementById('macWarning')
    if (w) w.style.display = 'block'
  }

  const osName = isIOS ? 'iOS / iPadOS' : isMac ? 'macOS' : isWindows ? 'Windows' : isLinux ? 'Linux' : 'your platform'
  function renderOsNote() {
    const _hn = document.getElementById('heroNote')
    if (_hn) _hn.textContent = t('hero.detected').replace('{os}', osName)
  }
  renderOsNote()

  // macOS copy button
  function copyXattrCmd() {
    navigator.clipboard.writeText('xattr -cr "/Applications/Ur Study Bro.app"').then(() => {
      const btn = document.getElementById('xattrCopyBtn')
      btn.textContent = t('dl.copied')
      setTimeout(() => btn.textContent = t('mac.copy'), 1500)
    })
  }
  window.copyXattrCmd = copyXattrCmd

  // FAQ accordion
  function toggleFaq(btn) {
    const item = btn.closest('.faq-item')
    const isOpen = item.classList.contains('open')
    document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'))
    if (!isOpen) item.classList.add('open')
  }
  window.toggleFaq = toggleFaq

  // Highlight the current page in the nav
  const _pg = document.body.dataset.page
  if (_pg) document.querySelectorAll('nav a[data-page]').forEach(a => {
    a.classList.toggle('active', a.dataset.page === _pg)
  })
