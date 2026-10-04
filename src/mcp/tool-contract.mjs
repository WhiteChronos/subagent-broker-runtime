export const BROKER_TOOL_NAMES = [
  'subagent_spawn','subagent_status','subagent_wait','subagent_result',
  'subagent_followup','subagent_list','subagent_cancel','subagent_cleanup'
];

function schema(name) {
  const defs = {
    subagent_spawn: {properties:{task:{type:'string'},role:{type:'string',enum:['implementer','reviewer','researcher','tester','security-reviewer']},workspace_mode:{type:'string',enum:['read_only','worktree_write']},base_ref:{type:['string','null']},timeout_seconds:{type:'integer',minimum:1,maximum:86400},priority:{type:'string',enum:['normal','high']}},required:['task','role','workspace_mode']},
    subagent_wait: {properties:{agent_id:{type:'string'},timeout_ms:{type:'integer',minimum:1000,maximum:600000}},required:['agent_id','timeout_ms']},
    subagent_followup: {properties:{agent_id:{type:'string'},message:{type:'string'}},required:['agent_id','message']},
    subagent_list: {properties:{state:{type:'string'}},required:[]},
    subagent_cleanup: {properties:{agent_id:{type:'string'},purge_metadata:{type:'boolean'}},required:['agent_id']},
  };
  return {type:'object',additionalProperties:false,...(defs[name]??{properties:{agent_id:{type:'string'}},required:['agent_id']})};
}

const rows = [
  ['subagent_spawn','Spawn one independent Codex child.',false,false],
  ['subagent_status','Read current child lifecycle state.',true,false],
  ['subagent_wait','Wait until terminal state or timeout.',true,false],
  ['subagent_result','Read terminal result metadata.',true,false],
  ['subagent_followup','Resume a completed child session.',false,false],
  ['subagent_list','List known children.',true,false],
  ['subagent_cancel','Cancel a queued or running child.',false,true],
  ['subagent_cleanup','Safely clean terminal child artifacts/worktree.',false,true],
];

export const BROKER_TOOL_DEFINITIONS = rows.map(([name,description,readOnly,destructive]) => ({
  name,
  description,
  inputSchema: schema(name),
  annotations: {readOnlyHint:readOnly,destructiveHint:destructive,idempotentHint:readOnly,openWorldHint:false},
}));
