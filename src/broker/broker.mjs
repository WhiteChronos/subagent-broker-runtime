import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateSpawnArgs, TERMINAL_STATES, brokerError } from './protocol.mjs';
import * as defaultWorktrees from '../git-isolation/worktree-manager.mjs';

function now() { return new Date().toISOString(); }
function newAgentId() { return `sa_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`; }

function workspaceFromRecord(record) {
  if (!record?.worktree) return null;
  return {
    repo_root: record.repo_root,
    path: record.worktree,
    mode: record.workspace_mode,
    base_sha: record.base_sha,
    branch: record.branch ?? null,
  };
}

function publicRecord(record) {
  if (!record) return null;
  return {
    agent_id: record.agent_id,
    role: record.role,
    backend: 'codex_cli',
    state: record.state,
    workspace_mode: record.workspace_mode,
    priority: record.priority ?? 'normal',
    created_at: record.created_at ?? null,
    started_at: record.started_at ?? null,
    ended_at: record.ended_at ?? null,
    pid: record.pid ?? null,
    base_ref: record.base_ref ?? null,
    base_sha: record.base_sha ?? null,
    branch: record.branch ?? null,
    worktree: record.worktree ?? null,
    session_id: record.session_id ?? null,
    exit_code: record.exit_code ?? null,
    terminal_reason: record.terminal_reason ?? null,
  };
}

