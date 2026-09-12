import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultTemplatesDirectory } from '../src/catalog.js';
import { parseArguments, run } from '../src/cli.js';
import { generateProject } from '../src/generator.js';

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'create-my-saas-'));
}

test('parses template selections and a destination', () => {
  assert.deepEqual(
    parseArguments(['demo', '--backend', 'nestjs', '--frontend', 'nextjs']),
    { destination: 'demo', backendId: 'nestjs', frontendId: 'nextjs', list: false, help: false },
  );
});

test('parses equals-style template selections', () => {
  assert.deepEqual(
    parseArguments(['demo', '--backend=fastapi', '--frontend=nextjs']),
    { destination: 'demo', backendId: 'fastapi', frontendId: 'nextjs', list: false, help: false },
  );
});

test('lists templates from manifests', () => {
  const output = [];
  const status = run(['--list'], { log: (line) => output.push(line), error: () => {} });

  assert.equal(status, 0);
  assert.match(output.join('\n'), /fastapi/);
  assert.match(output.join('\n'), /nestjs/);
  assert.match(output.join('\n'), /nextjs/);
});

test('generates selected templates and omits local artifacts', (t) => {
  const workspace = temporaryDirectory();
  const destination = join(workspace, 'demo');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  generateProject({
    destination,
    backendId: 'fastapi',
    frontendId: 'nextjs',
    templatesDirectory: defaultTemplatesDirectory,
  });

  assert.equal(existsSync(join(destination, 'backend', 'src')), true);
  assert.equal(existsSync(join(destination, 'frontend', 'app')), true);
  assert.equal(existsSync(join(destination, 'backend', '.venv')), false);
  assert.equal(existsSync(join(destination, 'backend', '__pycache__')), false);
  assert.equal(existsSync(join(destination, 'frontend', 'node_modules')), false);

  const metadata = JSON.parse(readFileSync(join(destination, '.create-my-saas.json'), 'utf8'));
  assert.deepEqual(metadata.templates.backend, {
    id: 'backend:fastapi', version: '0.1.0', source: 'backend/fastapi-starter',
  });
  assert.deepEqual(metadata.templates.frontend, {
    id: 'frontend:nextjs', version: '0.1.0', source: 'frontend/nextjs-starter',
  });
});

test('refuses to overwrite a destination directory', (t) => {
  const workspace = temporaryDirectory();
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  assert.throws(
    () => generateProject({ destination: workspace, backendId: 'nestjs', templatesDirectory: defaultTemplatesDirectory }),
    /Destination already exists/,
  );
});

test('rejects an unknown template without creating output', (t) => {
  const workspace = temporaryDirectory();
  const destination = join(workspace, 'demo');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  assert.throws(
    () => generateProject({ destination, backendId: 'unknown', templatesDirectory: defaultTemplatesDirectory }),
    /Unknown backend template/,
  );
  assert.equal(existsSync(destination), false);
});
