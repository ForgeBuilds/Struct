import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = '2ce0f4fefce75bfe133a23f5a34d5fd2e6f707d4';
const archiveUrl = `https://codeload.github.com/tashfeenahmed/freellmapi/tar.gz/${commit}`;
const sourceRoot = path.join(root, 'electron/freellmapi-build-src');
const runtimeRoot = path.join(root, 'electron/freellmapi-runtime');
const licensePath = path.join(root, 'licenses/freellmapi-MIT.txt');
const dbFactoryPath = path.join(sourceRoot, 'server/src/db/index.ts');
const upstreamFactory = "return platform === 'android' ? nodeSqliteFactory : betterSqliteFactory;";
const electronFactory = `return platform === 'android' || process.env.FREEAPI_USE_NODE_SQLITE === '1'
    ? nodeSqliteFactory
    : betterSqliteFactory;`;

function runNodeScript(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(script)} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

async function downloadSource(workDir) {
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download FreeLLMAPI source (${response.status} ${response.statusText}).`);
  }
  const archivePath = path.join(workDir, 'freellmapi.tar.gz');
  await pipeline(response.body, createWriteStream(archivePath, { flags: 'wx' }));
  await tar.x({ file: archivePath, cwd: sourceRoot, strip: 1 });
}

async function linkSharedTypes(workspace) {
  const namespaceDir = path.join(sourceRoot, workspace, 'node_modules/@freellmapi');
  await mkdir(namespaceDir, { recursive: true });
  await symlink(path.join(sourceRoot, 'shared'), path.join(namespaceDir, 'shared'), 'junction');
}

async function outputExists() {
  try {
    const [marker, serverEntry, dashboardEntry] = await Promise.all([
      readFile(path.join(runtimeRoot, 'source-commit'), 'utf8'),
      access(path.join(runtimeRoot, 'server/dist/index.js')),
      access(path.join(runtimeRoot, 'client/index.html')),
    ]);
    return marker.trim() === commit && serverEntry === undefined && dashboardEntry === undefined;
  } catch {
    return false;
  }
}

async function build() {
  if (await outputExists() && process.env.FORCE_FREELLMAPI_BUILD !== '1') {
    await copyFile(licensePath, path.join(runtimeRoot, 'LICENSE'));
    console.log(`[FreeLLMAPI] Reusing runtime built from ${commit.slice(0, 7)}.`);
    return;
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), 'struct-freellmapi-'));
  try {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(runtimeRoot, { recursive: true, force: true });
    await mkdir(sourceRoot, { recursive: true });
    console.log(`[FreeLLMAPI] Downloading pinned upstream source ${commit.slice(0, 7)}.`);
    await downloadSource(workDir);
    await Promise.all(['server', 'client'].map(linkSharedTypes));

    const dbFactory = await readFile(dbFactoryPath, 'utf8');
    if (!dbFactory.includes(upstreamFactory)) {
      throw new Error('FreeLLMAPI SQLite factory changed; review its desktop runtime before updating the source pin.');
    }
    await writeFile(dbFactoryPath, dbFactory.replace(upstreamFactory, electronFactory));
    const tsconfigPath = path.join(sourceRoot, 'server/tsconfig.json');
    const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8'));
    tsconfig.exclude = [...new Set([...(tsconfig.exclude ?? []), 'src/scripts/**/*'])];
    await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

    const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
    const serverSource = path.join(sourceRoot, 'server');
    runNodeScript(tsc, ['-p', 'tsconfig.json'], serverSource);
    runNodeScript(
      path.join(root, 'node_modules/typescript/bin/tsc'),
      ['--noEmit', '-p', 'client/tsconfig.app.json'],
      sourceRoot,
    );
    runNodeScript(
      path.join(root, 'node_modules/vite/bin/vite.js'),
      ['build', '--config', 'client/vite.config.ts', 'client'],
      sourceRoot,
    );

    await mkdir(path.join(runtimeRoot, 'server'), { recursive: true });
    await cpDirectory(path.join(sourceRoot, 'server/dist'), path.join(runtimeRoot, 'server/dist'));
    await cpDirectory(path.join(sourceRoot, 'client/dist'), path.join(runtimeRoot, 'client'));
    await copyFile(licensePath, path.join(runtimeRoot, 'LICENSE'));
    await writeFile(path.join(runtimeRoot, 'source-commit'), `${commit}\n`);
    console.log('[FreeLLMAPI] Embedded router and dashboard built.');
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}

async function cpDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await cpDirectory(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

build().catch((error) => {
  console.error('[FreeLLMAPI] Build failed:', error);
  process.exitCode = 1;
});
