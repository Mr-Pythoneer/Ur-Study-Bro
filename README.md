# Ur Study Bro

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-5.2.5-blue.svg)](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases)

**Website: https://mr-pythoneer.github.io/Ur-Study-Bro/**

A free, open-source AI-powered desktop study partner built with Electron. Features a full psychoeducational cognitive battery, personalised study plans, focus timers, streaks, rewards, **built-in screen recorder**, flashcard generation, and more.

## ⬇️ Download — v5.2.5

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon M1+) | [**Ur.Study.Bro-5.2.5-arm64.dmg**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/Ur.Study.Bro-5.2.5-arm64.dmg) |
| Windows (x64) | [**Ur.Study.Bro.Setup.5.2.5.exe**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/Ur.Study.Bro.Setup.5.2.5.exe) |
| Linux (x64) | [**Ur.Study.Bro-5.2.5.AppImage**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/Ur.Study.Bro-5.2.5.AppImage) |

> All releases: [github.com/Mr-Pythoneer/Ur-Study-Bro/releases](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases)

> **macOS: "App is damaged and can't be opened"?**
> This is because the app isn't signed with a paid Apple certificate. It's safe — run this in Terminal to fix it:
> ```
> xattr -cr "/Applications/Ur Study Bro.app"
> ```
> Then open the app normally.

## What's New in v5.0

- 🔴 **Screen Recorder** — Built-in screen recording in Meeting Records. Pick any window or full display, record, save locally. Playback inside the app.
- 🤖 **Local AI by default** — Now defaults to Ollama (runs on your machine, no API key needed). Cloud providers still supported.
- 🐌 **New snail icon** — Proper app icon replacing the placeholder.
- 🔔 **First-launch permissions wizard** — Walks through Screen Recording, Accessibility, and Notifications on first open.
- 🔄 **Auto-update checker** — Checks GitHub Releases and shows a banner when a new version is available.

## Features

- **🔴 Screen Recorder** — Record your screen or any window directly in the app. Videos saved locally, playback built in. No third-party software needed.
- **🎙 Audio Transcription** — Record mic audio during lectures; transcribe via Whisper/Groq. Transcript drops into session notes.
- **🧠 Cognitive Assessment** — Full psychoeducational battery on first sign-up; AI synthesises results into a personalised learning profile
- **⏱ 4 Focus Timers** — Pomodoro 25, Focus 45, Deep Work 60, Marathon 90 — each awards Study Points on completion
- **🛡 Focus Guard** — Define allowed apps; switch away and the app snaps you back with an AI nudge
- **📅 Calendar** — Month, week, and list views; meeting links; 5-minute native notifications; auto-import from email
- **📝 Session Records** — Manual log, screen recording, lecture audio transcription (Whisper/Groq)
- **📚 Study Kit** — AI summary, flashcards, exam Q&A from your notes; Personalised Study Guide from your cognitive profile
- **✉️ Email Inbox** — Connect Gmail, iCloud, or any IMAP account; auto-detect meeting invites
- **🤖 AI Tutor** — Full chat with Ollama (local), Gemini, Claude, GPT-4o, or Groq; Quick Ask floating widget always visible
- **✍️ AI Writer** — Distraction-free editor with 9 AI actions (Improve, Shorten, Expand, Summarise, Translate, and more)
- **🏆 Rewards & Streaks** — Earn points, unlock badges, 30-day heatmap, milestone bonuses, custom rewards shop

## Running from source

```bash
npm install
npm start
```

## Build

```bash
npm run build   # produces dist/Ur Study Bro-5.2.5-arm64.dmg (Apple Silicon)
```

## Tech Stack

- [Electron](https://www.electronjs.org/) — desktop shell
- Vanilla HTML / CSS / JS — no framework
- LocalStorage — all data stored on-device, fully offline
- [Ollama](https://ollama.com/) — local AI (default, no API key needed)

## Chat History

See [CHAT_HISTORY.md](CHAT_HISTORY.md) for the full vibe-coding development conversation.
