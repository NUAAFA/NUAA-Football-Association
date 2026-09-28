import { spawn } from 'node:child_process';
import { readFile, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Explicitly bound to the disposable environment prepared for this task.
const fixture = JSON.parse(await readFile('docs/ops-r3-1/evidence/acceptance-environment.json', 'utf8'));
const root = await realpath(fixture.root);
const temporaryRoot = await realpath(os.tmpdir());
if (path.dirname(root) !== temporaryRoot || !path.basename(root).startsWith('nuaafa-ops-acceptance-')) throw new Error('Refusing a database outside the isolated OPS acceptance directory.');
const envFile = JSON.parse(await readFile(path.join(root, 'environment.json'), 'utf8'));
const databasePath = fixture.databasePath, uploadRoot = fixture.uploadRoot;
if (await realpath(databasePath) !== path.join(root, 'smoke.db') || await realpath(uploadRoot) !== path.join(root, 'uploads') || envFile.DATABASE_URL !== `file:${databasePath}` || envFile.NUAAFA_UPLOAD_DIR !== uploadRoot) throw new Error('Isolated environment paths do not agree.');
await access(databasePath);
const environment = { ...process.env };
// Do not inherit a real legacy administrator hash through .env.local.
environment.REFEREE_ADMIN_PASSWORD_HASH = "ops-isolated-legacy-login-disabled";
for (const key of ['DATABASE_URL', 'NUAAFA_UPLOAD_DIR', 'NUAAFA_CONTENT_SOURCE', 'REFEREE_ADMIN_SESSION_SECRET', 'REFEREE_MEMBER_SESSION_SECRET']) {
  if (typeof envFile[key] !== 'string' || !envFile[key]) throw new Error(`Missing isolated setting: ${key}`);
  environment[key] = envFile[key];
}
const build = process.argv.includes('--build'), dev = process.argv.includes('--dev');
environment.NODE_ENV = dev ? 'development' : 'production';
const args = build ? ['build'] : [dev ? 'dev' : 'start', '-H', '127.0.0.1', '-p', dev ? '3188' : '3187'];
console.log(`${build ? 'Building' : 'Starting'} with isolated OPS database and uploads.`);
const child = build ? spawn('npm', ['run', 'build'], { env: environment, stdio: 'inherit' }) : spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), ...args], { env: environment, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
