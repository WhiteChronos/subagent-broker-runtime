export const AGENT_STATES = new Set([
  'QUEUED','SPAWNING','RUNNING','COMPLETED','FAILED','TIMED_OUT',
  'CANCEL_REQUESTED','CANCELLED','ORPHANED'
]);

export const TERMINAL_STATES = new Set(['COMPLETED','FAILED','TIMED_OUT','CANCELLED','ORPHANED']);

const NORMAL_TRANSITIONS = new Map([
  ['QUEUED', new Set(['SPAWNING','CANCELLED'])],
  ['SPAWNING', new Set(['RUNNING','FAILED','CANCEL_REQUESTED','ORPHANED'])],
  ['RUNNING', new Set(['COMPLETED','FAILED','TIMED_OUT','CANCEL_REQUESTED','ORPHANED'])],
  ['CANCEL_REQUESTED', new Set(['CANCELLED','ORPHANED'])],
  ['COMPLETED', new Set()],
  ['FAILED', new Set()],
  ['TIMED_OUT', new Set()],
  ['CANCELLED', new Set()],
  ['ORPHANED', new Set()],
]);

export function canTransition(from, to) {
  return NORMAL_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertTransition(from, to, reason = null) {
  if (from === 'COMPLETED' && to === 'SPAWNING' && reason === 'followup') return;
  if (!canTransition(from, to)) throw brokerError('INVALID_TRANSITION', `illegal lifecycle transition ${from} -> ${to}`, {from,to,reason});
}

export function brokerError(code, message, details = undefined) {
  const error = new Error(String(message));
  error.name = 'SubagentBrokerError';
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

const ROLES = new Set(['implementer','reviewer','researcher','tester','security-reviewer']);
const MODES = new Set(['read_only','worktree_write']);
const PRIORITIES = new Set(['normal','high']);

function object(value, label='arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw brokerError('INVALID_ARGUMENT', `${label} must be an object`);
  return value;
}
function strictKeys(value, allowed) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw brokerError('INVALID_ARGUMENT', `unknown field: ${key}`);
}
function string(value, name, {blank=false}={}) {
  if (typeof value !== 'string' || (!blank && !value.trim())) throw brokerError('INVALID_ARGUMENT', `${name} must be a nonblank string`);
  return value;
}
function agentId(value) {
  const v=string(value,'agent_id');
  if (!/^sa_[A-Za-z0-9_-]+$/.test(v)) throw brokerError('INVALID_ARGUMENT','agent_id is invalid');
  return v;
}
function bool(value,name,def=false){
  if(value===undefined)return def;
  if(typeof value!=='boolean')throw brokerError('INVALID_ARGUMENT',`${name} must be boolean`);
  return value;
}

export function validateSpawnArgs(value) {
  const v=object(value);
  strictKeys(v,new Set(['task','role','workspace_mode','base_ref','timeout_seconds','priority']));
  const task=string(v.task,'task');
  const role=string(v.role,'role');
  if(!ROLES.has(role))throw brokerError('INVALID_ARGUMENT',`role must be one of: ${[...ROLES].join(', ')}`);
  const workspace_mode=string(v.workspace_mode,'workspace_mode');
  if(!MODES.has(workspace_mode))throw brokerError('INVALID_ARGUMENT','workspace_mode must be read_only or worktree_write');
  const priority=v.priority===undefined?'normal':string(v.priority,'priority');
  if(!PRIORITIES.has(priority))throw brokerError('INVALID_ARGUMENT','priority must be normal or high');
  const timeout_seconds=v.timeout_seconds===undefined?1800:Number(v.timeout_seconds);
  if(!Number.isInteger(timeout_seconds)||timeout_seconds<1||timeout_seconds>86400)throw brokerError('INVALID_ARGUMENT','timeout_seconds must be an integer between 1 and 86400');
  let base_ref=null;
  if(v.base_ref!==undefined&&v.base_ref!==null){
    base_ref=string(v.base_ref,'base_ref');
    if(/[\0\r\n]/.test(base_ref))throw brokerError('INVALID_ARGUMENT','base_ref contains invalid characters');
  }
  return {task,role,workspace_mode,base_ref,timeout_seconds,priority};
}

function oneAgent(value, extra=[]) {
  const v=object(value); strictKeys(v,new Set(['agent_id',...extra])); return {v,agent_id:agentId(v.agent_id)};
}
export function validateStatusArgs(value){const {agent_id}=oneAgent(value);return{agent_id};}
export function validateResultArgs(value){const {agent_id}=oneAgent(value);return{agent_id};}
export function validateCancelArgs(value){const {agent_id}=oneAgent(value);return{agent_id};}
export function validateWaitArgs(value){
  const {v,agent_id}=oneAgent(value,['timeout_ms']);
  const timeout_ms=Number(v.timeout_ms);
  if(!Number.isInteger(timeout_ms)||timeout_ms<1000||timeout_ms>600000)throw brokerError('INVALID_ARGUMENT','timeout_ms must be an integer between 1000 and 600000');
  return {agent_id,timeout_ms};
}
export function validateFollowupArgs(value){const {v,agent_id}=oneAgent(value,['message']);return{agent_id,message:string(v.message,'message')};}
export function validateListArgs(value={}){
  const v=object(value);strictKeys(v,new Set(['state']));
  if(v.state===undefined)return{};
  const state=string(v.state,'state');if(!AGENT_STATES.has(state))throw brokerError('INVALID_ARGUMENT','state is invalid');return{state};
}
export function validateCleanupArgs(value){const {v,agent_id}=oneAgent(value,['purge_metadata']);return{agent_id,purge_metadata:bool(v.purge_metadata,'purge_metadata',false)};}
