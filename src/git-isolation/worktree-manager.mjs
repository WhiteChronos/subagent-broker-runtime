import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function execFile(command, args, { cwd, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore','pipe','pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('error', reject);
    child.on('close', code => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(stderr.trim() || `${command} ${args.join(' ')} failed with ${code}`));
    });
  });
}
function assertSafeAgentId(agentId) {
  if (typeof agentId !== 'string' || !/^sa_[A-Za-z0-9_-]+$/.test(agentId)) throw new Error('invalid agent id');
}
function allowedWorktreeRoot(repoRoot) { return path.resolve(repoRoot, '.worktrees', 'subagents'); }
function assertInsideWorktreeNamespace(repoRoot, candidate) {
  const base = allowedWorktreeRoot(repoRoot);
  const resolved = path.resolve(candidate);
  if (resolved === base || !resolved.startsWith(base + path.sep)) throw new Error('worktree path is outside .worktrees/subagents namespace');
  return resolved;
}
export async function resolveBase(repoRoot, baseRef = 'HEAD') {
  const ref = baseRef == null ? 'HEAD' : String(baseRef);
  if (!ref.trim() || /[\0\r\n]/.test(ref)) throw new Error('invalid base ref');
  const result = await execFile('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: repoRoot, allowFailure: true });
  if (result.code !== 0 || !/^[0-9a-f]{40}$/i.test(result.stdout)) throw new Error(`base ref does not resolve to a commit: ${ref}`);
  return result.stdout.toLowerCase();
}
export async function createWorkspace({ repoRoot, agentId, baseSha, mode }) {
  assertSafeAgentId(agentId);
  if (!['read_only','worktree_write'].includes(mode)) throw new Error('invalid workspace mode');
  if (!/^[0-9a-f]{40}$/i.test(String(baseSha))) throw new Error('baseSha must be an exact commit SHA');
  const root = path.resolve(repoRoot);
  const workspacePath = assertInsideWorktreeNamespace(root, path.join(allowedWorktreeRoot(root), agentId));
  await fs.mkdir(path.dirname(workspacePath), { recursive: true });
  try { await fs.access(workspacePath); throw new Error('worktree path already exists'); }
  catch (e) { if (e?.message === 'worktree path already exists') throw e; }
  let branch = null;
  if (mode === 'read_only') await execFile('git', ['worktree', 'add', '--detach', workspacePath, baseSha], { cwd: root });
  else { branch = `subagent/${agentId}`; await execFile('git', ['worktree', 'add', '-b', branch, workspacePath, baseSha], { cwd: root }); }
  return { repo_root: root, path: workspacePath, mode, base_sha: String(baseSha).toLowerCase(), branch };
}
export async function statusWorkspace(workspace) {
  const workspacePath = assertInsideWorktreeNamespace(workspace.repo_root, workspace.path);
  const status = await execFile('git', ['status', '--porcelain=v1'], { cwd: workspacePath });
  const log = await execFile('git', ['log', '--format=%H', `${workspace.base_sha}..HEAD`], { cwd: workspacePath });
  const diff = await execFile('git', ['diff', '--stat', `${workspace.base_sha}...HEAD`], { cwd: workspacePath });
  return { dirty:Boolean(status.stdout), porcelain:status.stdout, commits:log.stdout?log.stdout.split(/\r?\n/).filter(Boolean):[], diff_stat:diff.stdout };
}
export async function cleanupWorkspace(workspace, { purgeBranch = false } = {}) {
  const root = path.resolve(workspace.repo_root);
  const workspacePath = assertInsideWorktreeNamespace(root, workspace.path);
  const status = await statusWorkspace(workspace);
  if (status.dirty) throw new Error(`refusing cleanup of dirty worktree: ${status.porcelain}`);
  await execFile('git', ['worktree', 'remove', workspacePath], { cwd: root });
  if (purgeBranch && workspace.branch) await execFile('git', ['branch', '-D', workspace.branch], { cwd: root });
}
