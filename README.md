# Ur Study Bro

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-5.2.6-blue.svg)](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases)

**Website: https://mr-pythoneer.github.io/Ur-Study-Bro/**

A free, open-source AI-powered desktop study partner built with Electron. Features a full psychoeducational cognitive battery, personalised study plans, focus timers, streaks, rewards, **built-in screen recorder**, flashcard generation, and more.

## ⬇️ Download — v5.2.5

| Platform | Download |
|----------|----------|
| macOS — Apple Silicon (M1/M2/M3/M4) | [**Ur.Study.Bro-5.2.5-arm64.dmg**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/Ur.Study.Bro-5.2.5-arm64.dmg) |
| macOS — Intel (2019 and older) | [**Ur.Study.Bro-5.2.5.dmg**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/Ur.Study.Bro-5.2.5.dmg) |
| macOS — Universal (works on both) | [**Ur.Study.Bro-5.2.5-universal.dmg**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/Ur.Study.Bro-5.2.5-universal.dmg) |
| Windows — x64, x86 (32-bit) & ARM64 | [**Ur.Study.Bro.Setup.5.2.5.exe**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/Ur.Study.Bro.Setup.5.2.5.exe) |
| Linux — x64 (Ubuntu, Debian, Fedora, Deepin…) | [**Ur.Study.Bro-5.2.5.AppImage**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/Ur.Study.Bro-5.2.5.AppImage) |
| Linux — ARM64 (Raspberry Pi, ARM laptops) | [**Ur.Study.Bro-5.2.5-arm64.AppImage**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/Ur.Study.Bro-5.2.5-arm64.AppImage) |
| Linux — Arch / Manjaro / EndeavourOS (x64) | [**clever-snail-5.2.5.pacman**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/clever-snail-5.2.5.pacman) |
| Linux — Arch / Manjaro (ARM64) | [**clever-snail-5.2.5-aarch64.pacman**](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/download/v5.2.5/clever-snail-5.2.5-aarch64.pacman) |

> **Not sure which Mac you have?** Click the  → About This Mac. If Chip says "Apple M1/M2/M3/M4" → download arm64. If it says "Intel Core" → download x64.

> All releases: [github.com/Mr-Pythoneer/Ur-Study-Bro/releases](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases)

> ### ⚠️ macOS: "App is damaged and can't be opened"?
> This happens because the app isn't code-signed (that costs $99/yr — this is a free project). It's completely safe. Fix it in 10 seconds:
> 1. Open **Terminal** (Spotlight → search "Terminal")
> 2. Paste this and press Enter:
> ```
> xattr -cr "/Applications/Ur Study Bro.app"
> ```
> 3. Open the app normally — done.

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
npm run build   # produces dist/Ur Study Bro-5.2.6-arm64.dmg (Apple Silicon)
```

## Tech Stack

- [Electron](https://www.electronjs.org/) — desktop shell
- Vanilla HTML / CSS / JS — no framework
- LocalStorage — all data stored on-device, fully offline
- [Ollama](https://ollama.com/) — local AI (default, no API key needed)

## Chat History

See [CHAT_HISTORY.md](CHAT_HISTORY.md) for the full vibe-coding development conversation.
