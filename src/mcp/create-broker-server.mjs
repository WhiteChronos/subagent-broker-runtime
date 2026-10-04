import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StateStore } from '../state/state-store.mjs';
import { CodexCliBackend } from '../codex-cli/codex-cli-backend.mjs';
import { SubagentBroker } from '../broker/broker.mjs';
import { BROKER_TOOL_DEFINITIONS } from './tool-contract.mjs';
import {
  validateSpawnArgs, validateStatusArgs, validateWaitArgs, validateResultArgs,
  validateFollowupArgs, validateListArgs, validateCancelArgs, validateCleanupArgs,
} from '../broker/protocol.mjs';

function toolResult(value,isError=false){
  const result={content:[{type:'text',text:JSON.stringify(value)}],isError};
  if(value && typeof value==='object' && !Array.isArray(value)) result.structuredContent=value;
  return result;
}

export async function createBrokerMcpServer({
  repoRoot,
  codexPath=process.env.SUBAGENT_BROKER_CODEX_PATH||'codex',
  parentEnv=process.env,
}={}){
  if(!repoRoot) throw new Error('repoRoot is required');
  const store=new StateStore(path.join(repoRoot,'.superpowers','subagents'));
  const backend=new CodexCliBackend({codexPath,stateStore:store,parentEnv});
  const broker=new SubagentBroker({repoRoot,stateStore:store,backend});
  await broker.start();
  const server=new Server({name:'subagent-broker',version:'1.1.0'},{capabilities:{tools:{}}});
  const validators={subagent_spawn:validateSpawnArgs,subagent_status:validateStatusArgs,subagent_wait:validateWaitArgs,subagent_result:validateResultArgs,subagent_followup:validateFollowupArgs,subagent_list:validateListArgs,subagent_cancel:validateCancelArgs,subagent_cleanup:validateCleanupArgs};
  const handlers={subagent_spawn:a=>broker.spawn(a),subagent_status:a=>broker.status(a.agent_id),subagent_wait:a=>broker.wait(a.agent_id,a.timeout_ms),subagent_result:a=>broker.result(a.agent_id),subagent_followup:a=>broker.followup(a.agent_id,a.message),subagent_list:a=>broker.list(a),subagent_cancel:a=>broker.cancel(a.agent_id),subagent_cleanup:a=>broker.cleanup(a.agent_id,a)};
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:BROKER_TOOL_DEFINITIONS}));
  server.setRequestHandler(CallToolRequestSchema,async request=>{
    const name=request.params.name;
    if(!handlers[name]) return toolResult({code:'UNKNOWN_TOOL',message:`unknown tool: ${name}`},true);
    try{const args=validators[name](request.params.arguments??{});return toolResult(await handlers[name](args),false);}
    catch(error){return toolResult({code:error?.code||'BROKER_ERROR',message:String(error?.message??error),details:error?.details??null},true);}
  });
  return {server,broker};
}
