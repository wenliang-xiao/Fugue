# Fugue 🎼

> **Many agents, one fugue.** — a full-duplex, multi-endpoint, **crash-resilient** orchestration hub for your agent harnesses.

[中文](README.md) | English

[![GitHub stars](https://img.shields.io/github/stars/wenliang-xiao/Fugue?style=social)](https://github.com/wenliang-xiao/Fugue/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/wenliang-xiao/Fugue?style=social)](https://github.com/wenliang-xiao/Fugue/network/members)
[![GitHub issues](https://img.shields.io/github/issues/wenliang-xiao/Fugue)](https://github.com/wenliang-xiao/Fugue/issues)
[![CI](https://github.com/wenliang-xiao/Fugue/actions/workflows/ci.yml/badge.svg)](https://github.com/wenliang-xiao/Fugue/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/wenliang-xiao/Fugue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

## What it is

Turn the agent harnesses you already run — local **OpenCode / Pi**, cloud **Hermes**, any ACP/A2A-compatible harness — into **one assistant** you can talk to from anywhere, that keeps working while you chat, reports back when done, and **never loses a task to a crash**.

- 🎙️ **Full-duplex voice** — talk like a phone call: interrupt, interject, redirect mid-sentence.
- 📱 **Multi-endpoint** — voice app (orb / WebUI / phone) and Feishu text share the same memory, tasks, and state.
- 🧩 **Multi-harness delegation** — one frontend chats, multiple backend harnesses work in parallel, routed by domain or your explicit choice ("hand to pi").
- 💪 **Crash-resilient** — task state is written to an event log and resumes after a crash; **completed calls never re-run, side-effecting calls never run twice**.
- 🔌 **Zero-invasion** — reuse your harnesses, no forking the base (qwen-audio-agent); only its standard extension points.

## Deployment forms

Fugue has two deployment forms sharing one orchestration core (multi-harness delegation + durable kernel + session memory):

| | A · Local assistant | C · Cloud-resident |
|---|---|---|
| Core value | full-duplex multi-agent + session memory + harness division of labor | 24×7 resident, always responsive |
| Deployment | local Mac, launchd daemon (resident + autostart + crash self-heal) | cloud (reuse the Hermes host) |
| Availability | available while awake; sleeps on lid-close, resumes on wake | unaffected by local machine state |
| Status | ✅ available | 📋 planned |

They are not substitutes: **A's unique value is "work with multiple harnesses at your desk + one coherent session memory"; C's value is "available anywhere, anytime"**. See [ADR-0011](docs/02-tech/adr/0011-dual-deployment.md).

## Quick start

**Prerequisite**: Node ≥ 22.

```bash
# 1. install
cd /path/to/fugue && npm install

# 2. configure Feishu (optional, skip if unused)
cp config/config.example.env config/config.env

# 3. start
npm start
# → WebUI at http://127.0.0.1:3101
# → frontend voice credentials reuse qwen-audio-agent's config (DASHSCOPE_API_KEY / DOUBAO_API_KEY)

# resident daemon (optional, recommended): autostart + crash self-heal, no terminal
npm run daemon:install   # install launchd daemon
npm run daemon:status    # check status
npm run daemon:stop      # stop
npm run daemon:uninstall # uninstall
```

```bash
npm test           # vitest: 94 tests (durable kernel + routing + multi-backend + e2e crash recovery)
npm run typecheck  # tsc --noEmit (TypeScript strict)
npm run inspect    # task observatory: local flows / marks / effect states
```

## Usage

### Configure your harnesses

Edit `config/harnesses.json` to declare the harnesses and the domains they're good at:

```json
{
  "harnesses": [
    { "id": "pi", "label": "Pi · main worker", "protocol": "pi", "domains": ["work", "weekly report", "docs"], "default": true },
    { "id": "opencode", "label": "OpenCode · code", "protocol": "opencode", "domains": ["code", "refactor"] },
    { "id": "hermes", "label": "Hermes · finance", "protocol": "acp", "command": "ssh", "args": ["<host>", "hermes", "acp", "--accept-hooks"], "domains": ["finance", "investment"] },
    { "id": "dsh", "label": "DeepSeek · research", "type": "headless", "command": "dsh", "args": ["--profile", "headless"], "domains": ["research"] }
  ]
}
```

Three integration modes: `protocol` (built-in pi/opencode), `command+args` (any ACP harness, e.g. Hermes over an SSH tunnel), `type: "headless"` (one-shot process, e.g. dsh).

### Delegate by conversation

```
You (voice/Feishu): "write me a weekly report"
  → frontend decides → routed to pi by domain → runs in background → proactively reports "done"

You (voice/Feishu): "hand to opencode: refactor this module"
  → explicit expert choice → routed to opencode
```

Keep chatting after delegating — the backend works in parallel and reports back when done. Ask progress, cancel, or add input anytime.

### Live observation (debug)

A **live mark watcher** starts with the app — task events stream to your terminal in real time:

```
[fugue] live mark watcher enabled
08:07:59.948  [step] step_started (submit) replay=never
08:07:59.950  [mark] intent (submit) key=task:live-1:submit:pi
08:07:59.951  [step] step_completed
08:07:59.952  [run] run_handoff live-1
```

Review the full flow anytime in another terminal: `npm run inspect`.

## Architecture

<img src="assets/diagrams/fugue-architecture.png" alt="Fugue architecture" width="720">

Three layers: **qwen-audio-agent** (frontend orchestration + multi-endpoint + full-duplex, reused as-is) → **Fugue durable layer** (task log + fold + crash recovery, built in-house) → **harness layer** (unreliable subprocesses, restarted and resumed from the log).

## Crash resilience (durable)

Tasks are never lost or duplicated — mechanisms borrowed from Vercel's [durable-harness](docs/00-research/durable-harness-analysis.md):

<table>
<tr>
<td width="50%"><img src="assets/diagrams/durable-harness-crash-recovery.png" alt="crash recovery sequence" width="460"></td>
<td width="50%"><img src="assets/diagrams/durable-harness-effect-sandwich.png" alt="effect sandwich state machine" width="460"></td>
</tr>
</table>

- **intent/outcome log** — every step writes an intent first, then an outcome; after a crash the log answers exactly what finished, what was running, what never started.
- **effect sandwich + replay** — `completed` replays the result (no double billing), `failed` rethrows, `running` re-runs or not by its `safe/never` policy; a `never` call (e.g. duplicate submit) never runs twice.
- **anchor + queue backstop** — liveness belongs to the queue, no heartbeats in app code; process dies → redelivered → a new process resumes from the log.
- **epoch fencing** — when endpoints (voice + Feishu) time-share a session, stale writes from a zombie process are fenced out.

## Why orchestration, not bridging

Most "Feishu agents" are **synchronous bridges** (cc-connect, botmux): pipe a harness's stdin/stdout to IM — send a command, wait for output.

| | Bridge | Fugue (orchestration) |
|---|---|---|
| Interaction | command → run → output (sync console) | delegate → keep chatting → background work → proactive report |
| Experience | remote-controlling a terminal | talking to an assistant |
| Multi-task | mostly serial | parallel backends, ask progress / cancel anytime |
| Full-duplex voice | ❌ | ✅ |
| Crash recovery | ❌ process dies, state lost | ✅ resumes from event log |
| Multi-harness | weak (CLI forwarding) | ✅ pluggable, routed / explicit |
| Cloud harness | ❌ | ✅ first-class (SSH tunnel ACP) |

## Roadmap

### P0 · Core experience polish (in progress)

- [x] durable kernel (TaskWorld/fold/effect/anchor/fencing + crash recovery)
- [x] broadcast conclusion only, not full text (6000→500 chars)
- [x] workspace points to the project
- [x] never interrupt the user (turn-taking rules)
- [ ] interruption takes effect instantly (to verify)
- [ ] short progress updates (broadcast cadence)
- [ ] clear task-completion confirmation
- [ ] no broadcast for internal tool paths

### P1 · durable hardening

- [ ] real crash-recovery verification (kill -9 → restart → resume)
- [ ] pi/opencode session persistence

### P2 · multi-agent capability

- [ ] documents shared memory
- [ ] parallel fan-out

### P3 · matrix vision

- [ ] expert-to-expert delegation / scheduler / cost ledger

## Documentation

- [Architecture](docs/02-tech/architecture.md) · [Durable design](docs/02-tech/durable-design.md) · [ADRs](docs/02-tech/adr/) · [Module design](docs/02-tech/modules/)
- [durable-harness deep analysis](docs/00-research/durable-harness-analysis.md) · [Competitor analysis](docs/00-research/competitor-analysis.md)
- [PRD](docs/01-prd/PRD.md) · [Glossary](docs/glossary.md) · [Test plan](docs/04-test/test-plan.md)

## Contributing

Follows the [SDD workflow](AGENTS.md) (Spec-Driven Development): the spec is the single source of truth — write specs before code. Read the [Constitution](CONSTITUTION.md) and [AI collaboration guide](docs/vibe-coding.md) before contributing.

## License

[MIT](LICENSE)
