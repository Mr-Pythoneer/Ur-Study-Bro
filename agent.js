// agent.js — local tool-calling agent for Ur Study Bro
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// The old Ollama path only ever sent { model, messages } — no `tools` field —
// so the model could never actually *do* anything; it would just describe the
// action in prose (e.g. "[inserting manual check here]"). This module passes a
// real `tools` array through Ollama's native /api/chat function-calling API and
// executes the calls the model emits, then feeds results back until it answers.
//
// Works two ways:
//   • required by main.js  ->  const { runAgent } = require('./agent')
//   • run directly to test ->  node agent.js "open Calculator"
//
// No third-party deps: Node 18+/Electron give us global fetch + child_process.
//
// WHERE THIS RUNS — read before adding a tool
// This is a MAIN-process Node module (required lazily inside the 'ollama:agent'
// ipcMain handler in main.js). It is NOT renderer code: there is no window, no
// DOM, no contextBridge here. The renderer can only reach it through IPC —
//   window.api.runAgent({ message })  ->  ipcMain 'ollama:agent'  ->  runAgent()
// and live tool logs stream back via window.api.onAgentStep(evt).
//
// Consequently every tool below runs UNSANDBOXED, with the user's full
// privileges, on arguments the MODEL chose. Ollama is a local server with no
// auth, so "the model" is anything that can reach localhost:11434. Treat tool
// args as untrusted input: never interpolate them into a shell string, never
// pass them to `sh -c`. Use spawnSync with an argv array (no shell), or escape
// for AppleScript with asStr() as create_note does.
//
// RETURN CONTRACT: runAgent resolves to { reply, steps } or { error }. It does
// NOT honour the app-wide "never throws" rule on its own — an unreachable
// Ollama makes fetch() reject and that propagates out. main.js wraps the call
// in try/catch to restore the {reply}|{error} shape the renderer expects. Any
// NEW caller must wrap it too, or callers checking `.error` will see a rejection.
// ---------------------------------------------------------------------------

const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// Hard-coded to loopback on Ollama's default port: this feature is local-only
// by design and there is no setting to point it elsewhere.
const OLLAMA_URL = 'http://localhost:11434/api/chat'
// Swapping this is not free: the model must be one Ollama tags as supporting
// `tools`. gemma3:4b ignores the tools array entirely and narrates the action
// in prose instead — the exact bug this file was written to fix. main.js passes
// its own 'qwen2.5:7b' default, so change BOTH if you retune the default.
const DEFAULT_MODEL = 'qwen2.5:7b'   // proven to tool-call reliably; NOT gemma3:4b

// ── Tool implementations (the code that actually does the thing) ───────────
// Contract for every tool: take a single plain-object arg, NEVER throw, and
// return a JSON-serialisable object. Errors are returned as { error } rather
// than thrown because the value gets JSON.stringify'd straight back to the
// model as a tool result — an error string is useful context it can recover
// from (retry with a better arg), whereas a throw would abort the whole run.
// These are synchronous on purpose: spawnSync blocks the Electron main process
// (and so freezes the UI), which is why every spawn carries a short timeout.

function open_application({ name }) {
  if (!name) return { error: 'no app name given' }
  // `open -a` resolves via LaunchServices, so it finds apps anywhere on disk
  // (including /System/Applications) and tolerates near-miss names. Note this
  // makes it STRICTLY more capable than the list_installed_apps scan below —
  // a name that tool never reported can still open fine. argv array form, so
  // `name` is never shell-interpreted.
  const r = spawnSync('open', ['-a', name], { encoding: 'utf8', timeout: 8000 })
  if (r.status !== 0) return { error: (r.stderr || '').trim() || `could not open "${name}"` }
  return { ok: true, opened: name }
}

function list_installed_apps() {
  // Lets the model discover exact app names before calling open_application.
  // Since macOS Catalina, Apple's bundled apps (Calculator, Notes, Safari,
  // Mail…) live under /System/Applications, and utilities under the Utilities
  // subfolders — all of these must be scanned or the model will wrongly report
  // stock apps as not installed even though open_application launches them.
  const dirs = [
    '/Applications',
    '/Applications/Utilities',
    '/System/Applications',
    '/System/Applications/Utilities',
    path.join(os.homedir(), 'Applications'),
  ]
  // Set, not array: the same .app can sit in more than one dir and must appear once.
  const found = new Set()
  for (const dir of dirs) {
    // A given dir (e.g. ~/Applications) does not exist on most Macs — skip
    // rather than throw.
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.app')) found.add(f.replace(/\.app$/, ''))
    }
  }
  // Sorted so the prompt the model sees is stable between calls rather than in
  // readdir order.
  return { apps: [...found].sort((a, b) => a.localeCompare(b)) }
}

