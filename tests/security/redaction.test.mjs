import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChildEnv, redactText } from '../../src/security/redaction.mjs';
test('child environment is strictly allowlisted',()=>{const env=buildChildEnv({PATH:'/bin',HOME:'/tmp/h',LANG:'C',RANDOM_SECRET:'hide',CODEX_ACCESS_TOKEN:'codex-token',OPENAI_API_KEY:'api-key'});assert.equal(env.PATH,'/bin');assert.equal(env.CODEX_ACCESS_TOKEN,'codex-token');assert.equal('RANDOM_SECRET' in env,false);assert.equal('OPENAI_API_KEY' in env,false);});
test('secret values are redacted longest-first',()=>{const text=redactText('failed token-123 and token',{MY_TOKEN:'token-123',SHORT_TOKEN:'token'});assert.equal(text,'failed [REDACTED] and [REDACTED]');});
