# Security

The broker never exposes arbitrary shell commands, CLI argument injection, arbitrary environment injection, or caller-selected unrestricted models through MCP.

The independent runtime requires an explicit absolute `SUBAGENT_BROKER_REPO_ROOT` that resolves to a Git repository. It never silently uses the plugin installation directory as the consumer repository.

Write agents use isolated worktrees and never write directly to `main`. Read-only agents receive isolated detached snapshots. Cancellation targets only the selected agent process group after Linux PID identity verification. Cleanup refuses dirty worktrees and incomplete result metadata.

Raw `events.jsonl` traces are sensitive local artifacts: do not return or commit them wholesale. Never broaden filesystem/network permissions merely to make a child succeed.
