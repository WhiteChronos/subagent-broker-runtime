import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AGENT_STATES, TERMINAL_STATES, assertTransition, brokerError } from '../broker/protocol.mjs';
import { readLinuxProcessIdentity, isSameProcessIdentity } from '../git-isolation/process-identity.mjs';

function now(){return new Date().toISOString();}
function safeId(id){if(typeof id!=='string'||!/^sa_[A-Za-z0-9_-]+$/.test(id))throw brokerError('INVALID_ARGUMENT','invalid agent id');return id;}
async function ensureDir(p){await fs.mkdir(p,{recursive:true,mode:0o700});try{await fs.chmod(p,0o700);}catch{}}
async function atomicJson(file,value){
  await ensureDir(path.dirname(file));
  const tmp=`${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  try{await fs.chmod(tmp,0o600);}catch{}
  await fs.rename(tmp,file);
  try{await fs.chmod(file,0o600);}catch{}
}
async function writePrivate(file,text,{append=false}={}){
  await ensureDir(path.dirname(file));
  if(append)await fs.appendFile(file,String(text),{mode:0o600});else await fs.writeFile(file,String(text),{mode:0o600});
  try{await fs.chmod(file,0o600);}catch{}
}

export class StateStore {
  constructor(root){if(!root)throw new Error('state root required');this.root=path.resolve(root);}
  agentDir(agentId){return path.join(this.root,safeId(agentId));}
  statePath(id){return path.join(this.agentDir(id),'state.json');}
  async create(record){
    safeId(record?.agent_id);if(!AGENT_STATES.has(record?.state))throw brokerError('INVALID_ARGUMENT','invalid initial state');
    const dir=this.agentDir(record.agent_id);await ensureDir(dir);
    try{await fs.access(this.statePath(record.agent_id));throw brokerError('ALREADY_EXISTS',`agent ${record.agent_id} already exists`);}catch(e){if(e?.code!=='ENOENT')throw e;}
    const normalized={...record,transition_history:Array.isArray(record.transition_history)?record.transition_history:[],created_at:record.created_at??now(),updated_at:now()};
    await atomicJson(this.statePath(record.agent_id),normalized);return normalized;
  }
  async get(agentId){try{return JSON.parse(await fs.readFile(this.statePath(agentId),'utf8'));}catch(e){if(e?.code==='ENOENT')return null;throw e;}}
  async update(agentId,patch={},nextState=undefined,reason=null){
    const current=await this.get(agentId);if(!current)throw brokerError('NOT_FOUND',`unknown agent: ${agentId}`);
    const out={...current,...patch};
    if(nextState!==undefined&&nextState!==current.state){
      if(!AGENT_STATES.has(nextState))throw brokerError('INVALID_ARGUMENT','invalid next state');
      assertTransition(current.state,nextState,reason);
      const history=Array.isArray(current.transition_history)?[...current.transition_history]:[];
      history.push({from:current.state,to:nextState,at:now(),reason:reason??null});
      out.transition_history=history;out.state=nextState;
    }
    out.updated_at=now();await atomicJson(this.statePath(agentId),out);return out;
  }
  async list(filter={}){
    try{const names=await fs.readdir(this.root,{withFileTypes:true});const out=[];for(const ent of names){if(!ent.isDirectory()||!/^sa_/.test(ent.name))continue;const r=await this.get(ent.name);if(r&&(!filter.state||r.state===filter.state))out.push(r);}out.sort((a,b)=>String(a.created_at??'').localeCompare(String(b.created_at??''))||a.agent_id.localeCompare(b.agent_id));return out;}
    catch(e){if(e?.code==='ENOENT')return[];throw e;}
  }
  async writePrompt(id,text){await writePrivate(path.join(this.agentDir(id),'prompt.txt'),text);}
  async readPrompt(id){return fs.readFile(path.join(this.agentDir(id),'prompt.txt'),'utf8');}
  async appendEvent(id,line){await writePrivate(path.join(this.agentDir(id),'events.jsonl'),String(line).endsWith('\n')?line:`${line}\n`,{append:true});}
  async appendStderr(id,text){await writePrivate(path.join(this.agentDir(id),'stderr.log'),text,{append:true});}
  async writeResult(id,result,finalText=''){await atomicJson(path.join(this.agentDir(id),'result.json'),result);await writePrivate(path.join(this.agentDir(id),'result.txt'),finalText);}
  async readResult(id){try{return JSON.parse(await fs.readFile(path.join(this.agentDir(id),'result.json'),'utf8'));}catch(e){if(e?.code==='ENOENT')return null;throw e;}}
  async reconcileNonterminal(processProbe=readLinuxProcessIdentity){
    const records=await this.list();const out=[];
    for(let record of records){
      if(TERMINAL_STATES.has(record.state)||record.state==='QUEUED'){out.push(record);continue;}
      if(!['SPAWNING','RUNNING','CANCEL_REQUESTED'].includes(record.state)){out.push(record);continue;}
      const recorded=record.process_identity; const current=record.pid?await processProbe(record.pid):null;
      if(!record.pid||!recorded||!isSameProcessIdentity(recorded,current)){
        record=await this.update(record.agent_id,{ended_at:now(),terminal_reason:'process missing or identity mismatch during restart recovery'},'ORPHANED');
      }
      out.push(record);
    }
    return out;
  }
}
