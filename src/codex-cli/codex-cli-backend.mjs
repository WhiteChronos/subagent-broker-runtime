import { spawn } from 'node:child_process';
import { buildChildEnv, redactText } from '../security/redaction.mjs';
import { brokerError } from '../broker/protocol.mjs';
import { readLinuxProcessIdentity, isSameProcessIdentity, terminateProcessGroup } from '../git-isolation/process-identity.mjs';

function execCapture(command,args,{cwd,env}={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,env,shell:false,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});}
export function extractSessionId(event){
  if(!event||typeof event!=='object')return null;
  const direct=['session_id','sessionId','thread_id','threadId'];for(const k of direct)if(typeof event[k]==='string'&&event[k])return event[k];
  for(const key of ['session','thread','item']){const v=event[key];if(v&&typeof v==='object'){const found=extractSessionId(v);if(found)return found;}}
  return null;
}
function extractAgentText(event){const item=event?.item;if(item?.type==='agent_message'&&typeof item.text==='string')return item.text;if(event?.type==='agent_message'&&typeof event.text==='string')return event.text;return null;}

export class CodexCliBackend{
  constructor({codexPath='codex',stateStore,parentEnv=process.env,processProbe=readLinuxProcessIdentity}={}){if(!stateStore)throw new Error('stateStore required');this.codexPath=codexPath;this.stateStore=stateStore;this.parentEnv=parentEnv;this.processProbe=processProbe;this.cached=null;}
  async probe({refresh=false}={}){
    if(this.cached&&!refresh)return this.cached;
    const env=buildChildEnv(this.parentEnv);const version=await execCapture(this.codexPath,['--version'],{env}).catch(()=>({code:1,stdout:'',stderr:''}));
    const help=await execCapture(this.codexPath,['exec','--help'],{env}).catch(()=>({code:1,stdout:'',stderr:''}));
    const resume=await execCapture(this.codexPath,['exec','resume','--help'],{env}).catch(()=>({code:1,stdout:'',stderr:''}));
    const h=`${help.stdout}\n${help.stderr}`;const rh=`${resume.stdout}\n${resume.stderr}`;
    this.cached={version:version.code===0?version.stdout.trim():'unavailable',exec:help.code===0,json:/--json\b/.test(h),resume:resume.code===0&&/resume/i.test(rh),sandboxReadOnly:/--sandbox\b/.test(h),sandboxWorkspaceWrite:/--sandbox\b/.test(h),approvalNever:/--ask-for-approval\b/.test(h)};return this.cached;
  }
  async #launch({agent_id,prompt,cwd,workspace_mode,resumeSession=null}){
    const caps=await this.probe();if(!caps.exec||!caps.json)throw brokerError('CAPABILITY_UNAVAILABLE','codex exec --json is unavailable');
    const args=['exec','--json'];
    if(caps.sandboxReadOnly||caps.sandboxWorkspaceWrite)args.push('--sandbox',workspace_mode==='worktree_write'?'workspace-write':'read-only');
    if(caps.approvalNever)args.push('--ask-for-approval','never');
    if(resumeSession)args.push('resume',resumeSession,'-');else args.push('-');
    const child=spawn(this.codexPath,args,{cwd,env:buildChildEnv(this.parentEnv),shell:false,detached:process.platform==='linux',stdio:['pipe','pipe','pipe']});
    const identity=await this.processProbe(child.pid);let session_id=resumeSession??null,final_text='',stderr='';const pending=[];let buffer='';
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;let idx;while((idx=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,idx);buffer=buffer.slice(idx+1);if(!line.trim())continue;pending.push(this.stateStore.appendEvent(agent_id,line));try{const event=JSON.parse(line);session_id=extractSessionId(event)??session_id;final_text=extractAgentText(event)??final_text;}catch{}}});
    child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{const clean=redactText(chunk,this.parentEnv);stderr=(stderr+clean).slice(-65536);pending.push(this.stateStore.appendStderr(agent_id,clean));});
    child.stdin.end(String(prompt));
    const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',async(code,signal)=>{if(buffer.trim()){pending.push(this.stateStore.appendEvent(agent_id,buffer.trim()));try{const event=JSON.parse(buffer.trim());session_id=extractSessionId(event)??session_id;final_text=extractAgentText(event)??final_text;}catch{}}await Promise.allSettled(pending);resolve({exit_code:code??1,signal,session_id,final_text,stderr_tail:stderr.slice(-8192)});});});
    return {agent_id,pid:child.pid,process_identity:identity,session_id,cwd,workspace_mode,child,completion,get stderr_tail(){return stderr.slice(-8192);}};
  }
  spawn(spec){return this.#launch(spec);}
  async followup(handle,message){const caps=await this.probe();if(!caps.resume||!handle?.session_id)throw brokerError('CAPABILITY_UNAVAILABLE','codex resume is unavailable');return this.#launch({agent_id:handle.agent_id,prompt:message,cwd:handle.cwd,workspace_mode:handle.workspace_mode,resumeSession:handle.session_id});}
  async cancel(handle,{graceSeconds=10}={}){
    if(!handle?.pid)throw brokerError('CAPABILITY_UNAVAILABLE','child pid is unavailable');
    if(!handle.process_identity)throw brokerError('PROCESS_IDENTITY_MISMATCH','recorded child process identity is unavailable');
    const current=await this.processProbe(handle.pid);if(!isSameProcessIdentity(handle.process_identity,current))throw brokerError('PROCESS_IDENTITY_MISMATCH','recorded child process identity no longer matches live pid');
    terminateProcessGroup(handle.pid,'SIGTERM');const deadline=Date.now()+Math.max(0,graceSeconds)*1000;
    while(Date.now()<deadline){const now=await this.processProbe(handle.pid);if(!now||!isSameProcessIdentity(handle.process_identity,now))return;await new Promise(r=>setTimeout(r,50));}
    const again=await this.processProbe(handle.pid);if(handle.process_identity&&isSameProcessIdentity(handle.process_identity,again)){terminateProcessGroup(handle.pid,'SIGKILL');return;}
  }
}
