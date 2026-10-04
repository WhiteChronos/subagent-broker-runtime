import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BROKER_TOOL_NAMES, BROKER_TOOL_DEFINITIONS } from '../../src/mcp/tool-contract.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/legacy-tool-contract.json', import.meta.url), 'utf8'));

test('Broker tool names stay exact and ordered', () => {
  assert.deepEqual(BROKER_TOOL_NAMES, [
    'subagent_spawn','subagent_status','subagent_wait','subagent_result',
    'subagent_followup','subagent_list','subagent_cancel','subagent_cleanup'
  ]);
});

test('Broker tool definitions preserve source schemas and annotations', () => {
  assert.deepEqual(BROKER_TOOL_DEFINITIONS, fixture);
});
