#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StateStore } from '../src/state/state-store.mjs';
import { CodexCliBackend } from '../src/codex-cli/codex-cli-backend.mjs';
import { SubagentBroker } from '../src/broker/broker.mjs';
import { resolveConsumerRepoRoot } from '../src/runtime/consumer-repo.mjs';
import { redactText } from '../src/security/redaction.mjs';

export async function probeRealCodex({codexPath='codex'}={}){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'subagent-broker-probe-'));
  try{const store=new StateStore(tmp);const backend=new CodexCliBackend({codexPath,stateStore:store,parentEnv:process.env});return await backend.probe({refresh:true});}
  finally{await fs.rm(tmp,{recursive:true,force:true});}
}
function safeTimestamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function requireDistinct(label,values){if(values.some(v=>v===null||v===undefined||v===''))throw new Error(`${label} evidence is incomplete.`);if(new Set(values).size!==values.length)throw new Error(`${label} evidence is not distinct.`);}

export async function runLiveSmoke({env=process.env}={}){
  if(env.SUBAGENT_BROKER_LIVE!=='1') return {skipped:true,reason:'Set SUBAGENT_BROKER_LIVE=1 to run real Codex smoke.'};
  const repoRoot=await resolveConsumerRepoRoot({configuredRoot:env.SUBAGENT_BROKER_REPO_ROOT});
  const stateRoot=path.join(repoRoot,'.superpowers','subagents');
  const store=new StateStore(stateRoot);
  const backend=new CodexCliBackend({codexPath:env.SUBAGENT_BROKER_CODEX_PATH||'codex',stateStore:store,parentEnv:env});
  const capabilities=await backend.probe({refresh:true});
  if(!capabilities.exec||!capabilities.json) throw new Error('Real Codex CLI does not expose required codex exec --json capability.');
  const broker=new SubagentBroker({repoRoot,stateStore:store,backend});await broker.start();
  const evidenceDir=path.join(stateRoot,`smoke-${safeTimestamp()}`);await fs.mkdir(evidenceDir,{recursive:true,mode:0o700});
  const agents=[];const summary={started_at:new Date().toISOString(),repo_root:repoRoot,capabilities,agents,followup:null,cancellation:null,success:false};
  try{
    const a=await broker.spawn({task:'Read repository instructions and report one repository rule in one sentence. Do not modify files.',role:'researcher',workspace_mode:'read_only'});agents.push({kind:'read-a',spawn:a});
    const b=await broker.spawn({task:'Read the Subagent Broker README and report its routing order in one sentence. Do not modify files.',role:'researcher',workspace_mode:'read_only'});agents.push({kind:'read-b',spawn:b});
    requireDistinct('Concurrent child PIDs',[a.pid,b.pid]);requireDistinct('Concurrent child agent IDs',[a.agent_id,b.agent_id]);
    const [aw,bw]=await Promise.all([broker.wait(a.agent_id,600000),broker.wait(b.agent_id,600000)]);
    if(aw.state!=='COMPLETED'||bw.state!=='COMPLETED')throw new Error(`Read smoke children not completed: ${aw.state}, ${bw.state}`);
    agents[0].result=await broker.result(a.agent_id);agents[1].result=await broker.result(b.agent_id);
    requireDistinct('Concurrent child trace paths',[agents[0].result?.artifact_paths?.events,agents[1].result?.artifact_paths?.events]);

    const smokeFile=`.subagent-broker-smoke-${Date.now()}.txt`;
    const w=await broker.spawn({task:`In this isolated child worktree only, create ${smokeFile} containing exactly smoke, git add it, and commit it with message "test: subagent broker smoke". Do not change any other file.`,role:'implementer',workspace_mode:'worktree_write'});agents.push({kind:'write',spawn:w});
    const ww=await broker.wait(w.agent_id,600000);if(ww.state!=='COMPLETED')throw new Error(`Write smoke child ended ${ww.state}`);
    const wr=await broker.result(w.agent_id);agents[2].result=wr;if(!wr.branch||!wr.worktree||!wr.commits?.length)throw new Error('Write smoke child did not produce branch/worktree/commit evidence.');

    if(capabilities.resume&&wr.session_id){
      const f=await broker.followup(w.agent_id,'Report the current branch and confirm the disposable smoke commit exists. Do not modify files.');
      const fw=await broker.wait(w.agent_id,600000);if(fw.state!=='COMPLETED')throw new Error(`Follow-up ended ${fw.state}`);
      const fr=await broker.result(w.agent_id);if(fr.session_id!==wr.session_id||fr.worktree!==wr.worktree)throw new Error('Follow-up did not preserve session/worktree identity.');
      summary.followup={supported:true,spawn:f,result:fr};
    }else summary.followup={supported:false,reason:'CLI resume or session identifier unavailable'};

    const latestWrite=await broker.result(w.agent_id);
    const reviewer=await broker.spawn({task:'Review only the disposable smoke commit on this exact snapshot. Confirm whether exactly one disposable smoke file was added. Do not modify files.',role:'reviewer',workspace_mode:'read_only',base_ref:latestWrite.branch});agents.push({kind:'reviewer',spawn:reviewer});
    const rv=await broker.wait(reviewer.agent_id,600000);if(rv.state!=='COMPLETED')throw new Error(`Reviewer ended ${rv.state}`);agents[3].result=await broker.result(reviewer.agent_id);

    const long=await broker.spawn({task:'Run the command `sleep 300` and wait for it to finish before responding. Do not modify files.',role:'tester',workspace_mode:'read_only'});agents.push({kind:'cancel-target',spawn:long});
    await new Promise(r=>setTimeout(r,2000));const cancelled=await broker.cancel(long.agent_id);if(cancelled.state!=='CANCELLED')throw new Error(`Cancel target ended ${cancelled.state}`);summary.cancellation=cancelled;

    for(const entry of agents){const st=await broker.status(entry.spawn.agent_id);if(['COMPLETED','FAILED','TIMED_OUT','CANCELLED','ORPHANED'].includes(st.state)){try{entry.cleanup=await broker.cleanup(entry.spawn.agent_id);}catch(e){entry.cleanup_error=String(e?.message??e);}}}
    summary.success=true;summary.completed_at=new Date().toISOString();
    const summaryPath=path.join(evidenceDir,'summary.json');const serialized=redactText(JSON.stringify(summary,null,2),env)+'\n';await fs.writeFile(summaryPath,serialized,{mode:0o600});
    return {...summary,evidence_path:summaryPath};
  }finally{await broker.shutdown().catch(()=>{});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const result=await runLiveSmoke();if(result.skipped){process.stdout.write(`SKIPPED: ${result.reason}\n`);process.exit(0);}process.stdout.write(JSON.stringify(result,null,2)+'\n');}
  catch(error){process.stderr.write(`SMOKE FAILED: ${String(error?.stack??error)}\n`);process.exit(1);}
}
