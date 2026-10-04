#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BROKER_TOOL_NAMES } from '../src/mcp/tool-contract.mjs';

const pluginRoot=fileURLToPath(new URL('../',import.meta.url));
const repo=await fs.mkdtemp(path.join(os.tmpdir(),'broker-health-'));
try{
  const git=spawnSync('git',['init','-q'],{cwd:repo,encoding:'utf8'});
  if(git.status!==0) throw new Error(git.stderr||'git init failed');
  const env={...process.env,SUBAGENT_BROKER_REPO_ROOT:repo,SUBAGENT_BROKER_CODEX_PATH:process.execPath};
  const transport=new StdioClientTransport({command:process.execPath,args:['src/transports/stdio.mjs'],cwd:pluginRoot,env,stderr:'pipe'});
  const client=new Client({name:'broker-stdio-healthcheck',version:'1.0.0'});
  try{
    await client.connect(transport);
    const listed=await client.listTools();
    const names=listed.tools.map(tool=>tool.name);
    if(JSON.stringify(names)!==JSON.stringify(BROKER_TOOL_NAMES)) throw new Error(`tool contract mismatch: ${JSON.stringify(names)}`);
    process.stdout.write(JSON.stringify({runtime:'broker',version:'1.1.0',transport:'stdio',initialize:'PASS',tools_list:'PASS',tools:names,child_spawned:false})+'\n');
  } finally { await client.close().catch(()=>{}); }
} finally { await fs.rm(repo,{recursive:true,force:true}); }
