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

Turn the agent harnesses you already run — local **OpenCode / Pi**, cloud **Hermes**, and any ACP/A2A-compatible harness — into **one assistant** that you can talk to from anywhere, that keeps working while you chat, that reports back when it's done, and that **never loses a task to a crash**.

## 🏗️ Architecture

<img src="assets/diagrams/fugue-architecture.png" alt="Fugue architecture" width="720">

Three layers: **qwen-audio-agent** (frontend orchestration + multi-endpoint + full-duplex, reused as-is) → **Fugue durable layer** (task log + fold + crash recovery, built in-house) → **harness layer** (unreliable subprocesses, restarted and resumed from the log after a crash).

## ✨ Features

- 🎙️ **Full-duplex voice** — talk like a phone call: interrupt, interject, redirect mid-sentence.
- 📱 **Multi-endpoint** — voice app (desktop orb / WebUI / phone) and Feishu text share the same agent's memory, tasks, and state.
- 🧩 **Multi-harness delegation** — one frontend chats, multiple backend harnesses work in parallel, routed by domain or by your explicit choice ("let pi do it").
- 💪 **Crash-resilient (durable)** — task state is written to an event log; after a Gateway or harness crash the task resumes from the log. **Completed calls never re-run, side-effecting calls never run twice** (aligned with Vercel's durable-harness design — see [analysis](docs/00-research/durable-harness-analysis.md)).
- 🔌 **Zero-invasion integration** — reuse your existing harnesses, no forking the base (qwen-audio-agent); only two standard extension points.

## Why orchestration, not bridging

Most "Feishu agents" are **synchronous bridges** (cc-connect, botmux, dsh-lark-*): they pipe a harness's stdin/stdout to IM — send a command, wait for output.

Fugue is **async orchestration**:

| | Bridge (cc-connect / botmux) | Fugue (orchestration) |
|---|---|---|
| Interaction | command → run → output (sync console) | delegate → keep chatting → background work → proactive report |
| Experience | remote-controlling a terminal | talking to an assistant |
| Multi-task | mostly serial | parallel backends, ask progress / cancel / add input anytime |
| Full-duplex voice | ❌ | ✅ core selling point |
| Crash recovery | ❌ process dies, state lost | ✅ resumes from event log |
| Multi-harness | weak (CLI forwarding) | ✅ pluggable, routed / explicit |
| Cloud harness (Hermes) | ❌ | ✅ first-class (SSH tunnel ACP) |

## 💪 Durability: mechanisms borrowed from durable-harness

Tasks are never lost or duplicated, thanks to this design (deep dive in [durable-harness analysis](docs/00-research/durable-harness-analysis.md)):

<table>
<tr>
<td width="50%"><img src="assets/diagrams/durable-harness-crash-recovery.png" alt="crash recovery sequence" width="460"></td>
<td width="50%"><img src="assets/diagrams/durable-harness-effect-sandwich.png" alt="effect sandwich state machine" width="460"></td>
</tr>
</table>

- **intent/outcome log** — every delegation step writes an intent first, then an outcome. After a crash the log answers exactly: what finished, what was running, what never started.
- **effect sandwich + replay** — `completed` replays the result (no double billing), `failed` rethrows, `running` re-runs or not by its `safe/never` policy — a `never` call (e.g. duplicate submit) never runs twice.
- **anchor + queue backstop** — liveness belongs to the queue, no heartbeats in app code; process dies → queue redelivers → a new process resumes from the log.
- **epoch fencing** — when multiple endpoints (voice + Feishu) time-share a session, stale writes from a zombie process are fenced out.

## 🚀 Quick start

```bash
# 1. dependencies (qwen-audio-agent source needs npm install first)
cd /path/to/qwen-audio-agent && npm install --omit=dev
cd /path/to/fugue && npm install

# 2. configure harnesses + Feishu
cp config/config.example.env config/config.env
# frontend voice credentials reuse qwen-audio-agent's config.env (DASHSCOPE_API_KEY / DOUBAO_API_KEY)

# 3. start (WebUI at http://127.0.0.1:3101)
QWEN_AUDIO_AGENT_ROOT=/path/to/qwen-audio-agent npm start
```

Tests & checks:

```bash
npm test          # vitest: 94 tests (durable kernel + routing + multi-backend + feishu + e2e crash recovery)
npm run typecheck # tsc --noEmit (TypeScript strict)
npm run inspect   # task observatory: local flows / marks / effect states
npm run poc       # upstream BackendPort conformance suite
```

### 📡 Live observation (debug)

A **live mark watcher** starts with the app — mark/step/run events stream to your terminal as tasks run:

```
[fugue] live mark watcher enabled
07:57:57.504  [step] step_started ... (submit) replay=never
07:57:57.505  [mark] intent (submit)          ← marks streamed live
07:57:57.506  [step] step_completed ...
07:57:57.508  [mark] complete (submit)
```

Review the full flow anytime in another terminal: `npm run inspect`.

## 🗺️ Roadmap: toward an agent matrix

```
P0 ✅ durable foundation (TS migration + TaskWorld/fold/effect/anchor/fencing + e2e crash recovery)
P1 ⏳ pi/opencode on durable storage ("the agent never dies")
P2 📋 documents shared memory + parallel fan-out (matrix prototype)
P3 📋 expert-to-expert delegation / scheduler / cost ledger (true matrix)
```

## 📚 Docs

- [Architecture](docs/02-tech/architecture.md) · [Durable design](docs/02-tech/durable-design.md) · [ADRs](docs/02-tech/adr/) · [Module design](docs/02-tech/modules/)
- [durable-harness deep analysis](docs/00-research/durable-harness-analysis.md) · [Competitor analysis](docs/00-research/competitor-analysis.md)
- [PRD](docs/01-prd/PRD.md) · [Glossary](docs/glossary.md) · [Review guide](docs/03-review/review-guide.md) · [Test plan](docs/04-test/test-plan.md)
- [SDD workflow](AGENTS.md) · [AI collaboration](docs/vibe-coding.md) · [Constitution](CONSTITUTION.md)

## License

[MIT](LICENSE)
