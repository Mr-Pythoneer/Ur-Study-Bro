# Ur Study Bro

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-4.0.0-blue.svg)](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases)

**Website: https://mr-pythoneer.github.io/Ur-Study-Bro/**

A free, open-source AI-powered desktop study partner built with Electron. Features a full psychoeducational cognitive battery, personalised study plans, focus timers, streaks, rewards, flashcard generation, and more.

## Download v4.0.0

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon M1/M2/M3/M4) | [Ur.Study.Bro-4.0.0-arm64.dmg](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/latest/download/Ur.Study.Bro-4.0.0-arm64.dmg) |
| Windows (x64) | [Ur.Study.Bro.Setup.4.0.0.exe](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/latest/download/Ur.Study.Bro.Setup.4.0.0.exe) |
| Linux (x64) | [Ur.Study.Bro-4.0.0.AppImage](https://github.com/Mr-Pythoneer/Ur-Study-Bro/releases/latest/download/Ur.Study.Bro-4.0.0.AppImage) |

## What's New in v4.0

- 🧠 **Psychoeducational Cognitive Battery** — 6 real timed tests (Digit Span, Symbol Search, CPT, Matrix Reasoning, Reading Rate, Task Switching), 30 items each
- ✨ **AI Cognitive Report** — percentile scores, strengths/weaknesses, recommended timer, 90-day development plan
- 📋 **Personalised Study Guide** — subject-specific guide generated from your cognitive profile (Study Kit → Personalised Study Guide tab)
- 🔔 Assessment prompt appears automatically on new account creation

## Features

- **🧠 Cognitive Assessment** — Full psychoeducational battery on first sign-up; AI synthesises results into a personalised learning profile
- **⏱ 4 Focus Timers** — Pomodoro 25, Focus 45, Deep Work 60, Marathon 90 — each awards Study Points on completion
- **🛡 Focus Guard** — Define allowed apps; switch away and the app snaps you back with an AI nudge
- **📅 Calendar** — Month, week, and list views; meeting links; 5-minute native notifications; auto-import from email
- **📝 Session Records** — Manual log, screen recording, lecture audio transcription (Whisper/Groq)
- **📚 Study Kit** — AI summary, flashcards, exam Q&A from your notes; Personalised Study Guide from your cognitive profile
- **✉️ Email Inbox** — Connect Gmail, iCloud, or any IMAP account; auto-detect meeting invites
- **🤖 AI Tutor** — Full chat with Gemini, Claude, GPT-4o, or Groq; Quick Ask floating widget always visible
- **✍️ AI Writer** — Distraction-free editor with 9 AI actions (Improve, Shorten, Expand, Summarise, Translate, and more)
- **🏆 Rewards & Streaks** — Earn points, unlock badges, 30-day heatmap, milestone bonuses, custom rewards shop

## Running from source

```bash
npm install
npm start
```

## Build

```bash
npm run build   # produces dist/Ur Study Bro-4.0.0-arm64.dmg (Apple Silicon)
```

## Tech Stack

- [Electron](https://www.electronjs.org/) — desktop shell
- Vanilla HTML / CSS / JS — no framework
- LocalStorage — all data stored on-device, fully offline
