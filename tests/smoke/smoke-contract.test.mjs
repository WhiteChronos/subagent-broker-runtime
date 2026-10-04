import test from 'node:test';
import assert from 'node:assert/strict';
import { runLiveSmoke } from '../../scripts/smoke_real_codex.mjs';
test('real Broker smoke is opt-in and requires the live flag',async()=>{const result=await runLiveSmoke({env:{}});assert.equal(result.skipped,true);assert.match(result.reason,/SUBAGENT_BROKER_LIVE=1/);});
