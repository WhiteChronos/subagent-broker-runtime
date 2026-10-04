#!/usr/bin/env node
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('codex-cli 99.0.0');process.exit(0);}
if(args[0]==='exec'&&args.includes('--help')){console.log('Usage: codex exec [--json] [--sandbox MODE] [--ask-for-approval POLICY] [resume]');process.exit(0);}
if(args[0]==='exec'&&args[1]==='resume'&&args.includes('--help')){console.log('Usage: codex exec resume SESSION -');process.exit(0);}
let input=''; for await(const chunk of process.stdin) input+=chunk;
if(input.includes('emit-secret')) process.stderr.write(`secret=${process.env.CODEX_ACCESS_TOKEN}\n`);
const ri=args.indexOf('resume'); const session=ri>=0?args[ri+1]:'sess-'+process.pid;
console.log(JSON.stringify({type:'thread.started',thread_id:session}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:ri>=0?'resumed':'completed'}}));
