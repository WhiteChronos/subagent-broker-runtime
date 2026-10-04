import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {resolveBase,createWorkspace,statusWorkspace,cleanupWorkspace} from '../../src/git-isolation/worktree-manager.mjs';
function run(cmd,args,cwd){return new Promise((res,rej)=>{const p=spawn(cmd,args,{cwd,shell:false});let e='';p.stderr.on('data',d=>e+=d);p.on('close',c=>c?rej(new Error(e)):res());});}
async function repo(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'subagent-git-'));await run('git',['init','-q'],root);await run('git',['config','user.email','test@example.com'],root);await run('git',['config','user.name','test'],root);await fs.writeFile(path.join(root,'a.txt'),'a');await run('git',['add','.'],root);await run('git',['commit','-qm','init'],root);return root;}
test('read-only workspace is detached under the bounded namespace',async()=>{const root=await repo();try{const base=await resolveBase(root,'HEAD');assert.match(base,/^[0-9a-f]{40}$/);const ws=await createWorkspace({repoRoot:root,agentId:'sa_read',baseSha:base,mode:'read_only'});assert.equal(ws.branch,null);assert.equal(ws.path,path.join(root,'.worktrees','subagents','sa_read'));assert.equal((await statusWorkspace(ws)).dirty,false);await cleanupWorkspace(ws);await assert.rejects(fs.access(ws.path));}finally{await fs.rm(root,{recursive:true,force:true});}});
test('write workspace is isolated and dirty cleanup refuses',async()=>{const root=await repo();try{const base=await resolveBase(root,'HEAD');const ws=await createWorkspace({repoRoot:root,agentId:'sa_write',baseSha:base,mode:'worktree_write'});assert.equal(ws.branch,'subagent/sa_write');await fs.writeFile(path.join(ws.path,'dirty.txt'),'x');await assert.rejects(()=>cleanupWorkspace(ws,{purgeBranch:true}),/dirty worktree/i);}finally{await fs.rm(root,{recursive:true,force:true});}});
test('cleanup rejects worktree paths outside .worktrees/subagents',async()=>{const root=await repo();try{const base=await resolveBase(root,'HEAD');await assert.rejects(()=>cleanupWorkspace({repo_root:root,path:root,mode:'read_only',base_sha:base,branch:null}),/outside .*worktrees\/subagents/i);}finally{await fs.rm(root,{recursive:true,force:true});}});
