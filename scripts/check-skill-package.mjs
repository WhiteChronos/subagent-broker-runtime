#!/usr/bin/env node
import { access, readFile, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const skillRoot=resolve('skills/subagent-broker');
const skillMd=await readFile(resolve(skillRoot,'SKILL.md'),'utf8');
if(!/^---\nname: subagent-broker\n/m.test(skillMd)) throw new Error('Skill name must remain subagent-broker');
for(const p of ['agents/openai.yaml','references/lifecycle.md','references/routing.md','references/security.md','references/superpowers-sdd.md']) await access(resolve(skillRoot,p));
if(skillMd.includes('WhiteChronos/ChatGPT/plugins/subagent-broker')) throw new Error('Skill contains legacy runtime path dependency');
const out=await mkdtemp(join(tmpdir(),'broker-skill-package-'));
const zip=spawnSync('zip',['-qr',join(out,'skill.zip'),'subagent-broker'],{cwd:resolve('skills'),encoding:'utf8'});if(zip.status!==0)throw new Error(zip.stderr||zip.stdout||'zip failed');
const verify=spawnSync('unzip',['-t',join(out,'skill.zip')],{encoding:'utf8'});if(verify.status!==0)throw new Error(verify.stderr||verify.stdout||'zip verification failed');
process.stdout.write(JSON.stringify({skill:'subagent-broker',package:'PASS',output:join(out,'skill.zip')})+'\n');
