import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = await mkdtemp(path.join(os.tmpdir(), 'nuaafa-ops-regression-'));
const scripts = process.argv.slice(2);
const results = JSON.parse(await readFile('docs/ops-r3-1/evidence/regression-results.json', 'utf8').catch(() => '[]'));
await mkdir('docs/ops-r3-1/evidence', { recursive: true });
for (const name of scripts) {
  const start = new Date();
  const child = spawn('npm', ['run', name], { env: { ...process.env, NUAAFA_UPLOAD_DIR: path.join(root, name.replaceAll(':', '-')), TZ: 'Europe/London' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  await writeFile(`docs/ops-r3-1/evidence/${name.replaceAll(':', '-')}.log`, output);
  results.push({ command: `npm run ${name}`, code, start: start.toISOString(), end: new Date().toISOString() });
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} npm run ${name}`);
  if (code !== 0) console.log(output.slice(-2000));
  await writeFile('docs/ops-r3-1/evidence/regression-results.json', JSON.stringify(results, null, 2));
}
if (results.slice(-scripts.length).some((result) => result.code !== 0)) process.exitCode = 1;
