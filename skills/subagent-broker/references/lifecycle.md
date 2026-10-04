# Lifecycle

Broker states: `QUEUED`, `SPAWNING`, `RUNNING`, `COMPLETED`, `FAILED`, `TIMED_OUT`, `CANCEL_REQUESTED`, `CANCELLED`, `ORPHANED`.

`subagent_result` is final-result only and returns `NOT_READY` for nonterminal agents.

`subagent_followup` is valid only for a completed broker agent with a recorded resumable Codex session and confirmed CLI resume capability. It must preserve the same agent identity and worktree/session. If resume is unavailable, report `CAPABILITY_UNAVAILABLE`; never spawn a fresh session and call it continuation.

Use bounded `subagent_wait` rather than short polling loops.
