import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const readJson=async p=>JSON.parse(await readFile(new URL(`../../${p}`,import.meta.url),'utf8'));
const expectedEnv=['SUBAGENT_BROKER_REPO_ROOT','SUBAGENT_BROKER_CODEX_PATH','CODEX_HOME','CODEX_ACCESS_TOKEN'];
test('portable and Codex compatibility manifests preserve the single stdio Broker server',async()=>{
  const plugin=await readJson('plugin.json');assert.equal(plugin.$schema,'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');assert.equal(plugin.name,'subagent-broker');assert.equal(plugin.version,'1.1.0');assert.equal(plugin.license,'MIT');assert.equal(plugin.repository,'https://github.com/WhiteChronos/subagent-broker-runtime');
  const mcp=await readJson('mcp.json');assert.equal(mcp.$schema,'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');assert.deepEqual(Object.keys(mcp.mcpServers),['subagent_broker']);assert.deepEqual(mcp.mcpServers.subagent_broker,{type:'stdio',command:'node',args:['${PLUGIN_ROOT}/src/transports/stdio.mjs'],cwd:'${PLUGIN_ROOT}',env_vars:expectedEnv});
  const compat=await readJson('.codex-plugin/plugin.json');assert.equal(compat.name,'subagent-broker');assert.equal(compat.version,'1.1.0');assert.equal(compat.skills,'./skills/');assert.equal(compat.mcpServers,'./.mcp.json');
  const cmcp=await readJson('.mcp.json');assert.deepEqual(Object.keys(cmcp.mcpServers),['subagent_broker']);assert.deepEqual(cmcp.mcpServers.subagent_broker,{type:'stdio',command:'node',args:['./src/transports/stdio.mjs'],cwd:'.',env_vars:expectedEnv});
  assert.equal('url' in mcp.mcpServers.subagent_broker,false);assert.equal(mcp.mcpServers.subagent_broker.type,'stdio');
  const check=spawnSync(process.execPath,['scripts/generate-compat-manifests.mjs','--check'],{encoding:'utf8'});assert.equal(check.status,0,check.stderr||check.stdout);
});
