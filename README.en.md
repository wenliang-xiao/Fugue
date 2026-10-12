# Fugue 🎼

> **Many agents, one fugue.** — a full-duplex, multi-endpoint conversation hub that orchestrates your existing agent harnesses.

[中文](README.md) | English

[![CI](https://github.com/wenliang-xiao/Fugue/actions/workflows/ci.yml/badge.svg)](https://github.com/wenliang-xiao/Fugue/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Fugue turns the agent harnesses you already run — OpenCode, Pi, Claude Code, Hermes, and any ACP/A2A-compatible harness — into **one assistant** that you can talk to from anywhere, that keeps working while you chat, and that reports back when it's done.

- **Full-duplex voice** — talk like a phone call: interrupt, interject, redirect mid-sentence.
- **Multi-endpoint** — voice app (desktop orb / WebUI / phone) and Feishu text share the same agent's memory, tasks, and state.
- **Multi-harness delegation** — one frontend chats, multiple backend harnesses work in parallel, routed by task type or by your explicit choice.

## Why Fugue

Agent harnesses have exploded — OpenCode, Pi, Claude Code, Codex, DeepSeek Harness, Hermes… — but each is an isolated terminal or desktop window:

| Today | Problem |
|-------|---------|
| One entry per harness | N harnesses = N windows to juggle |
| Entry bound to a local machine | Cloud harnesses (like Hermes) have no unified entry |
| Chat blocks on work | One question, one answer — long tasks leave you waiting |
| No voice | Walking, driving, hands-busy are basically unsupported |

Fugue is an **orchestration layer** (not another harness). It splits "conversation" from "work": the frontend stays in the conversation with you while the backend delegates to your existing harnesses in parallel and speaks up when done.

## Orchestration, not bridging

Most "Feishu agent" projects are **synchronous bridges** (cc-connect, botmux, dsh-lark-*): they forward a harness's stdin/stdout to IM — send a command, wait, get a result.

Fugue is **asynchronous orchestration**:

| | Bridging (cc-connect / botmux) | Fugue (orchestration) |
|---|---|---|
| Interaction | Send → execute → return (sync console) | Delegate → keep chatting → parallel work → proactive report |
| Experience | Remotely driving a terminal | Talking to an assistant |
| Multi-task | Serial | Parallel, query/cancel/redirect anytime |
| Full-duplex voice | ❌ | ✅ core feature |
| Multi-harness | Weak (CLI forwarding) | ✅ pluggable, routed / explicit |
| Cloud harness (Hermes) | ❌ | ✅ first-class (SSH-tunneled ACP) |

## Architecture

```
              ┌────────────────────────────┐
  Feishu ───▶ │  Feishu client (text_only) │──┐
  (text)      └────────────────────────────┘  │
              ┌────────────────────────────┐  │   one Gateway
  Voice app ─▶│  WebUI / orb / phone       │──┤   (tasks / memory / permissions
  (full-duplex)└────────────────────────────┘  │   / proactive reports)
              ┌────────────────────────────┐  │
              │        Gateway             │◀─┘
              │  frontend agent + orchestration
              └────────────┬───────────────┘
          ┌──────────┬─────┴─────┬──────────┐
       OpenCode      Pi        Hermes(remote)
       (local)     (local)    (aliyun/tencent)
```

Built on [qwen-audio-agent](https://github.com/QwenAudio/qwen-audio-agent) (Apache-2.0) — we **don't fork its core**, we extend it through two public boundaries: `BackendPort` (multi-harness aggregation) and the Gateway Client Protocol (Feishu client).

## Quick start

```bash
# 1. deps (also install qwen-audio-agent's source deps)
cd /path/to/qwen-audio-agent && npm install --omit=dev
cd /path/to/fugue && npm install

# 2. configure harnesses + Feishu
cp config/config.example.env config/config.env
# edit config/config.env: enable opencode/pi/hermes + Hermes SSH host + Feishu app credentials

# 3. voice frontend credentials (reuse qwen-audio-agent's config.env)
#    ~/.config/qwaudio/config.env — set DASHSCOPE_API_KEY etc.

# 4. run
QWEN_AUDIO_AGENT_ROOT=/path/to/qwen-audio-agent npm start
```

## Test

```bash
npm test       # 33 tests (routing / multi-backend / message-bridge / feishu-client)
npm run poc    # upstream BackendPort conformance suite
```

## Spec-driven development

This repo follows a strict **SDD (spec-driven development)** workflow — spec first, then code, review, and test, all traceable to the spec:

- `docs/01-prd/` — product requirements (12 REQs)
- `docs/02-tech/` — architecture + ADRs + module designs
- `docs/03-review/` — review guide (spec conformance)
- `docs/04-test/` — test plan + cases
- `docs/vibe-coding.md` — AI-collaborative development discipline
- `docs/trace/` — dev-log / debug-log / handoff / ratify-log

See [AGENTS.md](AGENTS.md) for the full workflow.

## License

[MIT](LICENSE)
