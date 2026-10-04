---
name: subagent-broker
description: >-
  Route workflows that require real independent subagents, especially Superpowers
  subagent-driven-development, independent implementer/reviewer/tester/researcher
  passes, or requests to spawn, wait for, resume, cancel, or inspect Codex child
  agents. Prefer native Codex multi-agent tools when the actual current tool list
  exposes them; otherwise use the WhiteChronos Subagent Broker MCP fallback. Never
  represent prompt personas or same-context roleplay as independent subagents.
---

# Subagent Broker

Use real agent evidence, not labels.

## Routing order

Inspect the **actual current tool list** first.

1. If native Codex multi-agent spawn/follow-up/wait tools are present, use the official native Codex multi-agent flow required by Superpowers.
2. Otherwise, if the **Subagent Broker** MCP tools are present and healthy, use them as the independent-agent fallback.
3. Otherwise use the official Superpowers **inline fallback** and state that independent subagents were unavailable.

Never run both native and broker dispatch for the same child task.
Never call a prompt persona, role-play turn, Arena strategy card, or same-context response a subagent.

Read `references/routing.md` for tool selection and `references/superpowers-sdd.md` when executing Superpowers SDD.

## Evidence before claims

Before saying a child ran, require broker/native **state evidence before claim**: a successful spawn record with agent ID and real independent lifecycle evidence. For broker children, use status/result evidence including PID and workspace/session data when available.

Never infer child execution from `multi_agent = true` alone.

## Repository isolation

For write work, require the child to use its own broker/native worktree/branch. Never allow a child to write directly to `main` or the parent task branch. Integrate child commits only after the parent workflow's review gate.

The independent Broker requires `SUBAGENT_BROKER_REPO_ROOT` to identify the consumer repository. Missing or invalid binding must fail closed; never infer the consumer repository from the plugin installation directory.

Read `references/security.md` before using write-capable children or cleanup/cancel operations.

## Superpowers contract

Preserve Superpowers orchestration artifacts and gates:

- task brief;
- report file;
- review package;
- progress ledger;
- fix-round semantics;
- final whole-branch review.

The broker is runtime infrastructure, not a replacement for Superpowers policy.

## Arena boundary

GitHub Arena is **review, not runtime**. Strategy cards, tournament sizes, or review lenses never count as independent agents. Apply Arena after the applicable implementation/review workflow for high-impact work.

## Broker lifecycle tools

When native tools are absent, use only the broker's approved lifecycle surface:

- `subagent_spawn`
- `subagent_status`
- `subagent_wait`
- `subagent_result`
- `subagent_followup`
- `subagent_list`
- `subagent_cancel`
- `subagent_cleanup`

Read `references/lifecycle.md` for state/continuation behavior.
