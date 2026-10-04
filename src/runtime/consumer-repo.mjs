import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { brokerError } from '../broker/protocol.mjs';

function execFile(command,args,{cwd}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,shell:false,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',d=>stdout+=d);
    child.stderr.on('data',d=>stderr+=d);
    child.on('error',reject);
    child.on('close',code=>resolve({code,stdout:stdout.trim(),stderr:stderr.trim()}));
  });
}

export async function resolveConsumerRepoRoot({configuredRoot=process.env.SUBAGENT_BROKER_REPO_ROOT}={}){
  if(typeof configuredRoot!=='string'||!configuredRoot.trim()) throw brokerError('CONFIGURATION_ERROR','SUBAGENT_BROKER_REPO_ROOT is required');
  if(!path.isAbsolute(configuredRoot)) throw brokerError('CONFIGURATION_ERROR','SUBAGENT_BROKER_REPO_ROOT must be an absolute path');
  let candidate;
  try { candidate=await fs.realpath(configuredRoot); }
  catch(error){ throw brokerError('CONFIGURATION_ERROR',`SUBAGENT_BROKER_REPO_ROOT realpath failed or does not exist: ${error?.message??error}`); }
  const result=await execFile('git',['rev-parse','--show-toplevel'],{cwd:candidate});
  if(result.code!==0||!result.stdout) throw brokerError('CONFIGURATION_ERROR','SUBAGENT_BROKER_REPO_ROOT must resolve inside a Git repository');
  return fs.realpath(result.stdout);
}
