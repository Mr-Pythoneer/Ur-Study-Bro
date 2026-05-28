# Copyright Evidence — Ur Study Bro / Clever Snail

**© 2026 Mr_Pythoneer — All Rights Reserved**  
Released under the MIT License.  
GitHub: https://github.com/Mr-Pythoneer/Ur-Study-Bro

---

## Proof of Original Authorship

This directory contains complete conversation transcripts (JSONL format) documenting the design, development, and iterative refinement of **Ur Study Bro** by **Mr_Pythoneer** beginning May 2026.

These logs serve as timestamped evidence of original creative and technical authorship.

---

## Session Files

| File | Date | Size | Contents |
|------|------|------|----------|
| `session-main-2026-05-27.jsonl` | 2026-05-27 | ~27 MB | Main development session — full app build including cognitive assessment, AI tutor, study plan |
| `session-2026-05-27b.jsonl` | 2026-05-27 | ~768 KB | Continued session — assessment reports, plan page |
| `session-2026-05-27c.jsonl` | 2026-05-27 | ~1 MB | Continued session — UI polish, icon, Ollama integration |
| `session-2026-05-16.jsonl` | 2026-05-16 | ~21 KB | Early session — project scaffolding |
| `session-2026-05-15.jsonl` | 2026-05-15 | ~36 KB | Initial session — app concept and structure |

---

## What Was Built (Documented in These Logs)

### Core App (Electron, macOS)
- Full Electron desktop app with sidebar navigation
- macOS traffic-light window, drag region, custom 🐌 icon
- 13 pages: Home, Calendar, Study Mode, AI Tutor, Assessment, Study Plan, Rewards, Meetings, Settings, Emails, Study Kit, AI Tools, AI Writer

### Cognitive Assessment (assessment.html)
- **CPT (Continuous Performance Task)**: Go/No-Go paradigm, 120 trials, 80/20 split, canvas rendering, millisecond timing via `performance.now()`
- **ASRS**: 6 validated ADHD screening questions with clinical thresholds
- **Digit Span**: Forward (visual) + Backward (auditory via Web Speech API), adaptive length
- **VARK**: 3 situational scenarios mapping to Visual/Auditory/Read-Write/Kinesthetic styles
- **Rule-Switching Matrix**: 30 rounds, COLOR/SHAPE alternating rules, switching cost calculation
- **NASA-TLX**: Mental demand, temporal demand, frustration sliders
- **Comprehensive report**: Narrative blocks, strengths, growth areas, optimal study blueprint

### AI Study Tutor (ai.html)
- Multi-provider AI chat (Ollama local, Gemini, OpenAI, Anthropic, Groq, Mistral, DeepSeek)
- Ollama auto-selected based on hardware (8-tier model roster by RAM/GPU)
- Conversation history, streaming responses

### Duolingo-Style Study Plan (plan.html)
- 40-node zigzag path with section zones (Getting Started → Building Momentum → Advanced Zone)
- XP system with 8 named levels, streak counter
- Daily goal ring (5 tasks/day)
- Task modal with countdown timer
- Confetti + XP popup animations
- Profile-aware task generation (VARK, session length, switch cost, memory span)

### Settings (settings.html)
- Ollama auto-model selection (hidden from UI, fully automatic)
- 8-tier hardware detection: Apple Silicon / discrete GPU / CPU-only × RAM bands

---

## Copyright Statement

All source code, design decisions, UI/UX concepts, feature specifications, and creative direction documented in these conversation logs are the original intellectual property of **Mr_Pythoneer**, created in 2026.

The AI assistant (Claude by Anthropic) acted as a coding tool under the direction and creative control of Mr_Pythoneer. All final decisions about features, design, and implementation were made by the copyright holder.

**Copyright © 2026 Mr_Pythoneer. All rights reserved.**
