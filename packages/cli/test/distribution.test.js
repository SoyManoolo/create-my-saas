import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '../../..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

test('the published package contains the executable and template catalog', () => {
  const cacheDirectory = mkdtempSync(join(tmpdir(), 'create-my-saas-npm-cache-'));
  let output;
  try {
    output = execFileSync(npmCommand, ['pack', '--json', '--dry-run', '--cache', cacheDirectory], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
  } finally {
    rmSync(cacheDirectory, { recursive: true, force: true });
  }
  const [packageDetails] = JSON.parse(output);
  const packedPaths = new Set(packageDetails.files.map(({ path }) => path));

  assert.equal(packageDetails.name, 'create-my-saas');
  assert.equal(packedPaths.has('packages/cli/bin/create-my-saas.js'), true);
  assert.equal(packedPaths.has('packages/cli/src/catalog.js'), true);
  assert.equal(packedPaths.has('templates/backend/fastapi-starter/template.manifest.json'), true);
  assert.equal(packedPaths.has('templates/backend/nestjs-starter/template.manifest.json'), true);
  assert.equal(packedPaths.has('templates/frontend/nextjs-starter/template.manifest.json'), true);
  assert.equal(packedPaths.has('docs/template-manifests.md'), true);
  assert.equal(
    [...packedPaths].some((path) => /(^|\/)(node_modules|\.next|\.venv|__pycache__|dist)(\/|$)|\.(pyc|tsbuildinfo)$/.test(path)),
    false,
  );
});
