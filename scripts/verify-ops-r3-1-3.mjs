import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
const out='docs/ops-r3-1-3/evidence'; await mkdir(out,{recursive:true});const results=[];
async function run(cmd,args,name,extra={}) {let data='';const startedAt=new Date().toISOString();const child=spawn(cmd,args,{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>data+=c);child.stderr.on('data',c=>data+=c);const code=await new Promise((res,rej)=>{child.on('error',rej);child.on('exit',res);});await writeFile(path.join(out,name),data);results.push({command:[cmd,...args].join(' '),log:name,code,startedAt,finishedAt:new Date().toISOString()});await writeFile(path.join(out,'final-verification-results.json'),JSON.stringify(results,null,2));console.log(`${code===0?'PASS':'FAIL'} ${cmd} ${args.join(' ')}`);if(code!==0)throw Error(data.slice(-3000));return data;}
let server;
try {
 await run('npm',['run','build'],'build-final.log');
 await run('npm',['run','lint'],'lint-final.log');
 await run('npm',['run','check:unicode'],'unicode-final.log');
 await run('npx',['--no-install','tsc','--noEmit'],'typecheck-final.log');
 await run('git',['diff','--check'],'diff-check-final.log');
 await run('python3',['scripts/test-ops-r3-1-3-migration.py'],'r313-migration.log');
 const own=await run('npm',['run','test:ops-r3-1-3'],'ops-r3-1-3-final.log');
 const root=own.match(/ISOLATED_FIXTURE=(.+)/)?.[1];if(!root)throw Error('Missing isolated fixture');const info=JSON.parse(await readFile(path.join(root,'fixture.json'),'utf8'));
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,DATABASE_URL:info.databaseUrl,NUAAFA_UPLOAD_DIR:path.join(root,'uploads'),REFEREE_SESSION_SECRET:'r313-final-isolated-http-only-at-least-32-characters',NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});let serverLog='';server.stdout.on('data',c=>serverLog+=c);server.stderr.on('data',c=>serverLog+=c);
 const origin=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('Isolated HTTP server failed');
 await run('npm',['run','test:ops-r3-1-3:http'],'http-r313-final.log',{OPS_R313_ROOT:root,OPS_R313_ORIGIN:origin});server.kill('SIGTERM');server=undefined;await writeFile(path.join(out,'http-server-final.log'),serverLog);
 await run('npx',['--no-install','tsx','scripts/test-ops-r3-1.ts'],'ops-r3-1-final.log');
 await run('npx',['--no-install','tsx','scripts/test-ops-r3-1-1.ts'],'ops-r3-1-1-final.log');
 await run('node',['scripts/test-ops-r3-1-3-regressions.mjs'],'regression-run-final.log');
 await run('npm',['run','test:security-runtime-r2'],'security-runtime-r2-final.log');
 await run('npm',['run','test:security-http'],'security-http-final.log');
 await run('npm',['run','test:unified-admin-blockers:http'],'media-content-blockers-final.log');
 await run('npm',['run','test:unified-admin-blockers:http','--','--cms'],'media-content-http-final.log');
 console.log('PASS all final verification commands');
} finally {server?.kill('SIGTERM');}