async function web_search({ query }) {
  if (!query) return { error: 'no query given' }
  try {
    // DuckDuckGo Instant Answer API — no key, returns JSON.
    // Manage expectations: this is NOT a web index. It only answers things with
    // an encyclopedia-style entry, and returns an empty body for most ordinary
    // queries (hence the explicit "no instant answer" result below). It is used
    // because it needs no API key and keeps the app dependency-free — swapping
    // in a real search backend means adding key storage, which currently lives
    // in localStorage under the deliberately global `ai_key_*` keys.
    const u = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`
    const res = await fetch(u, { signal: AbortSignal.timeout(12000) })
    const d = await res.json()
    const summary = d.AbstractText || d.Answer || ''
    const related = (d.RelatedTopics || [])
      // Nested category groups have no .Text — filter(Boolean) drops them.
      // Capped at 5 to keep the tool result from swamping the context window.
      .map(t => t.Text).filter(Boolean).slice(0, 5)
    // Plain-language miss, not an { error }: a miss is a fact the model should
    // relay to the user, whereas { error } invites it to retry the same tool.
    if (!summary && related.length === 0) return { results: `No instant answer for "${query}".` }
    return { summary, related, source: d.AbstractURL || 'duckduckgo.com' }
  } catch (e) {
    return { error: `search failed (network?): ${e.message}` }
  }
}

function create_note({ title, body }) {
  // Minimal Notes.app note. Body is escaped for the AppleScript string literal.
  // asStr is the security boundary for this tool: title/body are model-authored
  // and get spliced into a script that osascript executes. Escape order is
  // load-bearing — backslashes MUST be doubled before quotes are escaped, or
  // the backslash pass would re-escape the ones the quote pass just added.
  // Reuse asStr for ANY new value you interpolate into AppleScript here.
  const asStr = s => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `tell application "Notes"
    activate
    make new note with properties {name:"${asStr(title || 'Untitled')}", body:"${asStr(body)}"}
  end tell`
  // First run raises the macOS Automation consent prompt; if the user denies
  // it, osascript exits non-zero forever after and the model just sees the
  // error text. Re-grant under System Settings > Privacy & Security > Automation.
  const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 12000 })
  if (r.status !== 0) return { error: (r.stderr || '').trim() || 'osascript failed' }
  return { ok: true, created: title || 'Untitled' }
}

// ── Tool registry + JSON schemas the model sees ────────────────────────────
// Two halves that MUST stay in sync, because the loop dispatches on the name
// string the model emits: REGISTRY maps name -> implementation, TOOLS is the
// schema advertised to the model. A tool in TOOLS but not REGISTRY becomes an
// "unknown tool" error at runtime; one in REGISTRY but not TOOLS is dead code
// the model can never reach. Adding a tool = add it in BOTH places.

const REGISTRY = { open_application, list_installed_apps, web_search, create_note }

// The `description` fields are prompt engineering, not documentation — they are
// the only thing telling the model when to reach for each tool, so edit them
// with the same care as the system prompt.

const TOOLS = [
  { type: 'function', function: {
      name: 'open_application',
      description: 'Open an installed macOS application by its exact name.',
      parameters: { type: 'object',
        properties: { name: { type: 'string', description: "App name, e.g. 'Calculator', 'Google Chrome'" } },
        required: ['name'] } } },
  { type: 'function', function: {
      name: 'list_installed_apps',
      description: 'List installed apps. Call this first if unsure of an exact app name.',
      // Empty `properties` with no `required` is the correct spelling of a
      // zero-argument tool; omitting `parameters` entirely makes some models
      // skip the tool altogether.
      parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: {
      name: 'web_search',
      description: 'Search the web for a fact or current information.',
      parameters: { type: 'object',
        properties: { query: { type: 'string', description: 'The search query' } },
        required: ['query'] } } },
  { type: 'function', function: {
      name: 'create_note',
      description: "Create a note in the user's Apple Notes.",
      parameters: { type: 'object',
        properties: { title: { type: 'string' }, body: { type: 'string' } },
        required: ['title', 'body'] } } },
]

// ── The agent loop ─────────────────────────────────────────────────────────
// Sends tools via Ollama's native API, executes any tool_calls the model emits,
// feeds results back, and repeats until it returns a plain-text answer.
//
// The loop's exit condition is "the model replied without tool_calls". Every
// other outcome is a failure mode we must bound ourselves, hence maxSteps.
// `messages` is the whole state: it grows by one assistant message plus one
// message per tool result each pass, and is resent in full every request —
// there is no server-side session. Long tool results therefore cost context on
// every subsequent step, which is why the tools above truncate their output.

async function runAgent(userMessage, {
  model = DEFAULT_MODEL,
  system = 'You are Ur Study Bro, a helpful desktop study assistant. ' +
           'When the user asks you to DO something on their computer, use the ' +
           'provided tools instead of describing the action. Keep replies short.',
  // maxSteps is the hard stop for a model that keeps calling tools and never
  // settles on an answer; each step is one full round-trip to Ollama.
  maxSteps = 6,
  onStep = null,   // optional callback(evt) for UI logging
} = {}) {
  // onStep is fired synchronously mid-loop and its return value is ignored, so
  // it must not throw — main.js passes one that forwards each evt to the
  // renderer over 'ollama:agent-step' inside its own try/catch, because the
  // window may already be gone by the time a slow tool finishes.
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: userMessage },
  ]

  for (let step = 0; step < maxSteps; step++) {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // stream:false is required here — tool_calls only arrive complete in a
        // single response body. The UI's per-step feedback comes from onStep
        // instead (see main.js 'ollama:stream' for the token-streaming path).
        model, messages, tools: TOOLS, stream: false,
        options: { temperature: 0 },   // low temp keeps tool use disciplined
      }),
    })
    // Typically a 404 for a model that isn't pulled yet. Note a DOWN Ollama
    // doesn't land here at all — fetch rejects and escapes runAgent entirely.
    if (!res.ok) return { error: `ollama ${res.status}: ${await res.text()}` }
    const data = await res.json()
    const msg = data.message || {}
    // Push the raw assistant message (tool_calls and all) verbatim: the model
    // needs to see its own calls next pass to match them to the results below.
    messages.push(msg)

    const calls = msg.tool_calls || []
    if (calls.length === 0) {
      // No tool_calls == the model is done talking to itself. `steps` is 1-based
      // so a straight answer with no tool use reports 1, not 0.
      return { reply: (msg.content || '').trim(), steps: step + 1 }
    }

    // Sequentially, not Promise.all: these have real side effects (launching
    // apps, writing notes) and the model emitted them in an intended order.
    for (const c of calls) {
      const fn = c.function || {}
      const name = fn.name
      // Ollama normally pre-parses arguments into an object, but some models
      // hand back a raw JSON string — accept both rather than trusting one.
      const args = typeof fn.arguments === 'string'
        ? safeParse(fn.arguments) : (fn.arguments || {})
      onStep && onStep({ type: 'tool_call', name, args })

      let result
      // Hallucinated tool names are routine — report them back as a result so
      // the model can correct itself, rather than aborting the run.
      if (!REGISTRY[name]) result = { error: `unknown tool: ${name}` }
      // Net: a throwing tool can never kill the loop; it just becomes context.
      else { try { result = await REGISTRY[name](args) } catch (e) { result = { error: e.message } } }

      onStep && onStep({ type: 'tool_result', name, result })
      // No `name`/`tool_call_id` on the tool message: Ollama pairs results to
      // calls positionally, so this push MUST stay in the same order as `calls`.
      messages.push({ role: 'tool', content: JSON.stringify(result) })
    }
  }
  // Budget exhausted. Usually means the model is looping on one failing tool —
  // any side effects from the steps it did run have already happened.
  return { error: `stopped after ${maxSteps} steps without a final answer` }
}

// Degrades a malformed arguments blob to {} instead of throwing: the tool then
// returns its own 'no X given' error, which the model can see and retry from.
function safeParse(s) { try { return JSON.parse(s) } catch { return {} } }

// TOOLS/REGISTRY are exported for tests and introspection; main.js only needs
// runAgent. Note main.js hard-codes its own model default rather than importing
// DEFAULT_MODEL — see the note at the top before changing either.
module.exports = { runAgent, TOOLS, REGISTRY, DEFAULT_MODEL }

// ── CLI test harness: node agent.js "open Calculator" ──────────────────────
// Only runs when invoked directly, so `require('./agent')` from main.js stays
// side-effect free. This is the fastest way to iterate on tools or prompts —
// plain `node`, no Electron rebuild — but it needs Ollama already running.
// Heads-up: it exercises the REAL tools, so it will genuinely open apps and
// write notes on your machine.
if (require.main === module) {
  const task = process.argv.slice(2).join(' ') || 'Open the Calculator app.'
  console.log(`\n> ${task}\n`)
  runAgent(task, {
    onStep: e => {
      if (e.type === 'tool_call') console.log(`  ↳ calling ${e.name}(${JSON.stringify(e.args)})`)
      if (e.type === 'tool_result') console.log(`  ↳ result: ${JSON.stringify(e.result)}`)
    },
  }).then(out => {
    // No .catch(): if Ollama is down, fetch rejects and this prints an
    // unhandled rejection. That's the CLI's problem only — main.js catches.
    if (out.error) console.log(`\n✗ ${out.error}\n`)
    else console.log(`\n✓ (${out.steps} step${out.steps > 1 ? 's' : ''}) ${out.reply}\n`)
  })
}
