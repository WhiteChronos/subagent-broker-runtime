# Superpowers SDD mapping

When native Codex subagent tools are absent:

- implementer dispatch -> `subagent_spawn(role="implementer", workspace_mode="worktree_write")`
- reviewer dispatch -> `subagent_spawn(role="reviewer", workspace_mode="read_only")`
- wait -> `subagent_wait`
- fix round -> `subagent_followup` only when resumable session evidence exists
- final reviewer -> independent reviewer/security-reviewer as required

Keep the same task brief, report file, review package, progress ledger, and five-round fix-loop semantics from Superpowers. The controller decides orchestration; the broker only executes real child lifecycle operations.
