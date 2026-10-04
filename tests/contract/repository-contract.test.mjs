import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const json = async path => JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'));
const text = async path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('repository contract freezes independent Broker identity and provenance', async () => {
  const pkg = await json('package.json');
  assert.equal(pkg.name, '@whitechronos/subagent-broker-runtime');
  assert.equal(pkg.version, '1.1.0');
  assert.equal(pkg.engines.node, '>=22 <23');

  const runtime = await json('runtime-contract.json');
  assert.equal(runtime.contract_version, 'whitechronos-runtime/v1');
  assert.equal(runtime.component, 'broker');
  assert.equal(runtime.component_version, '1.1.0');
  assert.equal(runtime.plugin_name, 'subagent-broker');
  assert.deepEqual(runtime.supported_transports, ['stdio']);
  assert.deepEqual(runtime.required_host_capabilities, [
    'git', 'codex-cli', 'linux-process-identity', 'explicit-consumer-repo-binding'
  ]);
  assert.deepEqual(runtime.tool_contract, [
    'subagent_spawn','subagent_status','subagent_wait','subagent_result',
    'subagent_followup','subagent_list','subagent_cancel','subagent_cleanup'
  ]);

  const source = await json('provenance/source-lock.json');
  assert.equal(source.source_repository, 'WhiteChronos/ChatGPT');
  assert.equal(source.source_commit, 'ef3b5fd77ab96dc3c0950725cd6f5c57b49a8988');
  assert.equal(source.source_path, 'plugins/subagent-broker');
  assert.equal(source.source_plugin_version, '1.0.0');

  const license = await text('LICENSE');
  assert.match(license, /MIT License/);
});
