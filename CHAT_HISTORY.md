# Ur Study Bro — Vibe Coding Chat History

This file documents the full AI-assisted development conversation for this project.  
Built using **Claude** (Anthropic) via the Claude Code agent.

---

## Session 1 — Project Scaffold

**User:** I want to build a macOS desktop study app called "Clever Snail" using Electron. It should have a sidebar with 5 sections: Welcome, Calendar, Study Mode, Meeting Records, and Rewards.

**Claude:** Planned and scaffolded the full project:
- `package.json` with Electron + electron-builder
- `main.js` — BrowserWindow, contextIsolation, preload
- `preload.js` — contextBridge IPC API
- `renderer/index.html` — sidebar nav + content swap via fetch()
- `renderer/styles/main.css` — CSS custom properties, sidebar, card layout
- `renderer/pages/` — welcome, calendar, study, meetings, rewards stubs

---

## Session 2 — Features Build-out

**User:** Add a Pomodoro timer, focus guard, calendar, rewards/badges, AI chat, email fetch, and Apple Notes sync.

**Claude:** Built out all pages with full functionality:
- **Study Mode** — 4 timer modes (Pomodoro 25, Focus 45, Deep Work 60, Marathon 90), animated ring, Study Points on completion
- **Focus Guard** — allowed-apps list, foreground app polling via AppleScript IPC, AI nudge on violation
- **Calendar** — month/week/list views, event CRUD, meeting links, 5-min native notifications
- **Meeting Records** — session log with subject, rating, notes
- **Rewards** — streak counter, badge grid, 30-day heatmap, custom rewards shop, wishlist
- **AI Tutor** — multi-provider chat (Gemini, Claude, GPT-4o, Groq), per-user API key storage
- **Email Inbox** — Gmail/iCloud/IMAP fetch via AppleScript and node-imap, meeting invite auto-detection
- **Apple Notes sync** — export session notes via AppleScript

---

## Session 3 — Auth System

**User:** Add a login/account system so multiple people can use the app on the same Mac.

**Claude:** Built local multi-account auth:
- SHA-256 password hashing via Web Crypto API
- Accounts stored in `localStorage` as `cs_accounts`
- Per-user data namespaced as `cs_${username}_${key}`
- Sign in / Create Account / Manage tabs on launch overlay
- Session stored in `sessionStorage` (cleared on sign-out)
- User badge in topbar with sign-out dropdown

---

## Session 4 — Cognitive Assessment + AI Report

**User:** Add a psychoeducational cognitive battery — 6 real tests. After, AI should generate a full personalised report.

**Claude:** Built 6-test assessment battery:
1. **Tap the Target (CPT)** — 120 rounds, green/red circles, measures sustained attention + impulse control
2. **Attention Quiz (ASRS)** — 6-question self-report
3. **Number Memory (Digit Span)** — forward + backward span, WISC-style
4. **Learning Style (VARK)** — 3 scenario questions
5. **Brain Switcher (Task Switching)** — rule changes every 5 rounds
6. **Stress Check** — 3 sliders (effort, time pressure, frustration)

Post-assessment: AI generates ADHD risk score, attention narrative, working memory profile, VARK analysis, cognitive flexibility score, and a personalised 5-card study blueprint.

---

## Session 5 — 90-Day Study Path (Duolingo Style)

**User:** Generate a 40-task Duolingo-style study path from the cognitive assessment results.

**Claude:** Built the study path system:
- "Make My Study Plan" button triggers AI to generate 40 tasks in JSON
- Zigzag path layout with animated nodes (done ✓, current glow, locked)
- XP system, 8 named levels (Seedling → Legend), daily 5-task goal ring
- Confetti + XP popup on task completion
- 3 zones: Getting Started, Building Momentum, Advanced
- Milestone trophies every 10 nodes
- Path stored per-user in localStorage

---

## Session 6 — AI Writer + AI Tools

**User:** Add an AI Writer page and an AI Tools page with Assignment Checker, AI Detector, and Humanizer.

**Claude:** Built both pages:
- **AI Writer** — full rich-text editor (contenteditable, toolbar), 9 AI actions (Improve, Shorten, Expand, Fix Grammar, Simplify, Summarise, Change Tone, Translate, Cite Source), save/load named drafts, word count
- **AI Tools** — Assignment Checker (grade prediction, gap analysis, improvement tips), AI Detector (probability score, sentence-level highlighting), Humanizer (rewrites AI text to sound human). All results shown inline — no alert() popups.

---

## Session 7 — Screen Recorder

**User:** Add screen recording to Meeting Records.

**Claude:** Implemented full screen recording:
- `desktopCapturer.getSources()` in main process (requires macOS Screen Recording permission)
- `setDisplayMediaRequestHandler` in Electron session to intercept `getDisplayMedia()` calls
- `recorder:setPreferredSource` IPC — renderer sends selected source ID before calling `getDisplayMedia()`
- Source picker UI in meetings.html with thumbnail previews
- `navigator.mediaDevices.getDisplayMedia()` → MediaRecorder → Blob → save via IPC
- `recorder:save` / `recorder:list` / `recorder:open` / `recorder:delete` IPC handlers
- Saved recordings list with playback, file size, duration
- Friendly permission error card with "Open System Settings" button when Screen Recording denied

