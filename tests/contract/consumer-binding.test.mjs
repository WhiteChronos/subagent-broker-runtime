import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveConsumerRepoRoot } from '../../src/runtime/consumer-repo.mjs';

function run(command,args,cwd){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,shell:false,stdio:['ignore','pipe','pipe']});
    let out='',err=''; child.stdout.on('data',d=>out+=d); child.stderr.on('data',d=>err+=d);
    child.on('error',reject); child.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err.trim()||String(code))));
  });
}
async function makeRepo(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'broker-consumer-'));
  await run('git',['init','-q'],root);
  await fs.mkdir(path.join(root,'nested'),{recursive:true});
  return root;
}

test('consumer binding fails closed when root is missing, blank, relative, nonexistent, or non-git', async()=>{
  await assert.rejects(()=>resolveConsumerRepoRoot({configuredRoot:undefined}),/SUBAGENT_BROKER_REPO_ROOT/i);
  await assert.rejects(()=>resolveConsumerRepoRoot({configuredRoot:'   '}),/SUBAGENT_BROKER_REPO_ROOT/i);
  await assert.rejects(()=>resolveConsumerRepoRoot({configuredRoot:'relative/path'}),/absolute/i);
  await assert.rejects(()=>resolveConsumerRepoRoot({configuredRoot:'/definitely/missing/broker-repo'}),/does not exist|realpath/i);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'broker-nongit-'));
  try { await assert.rejects(()=>resolveConsumerRepoRoot({configuredRoot:dir}),/Git repository/i); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('consumer binding canonicalizes a subdirectory to the git toplevel', async()=>{
  const root=await makeRepo();
  try {
    const resolved=await resolveConsumerRepoRoot({configuredRoot:path.join(root,'nested')});
    assert.equal(resolved,await fs.realpath(root));
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('consumer binding never falls back to cwd when configuration is absent', async()=>{
  const root=await makeRepo(); const old=process.cwd();
  try {
    process.chdir(root);
    await assert.rejects(()=>resolveConsumerRepoRoot({configuredRoot:undefined}),/SUBAGENT_BROKER_REPO_ROOT/i);
  } finally { process.chdir(old); await fs.rm(root,{recursive:true,force:true}); }
});
