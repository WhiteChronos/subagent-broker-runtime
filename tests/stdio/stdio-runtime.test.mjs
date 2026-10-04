import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BROKER_TOOL_NAMES, BROKER_TOOL_DEFINITIONS } from '../../src/mcp/tool-contract.mjs';

const pluginRoot=fileURLToPath(new URL('../../',import.meta.url));
const fakeCodex=fileURLToPath(new URL('../codex/fake-codex.mjs',import.meta.url));

function run(command,args,cwd){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,shell:false,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr=''; child.stdout.on('data',d=>stdout+=d); child.stderr.on('data',d=>stderr+=d);
    child.on('error',reject); child.on('close',code=>code===0?resolve(stdout.trim()):reject(new Error(stderr.trim()||String(code))));
  });
}
async function makeRepo(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'broker-mcp-consumer-'));
  await run('git',['init','-q'],root); await run('git',['config','user.email','test@example.com'],root); await run('git',['config','user.name','test'],root);
  await fs.writeFile(path.join(root,'README.md'),'fixture\n'); await run('git',['add','.'],root); await run('git',['commit','-qm','init'],root);
  return root;
}
async function withClient(fn){
  const repo=await makeRepo(); await fs.chmod(fakeCodex,0o755);
  const env={...process.env,SUBAGENT_BROKER_REPO_ROOT:repo,SUBAGENT_BROKER_CODEX_PATH:fakeCodex};
  const transport=new StdioClientTransport({command:process.execPath,args:['src/transports/stdio.mjs'],cwd:pluginRoot,env,stderr:'pipe'});
  const client=new Client({name:'broker-stdio-test',version:'1.0.0'});
  try{await client.connect(transport);return await fn({client,transport,repo});}
  finally{await client.close().catch(()=>{});await fs.rm(repo,{recursive:true,force:true});}
}
const parseText=result=>JSON.parse(result.content.find(x=>x.type==='text').text);

test('stdio runtime initializes as subagent-broker 1.1.0 and exposes exact eight-tool contract',async()=>{
  await withClient(async({client,transport})=>{
    assert.ok(transport.pid);
    assert.deepEqual(client.getServerVersion(),{name:'subagent-broker',version:'1.1.0'});
    const listed=await client.listTools();assert.deepEqual(listed.tools.map(x=>x.name),BROKER_TOOL_NAMES);
    for(let i=0;i<listed.tools.length;i++){assert.equal(listed.tools[i].description,BROKER_TOOL_DEFINITIONS[i].description);assert.deepEqual(listed.tools[i].inputSchema,BROKER_TOOL_DEFINITIONS[i].inputSchema);assert.deepEqual(listed.tools[i].annotations,BROKER_TOOL_DEFINITIONS[i].annotations);}
  });
});
test('stdio runtime fails closed without explicit consumer repo binding',async()=>{
  const before=await fs.stat(path.join(pluginRoot,'.superpowers','subagents')).then(()=>true).catch(()=>false);
  const env={...process.env}; delete env.SUBAGENT_BROKER_REPO_ROOT; env.SUBAGENT_BROKER_CODEX_PATH=fakeCodex;
  const transport=new StdioClientTransport({command:process.execPath,args:['src/transports/stdio.mjs'],cwd:pluginRoot,env,stderr:'pipe'});
  const client=new Client({name:'broker-config-test',version:'1.0.0'});
  await assert.rejects(()=>client.connect(transport),/closed|connection|SUBAGENT_BROKER_REPO_ROOT/i);await client.close().catch(()=>{});
  const after=await fs.stat(path.join(pluginRoot,'.superpowers','subagents')).then(()=>true).catch(()=>false);assert.equal(after,before);
});
test('stdio MCP lifecycle uses fake Codex and remains isolated in the bound consumer repo',async()=>{
  await withClient(async({client,repo})=>{
    const spawnResult=await client.callTool({name:'subagent_spawn',arguments:{task:'inspect',role:'researcher',workspace_mode:'read_only'}});
    assert.equal(spawnResult.isError,false);const spawned=parseText(spawnResult);assert.match(spawned.agent_id,/^sa_/);assert.ok(spawned.pid);
    const status=parseText(await client.callTool({name:'subagent_status',arguments:{agent_id:spawned.agent_id}}));assert.match(status.state,/RUNNING|COMPLETED/);
    const waited=parseText(await client.callTool({name:'subagent_wait',arguments:{agent_id:spawned.agent_id,timeout_ms:5000}}));assert.equal(waited.state,'COMPLETED');
    const result=parseText(await client.callTool({name:'subagent_result',arguments:{agent_id:spawned.agent_id}}));assert.equal(result.state,'COMPLETED');assert.ok(result.worktree.startsWith(path.join(repo,'.worktrees','subagents')));
    const listed=parseText(await client.callTool({name:'subagent_list',arguments:{}}));assert.ok(listed.some(x=>x.agent_id===spawned.agent_id));
    const cleaned=parseText(await client.callTool({name:'subagent_cleanup',arguments:{agent_id:spawned.agent_id,purge_metadata:true}}));assert.equal(cleaned.cleaned,true);
  });
});
test('stdio MCP preserves structured error envelopes for unknown and invalid tool calls',async()=>{
  await withClient(async({client})=>{
    const unknown=await client.callTool({name:'not_a_broker_tool',arguments:{}});assert.equal(unknown.isError,true);assert.equal(parseText(unknown).code,'UNKNOWN_TOOL');
    const invalid=await client.callTool({name:'subagent_spawn',arguments:{task:'x',role:'bogus',workspace_mode:'read_only'}});
    assert.equal(invalid.isError,true);const payload=parseText(invalid);assert.equal(payload.code,'INVALID_ARGUMENT');assert.match(payload.message,/role/i);assert.ok('details' in payload);
  });
});
test('stdio healthcheck verifies initialize and tools/list without starting a child',async()=>{
  const run=spawn(process.execPath,['scripts/healthcheck-stdio.mjs'],{cwd:pluginRoot,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';run.stdout.on('data',d=>stdout+=d);run.stderr.on('data',d=>stderr+=d);
  const code=await new Promise(resolve=>run.on('close',resolve));assert.equal(code,0,stderr||stdout);
  const payload=JSON.parse(stdout.trim());assert.equal(payload.runtime,'broker');assert.equal(payload.version,'1.1.0');assert.equal(payload.transport,'stdio');assert.equal(payload.initialize,'PASS');assert.equal(payload.tools_list,'PASS');assert.deepEqual(payload.tools,BROKER_TOOL_NAMES);assert.equal(payload.child_spawned,false);
});
