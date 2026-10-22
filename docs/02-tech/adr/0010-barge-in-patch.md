# ADR-0010 doubao-seeduplex 打断事件映射补丁（patch-package）

- 状态：已采纳（用户实测通过 2026-10-22）
- 日期：2026-10-22

## 背景

Fugue 前台用豆包 Seeduplex 全双工模型，但「用户开口打断播报」始终不生效：用户说话，模型继续播报不停。

真实日志定位：豆包 Seeduplex 用 `conversation.item.input_audio_transcription.started` 表示「用户开始说话」，而 qwen-audio-agent 的打断链路（`realtime-input-runtime.mjs` 的 `#startSpeech`）监听的是 OpenAI Realtime 标准的 `input_audio_buffer.speech_started`。doubao-seeduplex 协议层（`doubao-seeduplex-protocol.mjs` 的 `normalizeIncoming`）没有做这个事件映射，导致 qwen 永远收不到打断信号（`speech_started` 日志 0 次）。

## 决策

**用 patch-package 对 qwen-audio-agent 打本地补丁（不 fork 上游仓库）**：在 `doubao-seeduplex-protocol.mjs` 的 `normalizeIncoming` 里，把 `conversation.item.input_audio_transcription.started` 映射成 `input_audio_buffer.speech_started`。

补丁文件：`patches/qwen-audio-agent+2.0.1.patch`，`package.json` 加 `"postinstall": "patch-package"` 自动应用。

## 理由

- **不 fork**：符合宪法「复用底座不 fork core」；补丁只改一个事件映射，风险极小。
- **可复现**：`npm install` 后自动应用，不依赖手工改 node_modules。
- **可随依赖升级**：qwen 升级后若补丁失效，patch-package 会报错提示，人工确认是否需要重打。
- **替代方案（不采用）**：给上游提 issue 等修复——周期不可控；Fugue 自己 fork provider——违背定位。

## 后果

- **收益**：打断（barge-in）生效，用户开口即打断播报。
- **代价**：依赖补丁维护；qwen-audio-agent 升级时需确认补丁是否仍需要（若上游已修，则删除补丁）。
- **待办**：整理 issue 草稿提交给 QwenAudio/qwen-audio-agent，说明 doubao-seeduplex 协议层缺该事件映射，建议上游原生修复后撤销本补丁。