**Key fix:** Old `getUserMedia` with `chromeMediaSource: 'desktop'` mandatory constraints is broken in Electron 22+. Switched to `getDisplayMedia` + `setDisplayMediaRequestHandler` pattern.

---

## Session 8 — First Launch Permissions Wizard + Update Checker

**User:** Show permissions prompts on first launch only. Add an update button that only appears when a new GitHub release is out.

**Claude:** Built both:

**First Launch Wizard:**
- Flag file at `app.getPath('userData')/.first-launch-done`
- 4-step overlay: Screen Recording → Accessibility → Notifications → Done
- Each step has "Open System Settings" button + "Already granted / Skip" option
- `app:firstLaunchCheck` and `app:firstLaunchDone` IPC handlers
- `app:permStatus` handler returns live macOS permission states

**Update Checker:**
- Replaced `electron-updater` (requires code signing) with GitHub Releases API
- `https://api.github.com/repos/Mr-Pythoneer/Ur-Study-Bro/releases/latest` fetched via `https` module
- `_semverGt(latest, current)` compares tag_name vs app.getVersion()
- Update banner appears after 4s on launch; rechecks every 4 hours
- Banner has "Download →" link to GitHub release page

---

## Session 9 — Error Handling + Polish

**User:** Test all the features. Fix any alert() dialogs.

**Claude:** Replaced all `alert()` calls with inline error UI:
- **AI Tools** — `showErr(id, msg)` renders inside result panel. Rate limit → human-friendly message. No API key → "🔑 No API key set" with link to Settings.
- **AI Writer** — `friendlyErr(msg)` inline. Empty save → temporary button text change.
- **Screen Recorder** — `showRecError(msg)` inline banner with retry button.
- **Meeting Records** — `recorder:getSources` now returns `{ ok, error, sources }` struct so renderer can distinguish permission-denied from other errors.

---

## Session 10 — Local AI (Ollama) + Icon + v5.0.0

**User:** Make the app use local Ollama models by default instead of Gemini. Give it a proper snail icon. Build v5.0.0.

**Claude:**

**Ollama default:**
- Changed `getApiCfg()` in `ai-tools.html` and `ai-writer.html` to default to `'ollama'` with `llama3.2` as the default model
- Cloud providers (Gemini, Claude, GPT-4o, Groq) still selectable in Settings

**Snail icon:**
- Drew a 1024×1024 PNG snail icon from scratch in pure Python (no dependencies — custom PNG encoder, pixel-level anti-aliased drawing)
- Green snail body with brown spiral shell, cute eyes on stalks, smile
- macOS app icon rounded-rect background in sage green
- Converted to `.icns` via `sips` + `iconutil`

**Build:**
- Bumped `package.json` version to `5.0.0`
- `npm run build` → `dist/Ur Study Bro-5.0.0-arm64.dmg` (Apple Silicon only, as required)
- Built app at `dist/mac-arm64/Ur Study Bro.app`

---

## Session 11 — Website + GitHub Page Update

**User:** Update the landing page to advertise screen recording heavily. Add this chat history file for the vibe coding class.

**Claude:**
- Added `#recording` section to `docs/index.html` with a large feature showcase, fake app mockup showing the recorder UI, and 6 feature cards
- Added "Recording" nav link
- Updated hero subtitle to mention screen recording
- Updated AI section to call out Ollama as the local default
- Updated `README.md` to v5.0.0 with screen recording featured prominently
- Created this `CHAT_HISTORY.md` file

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 35 |
| Frontend | Vanilla HTML / CSS / JS |
| IPC | contextBridge + ipcMain/ipcRenderer |
| Storage | localStorage (per-user namespaced) |
| AI (local) | Ollama — llama3.2 |
| AI (cloud) | Gemini, Claude, GPT-4o, Groq |
| Screen recording | desktopCapturer + getDisplayMedia + MediaRecorder |
| Audio transcription | Whisper / Groq |
| Email | AppleScript (Mail.app) + node-imap |
| Build | electron-builder (arm64 DMG) |
| Hosting | GitHub Pages (landing page) |

---

## Files Changed (Major)

```
main.js                          — main process, all IPC handlers
preload.js                       — contextBridge API surface
renderer/index.html              — app shell, auth, nav, scheduler
renderer/pages/welcome.html      — onboarding, cognitive assessment, study path
renderer/pages/study.html        — timers, focus guard, AI tutor
renderer/pages/meetings.html     — session records, screen recorder
renderer/pages/calendar.html     — calendar, events, email import
renderer/pages/rewards.html      — points, badges, streaks, heatmap
renderer/pages/ai-writer.html    — rich text editor, AI actions
renderer/pages/ai-tools.html     — assignment checker, AI detector, humanizer
build/icon.icns                  — snail app icon
docs/index.html                  — GitHub Pages landing page
README.md                        — project README
CHAT_HISTORY.md                  — this file
```

---

*Built with [Claude](https://claude.ai) — Anthropic AI assistant*
