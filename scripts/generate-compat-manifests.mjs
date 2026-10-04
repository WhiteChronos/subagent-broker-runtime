import { readFile, writeFile, mkdir } from 'node:fs/promises';
import process from 'node:process';
const readJson=async p=>JSON.parse(await readFile(p,'utf8'));
const stable=value=>JSON.stringify(value,null,2)+'\n';
export async function generateCompatibilityManifests({pluginManifestPath='plugin.json',portableMcpPath='mcp.json'}={}){
  const plugin=await readJson(pluginManifestPath);const mcp=await readJson(portableMcpPath);
  const entries=Object.entries(mcp.mcpServers||{});
  if(entries.length!==1) throw new Error('Broker portable package must declare exactly one active MCP server');
  const [name,server]=entries[0];
  if(name!=='subagent_broker'||server.type!=='stdio'||server.command!=='node') throw new Error('Broker active MCP must be subagent_broker over stdio node');
  if(server.url||JSON.stringify(server).includes('streamable-http')) throw new Error('HTTP transport is not allowed in this slice');
  const args=(server.args||[]).map(x=>x.replace('${PLUGIN_ROOT}/','./'));
  const cwd=server.cwd==='${PLUGIN_ROOT}'?'.':server.cwd;
  const compatPlugin={name:plugin.name,version:plugin.version,description:plugin.description,author:plugin.author,homepage:plugin.homepage,repository:plugin.repository,license:plugin.license,keywords:plugin.keywords,skills:'./skills/',mcpServers:'./.mcp.json',interface:{displayName:'Subagent Broker',shortDescription:'Run real fallback Codex subagents when native spawn tools are unavailable.',longDescription:'Prefers native Codex multi-agent tools. When the current harness lacks them, exposes a stateful MCP broker that launches independent codex exec processes in isolated Git snapshots/worktrees and preserves truthful lifecycle evidence.'}};
  const compatMcp={mcpServers:{[name]:{type:server.type,command:server.command,args,cwd,env_vars:[...(server.env_vars||[])]}}};
  return {plugin:stable(compatPlugin),mcp:stable(compatMcp)};
}
async function main(){
  const check=process.argv.includes('--check');const generated=await generateCompatibilityManifests();
  if(check){const currentPlugin=await readFile('.codex-plugin/plugin.json','utf8').catch(()=>null);const currentMcp=await readFile('.mcp.json','utf8').catch(()=>null);if(currentPlugin!==generated.plugin||currentMcp!==generated.mcp){console.error('compatibility manifests are stale');process.exit(1);}return;}
  await mkdir('.codex-plugin',{recursive:true});await writeFile('.codex-plugin/plugin.json',generated.plugin);await writeFile('.mcp.json',generated.mcp);
}
if(import.meta.url===`file://${process.argv[1]}`) main().catch(e=>{console.error(e.stack||e);process.exit(1);});
