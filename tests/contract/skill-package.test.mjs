import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const skill=new URL('../../skills/subagent-broker/',import.meta.url);
test('Subagent Broker skill is self-contained and preserves native-first truthful routing',async()=>{
  const text=await readFile(new URL('SKILL.md',skill),'utf8');
  assert.match(text,/^---\nname: subagent-broker\n/m);
  assert.match(text,/actual current tool list/i);assert.match(text,/native Codex multi-agent/i);assert.match(text,/Subagent Broker MCP/i);assert.match(text,/inline fallback/i);assert.match(text,/Never call a prompt persona/i);assert.match(text,/Never allow a child to write directly to `main`/i);
  assert.doesNotMatch(text,/WhiteChronos\/ChatGPT\/plugins\/subagent-broker/);
  await access(new URL('agents/openai.yaml',skill));for(const p of ['references/lifecycle.md','references/routing.md','references/security.md','references/superpowers-sdd.md'])await access(new URL(p,skill));
});
