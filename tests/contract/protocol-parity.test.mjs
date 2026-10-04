import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AGENT_STATES, TERMINAL_STATES, canTransition, assertTransition,
  validateSpawnArgs, validateWaitArgs, validateStatusArgs,
} from '../../src/broker/protocol.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/legacy-protocol-contract.json', import.meta.url), 'utf8'));

test('Broker lifecycle and validation contract matches source v1.0.0', () => {
  assert.deepEqual([...AGENT_STATES], fixture.agent_states);
  assert.deepEqual([...TERMINAL_STATES], fixture.terminal_states);
  assert.equal(canTransition('QUEUED','SPAWNING'), true);
  assert.equal(canTransition('RUNNING','COMPLETED'), true);
  assert.equal(canTransition('COMPLETED','SPAWNING'), false);
  assert.doesNotThrow(() => assertTransition('COMPLETED','SPAWNING','followup'));
  assert.throws(() => assertTransition('FAILED','SPAWNING','followup'));

  const spawn = validateSpawnArgs({task:'x', role:'implementer', workspace_mode:'worktree_write'});
  assert.equal(spawn.timeout_seconds, fixture.spawn_timeout_default);
  assert.equal(spawn.priority, 'normal');
  assert.throws(() => validateSpawnArgs({task:'x',role:'implementer',workspace_mode:'worktree_write',command:'rm -rf /'}), /unknown field/i);
  assert.throws(() => validateSpawnArgs({task:'x',role:'bogus',workspace_mode:'read_only'}), /role/i);
  assert.throws(() => validateSpawnArgs({task:'x',role:'reviewer',workspace_mode:'read_only',timeout_seconds:0}), /timeout_seconds/i);
  assert.throws(() => validateSpawnArgs({task:'x',role:'reviewer',workspace_mode:'read_only',timeout_seconds:86401}), /timeout_seconds/i);
  assert.throws(() => validateSpawnArgs({task:'x',role:'reviewer',workspace_mode:'read_only',base_ref:'bad\nref'}), /base_ref/i);
  assert.equal(validateWaitArgs({agent_id:'sa_abc',timeout_ms:1000}).timeout_ms,1000);
  assert.throws(() => validateWaitArgs({agent_id:'sa_abc',timeout_ms:999}), /timeout/i);
  assert.throws(() => validateWaitArgs({agent_id:'sa_abc',timeout_ms:600001}), /timeout/i);
  assert.throws(() => validateStatusArgs({agent_id:'bad'}), /agent_id/i);
});

test('all five role files preserve bounded role instructions', async () => {
  const names=['implementer','reviewer','researcher','tester','security-reviewer'];
  for (const name of names) {
    const text=await readFile(new URL(`../../roles/${name}.md`, import.meta.url), 'utf8');
    assert.ok(text.startsWith('# '));
    assert.ok(text.length > 100);
  }
});
