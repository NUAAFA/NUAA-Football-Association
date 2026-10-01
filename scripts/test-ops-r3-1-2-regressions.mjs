import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const names = [
  'test:competition-import', 'test:competition-import:http',
  'test:unified-admin-r1', 'test:unified-admin-r1-2', 'test:unified-admin-rbac',
  'test:referee-flow', 'test:referee-r1', 'test:referee-r1-3a', 'test:referee-fix2', 'test:referee-fix3', 'test:referee-fix5',
  'test:admin-operations-r2', 'test:admin-operations-r2.1',
  'test:referee-r1-3a:migration:fresh', 'test:unified-admin-migration', 'test:admin-operations-r2:migration',
  'test:security-csv', 'test:security-admission', 'test:security-appointments', 'test:security-api-errors',
  'test:team-directory-r1', 'test:team-directory-r1-1', 'test:public-competition-dynamic', 'test:public-competition-dynamic:http',
  'check:unicode', 'lint'
];
const directory = 'docs/ops-r3-1-2/evidence/regressions';
await mkdir(directory, { recursive: true });
const results = [];
for (const name of names) {
  const startedAt = new Date().toISOString();
  const child = spawn('npm', ['run', name], { env: { ...process.env, TZ: 'Europe/London' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (c) => output += c); child.stderr.on('data', (c) => output += c);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  await writeFile(`${directory}/${name.replaceAll(':', '-')}.log`, output);
  results.push({ command: `npm run ${name}`, code, startedAt, finishedAt: new Date().toISOString() });
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} npm run ${name}`);
  if (code !== 0) console.log(output.slice(-1800));
  await writeFile(`${directory}/results.json`, JSON.stringify(results, null, 2));
}
if (results.some((r) => r.code !== 0)) process.exitCode = 1;
