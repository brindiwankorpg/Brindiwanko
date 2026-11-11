/**
 * @file Development runner: starts the esbuild watcher for the client and the
 * server under `tsx watch` (restarted on every server/shared change), and stops
 * both together on Ctrl+C.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { config } from '../server/config.js';
import { chooseContentLanguage } from '../server/first-run.js';

const children: ChildProcess[] = [];

// `tsx watch` keeps the keyboard for itself (Enter restarts the server), so the server cannot ask
// the language of a brand-new database from there: it is asked here, once, and handed over.
const contentLanguage = await chooseContentLanguage(config.dbPath);

// tsx is launched through node directly: no shell (avoids DEP0190) and no npx (avoids npm notices).
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

function run(args: string[]): void {
  const child = spawn(process.execPath, [tsxCli, ...args], { stdio: 'inherit', env: { ...process.env, BRINDIWANKO_DEV: '1', ...(contentLanguage ? { CONTENT_LANGUAGE: contentLanguage } : {}) } });
  children.push(child);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[dev] "tsx ${args.join(' ')}" exited with ${code}`);
  });
}

run(['scripts/build-client.ts', '--watch']);
run(['watch', '--clear-screen=false', '--include', 'shared/**/*', 'server/index.ts']);

function stop(): void {
  for (const child of children) child.kill();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
