#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveConsumerRepoRoot } from '../runtime/consumer-repo.mjs';
import { createBrokerMcpServer } from '../mcp/create-broker-server.mjs';

const repoRoot=await resolveConsumerRepoRoot();
const {server,broker}=await createBrokerMcpServer({repoRoot});
const transport=new StdioServerTransport();
let shuttingDown=false;
async function shutdown(){
  if(shuttingDown) return;
  shuttingDown=true;
  await broker.shutdown().catch(()=>{});
  await server.close().catch(()=>{});
}
process.once('SIGINT',()=>void shutdown().finally(()=>process.exit(0)));
process.once('SIGTERM',()=>void shutdown().finally(()=>process.exit(0)));
await server.connect(transport);