export class SubagentBroker {
  constructor({
    repoRoot,
    stateStore,
    backend,
    workspaceManager = defaultWorktrees,
    roleLoader = null,
    maxRunning = 3,
    maxQueued = 32,
    defaultTimeoutSeconds = 1800,
    cancelGraceSeconds = 10,
    rehydratedCheckMs = 1000,
    idFactory = newAgentId,
  } = {}) {
    if (!repoRoot || !stateStore || !backend) throw new Error('repoRoot, stateStore, and backend are required');
    if (!Number.isInteger(maxRunning) || maxRunning < 1 || maxRunning > 8) throw new Error('maxRunning must be between 1 and 8');
    if (!Number.isInteger(maxQueued) || maxQueued < 0 || maxQueued > 32) throw new Error('maxQueued must be between 0 and 32');
    this.repoRoot = path.resolve(repoRoot);
    this.stateStore = stateStore;
    this.backend = backend;
    this.workspaceManager = workspaceManager;
    this.roleLoader = roleLoader ?? (async role => {
      const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'roles', `${role}.md`);
      return fs.readFile(file, 'utf8');
    });
    this.maxRunning = maxRunning;
    this.maxQueued = maxQueued;
    this.defaultTimeoutSeconds = defaultTimeoutSeconds;
    this.cancelGraceSeconds = cancelGraceSeconds;
    this.rehydratedCheckMs = Math.max(10, Number(rehydratedCheckMs) || 1000);
    this.idFactory = idFactory;
    this.highQueue = [];
    this.normalQueue = [];
    this.active = new Set();
    this.rehydratedRunning = new Set();
    this.handles = new Map();
    this.timers = new Map();
    this.waiters = new Map();
    this.timeoutPending = new Set();
    this.rehydratedTimer = null;
    this.lock = Promise.resolve();
    this.shuttingDown = false;
  }

  async #withLock(fn) {
    const previous = this.lock;
    let release;
    this.lock = new Promise(r => release = r);
    await previous;
    try { return await fn(); }
    finally { release(); }
  }

  #runningCount() { return this.active.size + this.rehydratedRunning.size; }
  #queuedCount() { return this.highQueue.length + this.normalQueue.length; }

  async start() {
    const records = await this.stateStore.reconcileNonterminal();
    await this.#withLock(async () => {
      for (const record of records) {
        if (record.state === 'QUEUED') this.#enqueue(record.agent_id, record.priority ?? 'normal');
        else if (record.state === 'RUNNING' || record.state === 'SPAWNING' || record.state === 'CANCEL_REQUESTED') {
          this.rehydratedRunning.add(record.agent_id);
        }
      }
      await this.#drainUnlocked();
    });
    this.#scheduleRehydratedCheck();
  }

  #scheduleRehydratedCheck() {
    if (this.shuttingDown || this.rehydratedTimer || this.rehydratedRunning.size === 0) return;
    this.rehydratedTimer = setTimeout(() => {
      this.rehydratedTimer = null;
      this.#withLock(async () => {
        const records = await this.stateStore.reconcileNonterminal();
        for (const record of records) {
          if (!this.rehydratedRunning.has(record.agent_id)) continue;
          if (TERMINAL_STATES.has(record.state)) {
            this.rehydratedRunning.delete(record.agent_id);
            this.#notify(record.agent_id, publicRecord(record));
          }
        }
        await this.#drainUnlocked();
      }).finally(() => this.#scheduleRehydratedCheck()).catch(() => {});
    }, this.rehydratedCheckMs);
    this.rehydratedTimer.unref?.();
  }

  async spawn(args) {
    const spec = validateSpawnArgs({ ...args, timeout_seconds: args?.timeout_seconds ?? this.defaultTimeoutSeconds });
    return this.#withLock(async () => {
      if (this.#runningCount() >= this.maxRunning && this.#queuedCount() >= this.maxQueued) {
        throw brokerError('RESOURCE_EXHAUSTED', `subagent queue limit ${this.maxQueued} reached`);
      }
      const agentId = this.idFactory();
      const baseSha = await this.workspaceManager.resolveBase(this.repoRoot, spec.base_ref ?? 'HEAD');
      const roleText = await this.roleLoader(spec.role);
      const prompt = `${String(roleText).trim()}\n\nTask:\n${spec.task}`;
      const record = {
        agent_id: agentId,
        role: spec.role,
        workspace_mode: spec.workspace_mode,
        state: 'QUEUED',
        priority: spec.priority,
        timeout_seconds: spec.timeout_seconds,
        base_ref: spec.base_ref,
        base_sha: baseSha,
        repo_root: this.repoRoot,
        created_at: now(),
        transition_history: [],
        pid: null,
        process_identity: null,
        session_id: null,
        branch: null,
        worktree: null,
        exit_code: null,
      };
      await this.stateStore.create(record);
      await this.stateStore.writePrompt(agentId, prompt);
      this.#enqueue(agentId, spec.priority);
      await this.#drainUnlocked();
      return publicRecord(await this.stateStore.get(agentId));
    });
  }

  #enqueue(agentId, priority) {
    const queue = priority === 'high' ? this.highQueue : this.normalQueue;
    if (!queue.includes(agentId)) queue.push(agentId);
  }

  #dequeue(agentId) {
    for (const q of [this.highQueue, this.normalQueue]) {
      const i = q.indexOf(agentId);
      if (i >= 0) q.splice(i, 1);
    }
  }

  #nextQueued() { return this.highQueue.shift() ?? this.normalQueue.shift() ?? null; }

  async #drainUnlocked() {
    if (this.shuttingDown) return;
    while (this.#runningCount() < this.maxRunning && this.#queuedCount() > 0) {
      const id = this.#nextQueued();
      if (!id) break;
      await this.#startAgentUnlocked(id);
    }
  }

  async #startAgentUnlocked(agentId) {
    let record = await this.stateStore.get(agentId);
    if (!record || record.state !== 'QUEUED') return;
    record = await this.stateStore.update(agentId, { spawn_started_at: now() }, 'SPAWNING');
    let workspace = null;
    try {
      workspace = await this.workspaceManager.createWorkspace({
        repoRoot: this.repoRoot,
        agentId,
        baseSha: record.base_sha,
        mode: record.workspace_mode,
      });
      record = await this.stateStore.update(agentId, {
        branch: workspace.branch ?? null,
        worktree: workspace.path,
        repo_root: workspace.repo_root ?? this.repoRoot,
      });
      const prompt = await this.stateStore.readPrompt(agentId);
      const handle = await this.backend.spawn({ agent_id: agentId, prompt, cwd: workspace.path, workspace_mode: record.workspace_mode });
      this.handles.set(agentId, handle);
      this.active.add(agentId);
      record = await this.stateStore.update(agentId, {
        pid: handle.pid,
        process_identity: handle.process_identity ?? null,
        started_at: now(),
        session_id: handle.session_id ?? null,
      }, 'RUNNING');
      this.#scheduleTimeout(record);
      this.#notify(agentId, publicRecord(record));
      handle.completion.then(
        result => this.#withLock(() => this.#finalizeUnlocked(agentId, result)),
        error => this.#withLock(() => this.#finalizeUnlocked(agentId, { exit_code: 1, signal: null, session_id: handle.session_id, final_text: '', stderr_tail: String(error?.message ?? error) }))
      ).catch(() => {});
    } catch (error) {
      const current = await this.stateStore.get(agentId);
      if (current && !TERMINAL_STATES.has(current.state)) {
        const failed = await this.stateStore.update(agentId, { ended_at: now(), terminal_reason: String(error?.message ?? error), exit_code: 1 }, 'FAILED');
        await this.stateStore.writeResult(agentId, this.#resultPayload(failed, null, { stderr_tail: failed.terminal_reason }), '');
        this.#notify(agentId, publicRecord(failed));
      }
      if (workspace) {
        try { await this.workspaceManager.cleanupWorkspace(workspace, { purgeBranch: Boolean(workspace.branch) }); } catch {}
      }
      await this.#drainUnlocked();
    }
  }

  #scheduleTimeout(record) {
    this.#clearTimeout(record.agent_id);
    const ms = Number(record.timeout_seconds ?? this.defaultTimeoutSeconds) * 1000;
    const timer = setTimeout(() => { this.#onExecutionTimeout(record.agent_id).catch(() => {}); }, ms);
    timer.unref?.();
    this.timers.set(record.agent_id, timer);
  }

  #clearTimeout(agentId) {
    const t = this.timers.get(agentId);
    if (t) clearTimeout(t);
    this.timers.delete(agentId);
  }

  async #onExecutionTimeout(agentId) {
    let handle = null;
    await this.#withLock(async () => {
      const current = await this.stateStore.get(agentId);
      if (!current || current.state !== 'RUNNING') return;
      this.timeoutPending.add(agentId);
      handle = this.handles.get(agentId) ?? (current.pid ? {
        agent_id: agentId,
        pid: current.pid,
        process_identity: current.process_identity ?? null,
        cwd: current.worktree ?? null,
        workspace_mode: current.workspace_mode,
        session_id: current.session_id ?? null,
        rehydrated: true,
      } : null);
    });

    let containmentError = null;
    if (handle) {
      try {
        await this.backend.cancel(handle, { graceSeconds: this.cancelGraceSeconds });
      } catch (error) {
        containmentError = error;
      }
    } else {
      containmentError = brokerError('CAPABILITY_UNAVAILABLE', `agent ${agentId} has no attributable process handle at timeout`);
    }

    await this.#withLock(async () => {
      this.timeoutPending.delete(agentId);
      let current = await this.stateStore.get(agentId);
      if (!current) return;

      // A normal completion may have won the race while containment was in progress.
      if (TERMINAL_STATES.has(current.state)) {
        this.active.delete(agentId);
        this.rehydratedRunning.delete(agentId);
        this.#clearTimeout(agentId);
        await this.#drainUnlocked();
        return;
      }

      if (current.state !== 'RUNNING') return;

      const nextState = containmentError ? 'ORPHANED' : 'TIMED_OUT';
      const reason = containmentError
        ? `timeout containment failed: ${String(containmentError?.message ?? containmentError)}`
        : 'execution timeout';
      current = await this.stateStore.update(agentId, {
        ended_at: now(),
        terminal_reason: reason,
      }, nextState);
      await this.stateStore.writeResult(
        agentId,
        this.#resultPayload(current, workspaceFromRecord(current), {
          stderr_tail: handle?.stderr_tail ?? reason,
        }),
        ''
      );
      this.active.delete(agentId);
      this.rehydratedRunning.delete(agentId);
      this.#clearTimeout(agentId);
      this.#notify(agentId, publicRecord(current));
      await this.#drainUnlocked();
    });
  }

  async #finalizeUnlocked(agentId, backendResult) {
    if (this.timeoutPending.has(agentId)) return;
    this.#clearTimeout(agentId);
    const current = await this.stateStore.get(agentId);
    if (!current) return;
    if (current.state === 'CANCEL_REQUESTED' || current.state === 'TIMED_OUT' || current.state === 'CANCELLED') return;
    if (TERMINAL_STATES.has(current.state)) return;
    const next = backendResult?.exit_code === 0 ? 'COMPLETED' : 'FAILED';
    let workspaceStatus = { dirty:false, porcelain:'', commits:[], diff_stat:'' };
    const ws = workspaceFromRecord(current);
    if (ws) {
      try { workspaceStatus = await this.workspaceManager.statusWorkspace(ws); } catch {}
    }
    const updated = await this.stateStore.update(agentId, {
      ended_at: now(),
      session_id: backendResult?.session_id ?? current.session_id ?? null,
      exit_code: backendResult?.exit_code ?? 1,
      terminal_reason: next === 'FAILED' ? (backendResult?.stderr_tail || backendResult?.signal || 'codex child failed') : null,
    }, next);
    const result = this.#resultPayload(updated, ws, { ...backendResult, ...workspaceStatus });
    await this.stateStore.writeResult(agentId, result, backendResult?.final_text ?? '');
    this.active.delete(agentId);
    this.#notify(agentId, publicRecord(updated));
    await this.#drainUnlocked();
  }

  #resultPayload(record, workspace, extra = {}) {
    return {
      agent_id: record.agent_id,
      role: record.role,
      backend: 'codex_cli',
      state: record.state,
      exit_code: record.exit_code ?? extra.exit_code ?? null,
      session_id: record.session_id ?? extra.session_id ?? null,
      branch: record.branch ?? workspace?.branch ?? null,
      worktree: record.worktree ?? workspace?.path ?? null,
      base_sha: record.base_sha ?? workspace?.base_sha ?? null,
      commits: extra.commits ?? [],
      diff_stat: extra.diff_stat ?? '',
      stderr_tail: String(extra.stderr_tail ?? '').slice(-8192),
      artifact_paths: {
        state: path.join(this.stateStore.agentDir(record.agent_id), 'state.json'),
        events: path.join(this.stateStore.agentDir(record.agent_id), 'events.jsonl'),
        stderr: path.join(this.stateStore.agentDir(record.agent_id), 'stderr.log'),
        result: path.join(this.stateStore.agentDir(record.agent_id), 'result.json'),
        result_text: path.join(this.stateStore.agentDir(record.agent_id), 'result.txt'),
      },
    };
  }

  async status(agentId) {
    const record = await this.stateStore.get(agentId);
    if (!record) throw brokerError('NOT_FOUND', `unknown agent: ${agentId}`);
    return publicRecord(record);
  }

  async list(filter = {}) {
    const records = await this.stateStore.list(filter);
    return records.slice(0, 200).map(publicRecord);
  }

  async wait(agentId, timeoutMs) {
    const current = await this.status(agentId);
    if (TERMINAL_STATES.has(current.state)) return current;
    return new Promise(resolve => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(async () => {
        this.#removeWaiter(agentId, waiter);
        resolve(await this.status(agentId));
      }, timeoutMs);
      let set = this.waiters.get(agentId);
      if (!set) this.waiters.set(agentId, set = new Set());
      set.add(waiter);
    });
  }

  #notify(agentId, record) {
    const set = this.waiters.get(agentId);
    if (!set) return;
    if (!TERMINAL_STATES.has(record.state)) return;
    this.waiters.delete(agentId);
    for (const waiter of set) {
      clearTimeout(waiter.timer);
      waiter.resolve(record);
    }
  }

  #removeWaiter(agentId, waiter) {
    const set = this.waiters.get(agentId);
    if (!set) return;
    set.delete(waiter);
    if (!set.size) this.waiters.delete(agentId);
  }

  async result(agentId) {
    const status = await this.status(agentId);
    if (!TERMINAL_STATES.has(status.state)) throw brokerError('NOT_READY', `agent ${agentId} is ${status.state}`);
    const result = await this.stateStore.readResult(agentId);
    if (!result) throw brokerError('RESULT_INCOMPLETE', `terminal agent ${agentId} has no result metadata`);
    return result;
  }

  async followup(agentId, message) {
    if (typeof message !== 'string' || !message.trim()) throw brokerError('INVALID_ARGUMENT', 'followup message must be nonblank');
    return this.#withLock(async () => {
      let record = await this.stateStore.get(agentId);
      if (!record) throw brokerError('NOT_FOUND', `unknown agent: ${agentId}`);
      if (record.state !== 'COMPLETED' || !record.session_id) throw brokerError('CAPABILITY_UNAVAILABLE', 'agent is not a resumable completed session');
      if (this.#runningCount() >= this.maxRunning) throw brokerError('RESOURCE_EXHAUSTED', `subagent running limit ${this.maxRunning} reached`);
      const caps = await this.backend.probe();
      if (!caps.resume) throw brokerError('CAPABILITY_UNAVAILABLE', 'codex resume is unavailable');

      record = await this.stateStore.update(agentId, { followup_started_at: now() }, 'SPAWNING', 'followup');
      const prior = this.handles.get(agentId) ?? {
        agent_id: agentId,
        session_id: record.session_id,
        cwd: record.worktree,
        workspace_mode: record.workspace_mode,
      };

      let handle;
      try {
        handle = await this.backend.followup(
          { ...prior, session_id: record.session_id, cwd: record.worktree, workspace_mode: record.workspace_mode },
          message
        );
      } catch (error) {
        const failed = await this.stateStore.update(agentId, {
          ended_at: now(),
          exit_code: 1,
          terminal_reason: String(error?.message ?? error),
        }, 'FAILED');
        await this.stateStore.writeResult(
          agentId,
          this.#resultPayload(failed, workspaceFromRecord(failed), { stderr_tail: failed.terminal_reason }),
          ''
        );
        this.#notify(agentId, publicRecord(failed));
        await this.#drainUnlocked();
        throw error;
      }

      // Attach a rejection observer immediately so an already-settled backend
      // promise cannot become an unhandled rejection before RUNNING is persisted.
      handle.completion.catch(() => {});

      this.handles.set(agentId, handle);
      this.active.add(agentId);
      record = await this.stateStore.update(agentId, {
        pid: handle.pid,
        process_identity: handle.process_identity ?? null,
        started_at: now(),
        ended_at: null,
        exit_code: null,
        terminal_reason: null,
        session_id: record.session_id,
      }, 'RUNNING');
      this.#scheduleTimeout(record);
      this.#notify(agentId, publicRecord(record));

      handle.completion.then(
        result => this.#withLock(() => this.#finalizeUnlocked(agentId, result)),
        error => this.#withLock(() => this.#finalizeUnlocked(agentId, {
          exit_code: 1,
          signal: null,
          session_id: record.session_id,
          final_text: '',
          stderr_tail: String(error?.message ?? error),
        }))
      ).catch(() => {});
      return publicRecord(record);
    });
  }

  async cancel(agentId) {
    let handle = null;
    let queued = false;
    await this.#withLock(async () => {
      let record = await this.stateStore.get(agentId);
      if (!record) throw brokerError('NOT_FOUND', `unknown agent: ${agentId}`);
      if (TERMINAL_STATES.has(record.state)) return;
      if (record.state === 'QUEUED') {
        this.#dequeue(agentId);
        queued = true;
        record = await this.stateStore.update(agentId, { ended_at: now(), terminal_reason: 'cancelled while queued' }, 'CANCELLED');
        await this.stateStore.writeResult(agentId, this.#resultPayload(record, null), '');
        this.#notify(agentId, publicRecord(record));
        return;
      }
      if (record.state === 'RUNNING' || record.state === 'SPAWNING') {
        record = await this.stateStore.update(agentId, { terminal_reason: 'cancellation requested' }, 'CANCEL_REQUESTED');
      }
      if (record.state === 'CANCEL_REQUESTED') {
        handle = this.handles.get(agentId) ?? (record.pid ? {
          agent_id: agentId,
          pid: record.pid,
          process_identity: record.process_identity ?? null,
          cwd: record.worktree ?? null,
          workspace_mode: record.workspace_mode,
          session_id: record.session_id ?? null,
          rehydrated: true,
        } : null);
      }
    });
    if (queued) return this.status(agentId);
    let cancelError = null;
    if (handle) {
      try { await this.backend.cancel(handle, { graceSeconds: this.cancelGraceSeconds }); }
      catch (error) { cancelError = error; }
    } else {
      cancelError = brokerError('CAPABILITY_UNAVAILABLE', `agent ${agentId} has no attributable process handle`);
    }
    if (cancelError) {
      await this.#withLock(async () => {
        let record = await this.stateStore.get(agentId);
        if (record?.state === 'CANCEL_REQUESTED' && cancelError?.code === 'PROCESS_IDENTITY_MISMATCH') {
          record = await this.stateStore.update(agentId, { ended_at: now(), terminal_reason: String(cancelError.message ?? cancelError) }, 'ORPHANED');
          this.active.delete(agentId);
          this.rehydratedRunning.delete(agentId);
          this.#clearTimeout(agentId);
          this.#notify(agentId, publicRecord(record));
          await this.#drainUnlocked();
        }
      });
      throw cancelError;
    }
    await this.#withLock(async () => {
      let record = await this.stateStore.get(agentId);
      if (record?.state === 'CANCEL_REQUESTED') {
        record = await this.stateStore.update(agentId, { ended_at: now(), terminal_reason: 'cancelled' }, 'CANCELLED');
        await this.stateStore.writeResult(agentId, this.#resultPayload(record, workspaceFromRecord(record), { stderr_tail: handle?.stderr_tail ?? '' }), '');
        this.#notify(agentId, publicRecord(record));
      }
      this.active.delete(agentId);
      this.rehydratedRunning.delete(agentId);
      this.#clearTimeout(agentId);
      this.timeoutPending.delete(agentId);
      await this.#drainUnlocked();
    });
    return this.status(agentId);
  }

  async cleanup(agentId, options = {}) {
    const purgeMetadata = Boolean(options.purge_metadata ?? options.purgeMetadata);
    return this.#withLock(async () => {
      const record = await this.stateStore.get(agentId);
      if (!record) throw brokerError('NOT_FOUND', `unknown agent: ${agentId}`);
      if (!TERMINAL_STATES.has(record.state)) throw brokerError('NOT_READY', 'cleanup requires terminal agent');
      const result = await this.stateStore.readResult(agentId);
      if (!result) throw brokerError('RESULT_INCOMPLETE', 'cleanup requires result metadata');
      const ws = workspaceFromRecord(record);
      if (ws) {
        const status = await this.workspaceManager.statusWorkspace(ws);
        if (status.dirty) throw new Error(`refusing cleanup of dirty worktree: ${status.porcelain}`);
        await this.workspaceManager.cleanupWorkspace(ws, { purgeBranch: Boolean(ws.branch) });
      }
      const dir = this.stateStore.agentDir(agentId);
      if (purgeMetadata) {
        await fs.rm(dir, { recursive: true, force: true });
      } else {
        for (const name of ['prompt.txt','events.jsonl','stderr.log','result.txt']) await fs.rm(path.join(dir, name), { force: true });
      }
      this.handles.delete(agentId);
      this.active.delete(agentId);
      this.rehydratedRunning.delete(agentId);
      return { agent_id: agentId, cleaned: true, purged_metadata: purgeMetadata };
    });
  }

  async shutdown() {
    this.shuttingDown = true;
    const queued = [...this.highQueue, ...this.normalQueue];
    for (const id of queued) await this.cancel(id).catch(() => {});
    const active = [...new Set([...this.active, ...this.rehydratedRunning])];
    for (const id of active) await this.cancel(id).catch(() => {});
    if (this.rehydratedTimer) clearTimeout(this.rehydratedTimer);
    this.rehydratedTimer = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.timeoutPending.clear();
    for (const set of this.waiters.values()) for (const w of set) { clearTimeout(w.timer); w.resolve(await this.status(w.agent_id).catch(() => null)); }
    this.waiters.clear();
  }
}
