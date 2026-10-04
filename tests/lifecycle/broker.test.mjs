import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from '../../src/state/state-store.mjs';
import { SubagentBroker } from '../../src/broker/broker.mjs';

function deferred(){let resolve,reject;const completion=new Promise((res,rej)=>{resolve=res;reject=rej;});return{completion,resolve,reject};}
function fixture(){
  const runs=[];
  const backend={
    async probe(){return{resume:true};},
    async spawn(spec){const d=deferred();const h={pid:100+runs.length,process_identity:{pid:100+runs.length,start_ticks:String(runs.length+1)},session_id:'s'+runs.length,completion:d.completion,...spec};runs.push({h,d});return h;},
    async followup(h){const d=deferred();const n={...h,pid:h.pid+100,process_identity:{pid:h.pid+100,start_ticks:'f'},completion:d.completion};runs.push({h:n,d});return n;},
    async cancel(){}
  };
  const ws={
    async resolveBase(){return'a'.repeat(40);},
    async createWorkspace({agentId,mode,baseSha}){return{repo_root:'/repo',path:'/tmp/'+agentId,mode,base_sha:baseSha,branch:mode==='worktree_write'?'subagent/'+agentId:null};},
    async statusWorkspace(){return{dirty:false,porcelain:'',commits:['c'.repeat(40)],diff_stat:'1 file changed'};},
    async cleanupWorkspace(){}
  };
  return{backend,ws,runs};
}
async function makeBroker(options={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'subagent-broker-'));
  const store=new StateStore(root);const f=fixture();let n=0;
  const broker=new SubagentBroker({repoRoot:'/repo',stateStore:store,backend:f.backend,workspaceManager:f.ws,roleLoader:async role=>`role:${role}`,idFactory:()=> 'sa_'+(++n),...options});
  return{root,store,broker,...f};
}
test('default scheduler runs three, queues later work, and drains high priority first',async()=>{
  const x=await makeBroker();
  try{
    const a=[];for(let i=0;i<4;i++)a.push(await x.broker.spawn({task:'x',role:'reviewer',workspace_mode:'read_only'}));
    const high=await x.broker.spawn({task:'high',role:'reviewer',workspace_mode:'read_only',priority:'high'});
    assert.deepEqual(a.map(v=>v.state),['RUNNING','RUNNING','RUNNING','QUEUED']);assert.equal(high.state,'QUEUED');
    x.runs[0].d.resolve({exit_code:0,session_id:'s0',final_text:'ok'});assert.equal((await x.broker.wait('sa_1',1000)).state,'COMPLETED');
    const deadline=Date.now()+1000;let highState;do{highState=(await x.broker.status('sa_5')).state;if(highState==='RUNNING')break;await new Promise(r=>setTimeout(r,20));}while(Date.now()<deadline);
    assert.equal(highState,'RUNNING');assert.equal((await x.broker.status('sa_4')).state,'QUEUED');
  }finally{await x.broker.shutdown();await fs.rm(x.root,{recursive:true,force:true});}
});
test('queue exhaustion fails closed',async()=>{const x=await makeBroker({maxRunning:1,maxQueued:1});try{await x.broker.spawn({task:'one',role:'reviewer',workspace_mode:'read_only'});await x.broker.spawn({task:'two',role:'reviewer',workspace_mode:'read_only'});await assert.rejects(()=>x.broker.spawn({task:'three',role:'reviewer',workspace_mode:'read_only'}),e=>e.code==='RESOURCE_EXHAUSTED');}finally{await x.broker.shutdown();await fs.rm(x.root,{recursive:true,force:true});}});
test('completed write child exposes branch, worktree, commits, diff and session evidence while status retains pid',async()=>{const x=await makeBroker();try{const s=await x.broker.spawn({task:'write',role:'implementer',workspace_mode:'worktree_write'});x.runs[0].d.resolve({exit_code:0,session_id:'sess-write',final_text:'done',stderr_tail:''});assert.equal((await x.broker.wait(s.agent_id,1000)).state,'COMPLETED');const result=await x.broker.result(s.agent_id);assert.equal(result.state,'COMPLETED');assert.equal(result.branch,`subagent/${s.agent_id}`);assert.equal(result.worktree,`/tmp/${s.agent_id}`);assert.deepEqual(result.commits,['c'.repeat(40)]);assert.equal(result.diff_stat,'1 file changed');assert.equal(result.session_id,'sess-write');const status=await x.broker.status(s.agent_id);assert.ok(status.pid);}finally{await x.broker.shutdown();await fs.rm(x.root,{recursive:true,force:true});}});
test('queued child can be cancelled without starting a process',async()=>{const x=await makeBroker({maxRunning:1,maxQueued:2});try{await x.broker.spawn({task:'run',role:'tester',workspace_mode:'read_only'});const q=await x.broker.spawn({task:'queue',role:'tester',workspace_mode:'read_only'});assert.equal(q.state,'QUEUED');const cancelled=await x.broker.cancel(q.agent_id);assert.equal(cancelled.state,'CANCELLED');assert.equal(x.runs.length,1);}finally{await x.broker.shutdown();await fs.rm(x.root,{recursive:true,force:true});}});
test('default role loader reads roles from the independent repository root',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'subagent-broker-role-'));const store=new StateStore(root);const f=fixture();let n=0;const broker=new SubagentBroker({repoRoot:'/repo',stateStore:store,backend:f.backend,workspaceManager:f.ws,idFactory:()=> 'sa_'+(++n)});try{await broker.spawn({task:'inspect',role:'reviewer',workspace_mode:'read_only'});assert.match(f.runs[0].h.prompt,/^# Reviewer/m);}finally{await broker.shutdown();await fs.rm(root,{recursive:true,force:true});}});
