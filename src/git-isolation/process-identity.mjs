import fs from 'node:fs/promises';
import { brokerError } from '../broker/protocol.mjs';

export async function readLinuxProcessIdentity(pid) {
  const n=Number(pid);
  if(!Number.isInteger(n)||n<=0)return null;
  try {
    const text=await fs.readFile(`/proc/${n}/stat`,'utf8');
    const close=text.lastIndexOf(')');
    if(close<0)return null;
    const rest=text.slice(close+2).trim().split(/\s+/);
    const start_ticks=rest[19];
    if(!start_ticks)return null;
    return {pid:n,start_ticks:String(start_ticks)};
  } catch(error) {
    if(error?.code==='ENOENT'||error?.code==='ESRCH'||error?.code==='EACCES')return null;
    throw error;
  }
}
export function isSameProcessIdentity(recorded,current){
  return Boolean(recorded&&current&&Number(recorded.pid)===Number(current.pid)&&String(recorded.start_ticks)===String(current.start_ticks));
}
export function terminateProcessGroup(pid,signal='SIGTERM'){
  const n=Number(pid);if(!Number.isInteger(n)||n<=0)throw brokerError('INVALID_ARGUMENT','pid must be a positive integer');
  try { process.kill(-n,signal); return true; }
  catch(error){ if(error?.code==='ESRCH')return false; throw error; }
}
