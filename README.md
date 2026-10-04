# WhiteChronos Subagent Broker Runtime

Independent canonical runtime for the WhiteChronos Subagent Broker.

## Scope

- Native-first fallback: use verified native Codex multi-agent first, then this Broker, then the Superpowers inline fallback.
- Initial supported runtime: trusted Linux Codex remote/network workspaces.
- Transport: local stdio only.
- Consumer repository binding is explicit: `SUBAGENT_BROKER_REPO_ROOT` is required and must resolve to a Git repository.
- The runtime does not create API keys, enable hosted-agent billing, or silently provision infrastructure.
- CI uses fake Codex fixtures and never counts as live subagent/runtime proof.

Source extraction baseline: `WhiteChronos/ChatGPT@ef3b5fd77ab96dc3c0950725cd6f5c57b49a8988`, path `plugins/subagent-broker`, version `1.0.0`.
