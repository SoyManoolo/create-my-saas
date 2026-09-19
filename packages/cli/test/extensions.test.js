import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateProject } from '../src/generator.js';
import { versionSatisfies } from '../src/extensions.js';

function workspace() { return mkdtempSync(join(tmpdir(), 'create-my-saas-extension-')); }
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

function extensionManifest(id, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    version: '1.0.0',
    displayName: id,
    description: 'Test extension.',
    provides: [],
    requires: { cli: '^0.1.0', capabilities: [], extensions: [] },
    conflictsWith: [],
    supportedStacks: [{ backend: { id: 'backend:test', version: '^1.0.0' }, frontend: { id: 'frontend:test', version: '^1.0.0' } }],
    targets: [],
    ...overrides,
  };
}

function fixture() {
  const root = workspace();
  const templates = join(root, 'templates');
  const extensions = join(root, 'extensions');
  const backend = join(templates, 'backend', 'test');
  const frontend = join(templates, 'frontend', 'test');
  mkdirSync(backend, { recursive: true });
  mkdirSync(frontend, { recursive: true });
  writeJson(join(backend, 'template.manifest.json'), { schemaVersion: 1, id: 'backend:test', kind: 'backend', version: '1.0.0', displayName: 'Test backend', description: 'Test.', runtime: { language: 'node', packageManager: 'npm' }, capabilities: ['auth.password'], development: { port: 8000, baseUrl: 'http://localhost:8000' }, environment: { required: [] } });
  writeFileSync(join(backend, '.env.example'), 'BASE_BACKEND=yes\n');
  writeFileSync(join(backend, 'server.js'), 'export const base = true;\n');
  writeJson(join(frontend, 'template.manifest.json'), { schemaVersion: 1, id: 'frontend:test', kind: 'frontend', version: '1.0.0', displayName: 'Test frontend', description: 'Test.', runtime: { language: 'node', packageManager: 'npm' }, capabilities: [], compatibility: { requiresBackendCapabilities: ['auth.password'] }, environment: { required: [] } });
  writeFileSync(join(frontend, '.env.example'), 'API_PROXY_TARGET=\nKEEP_ME=yes\n');
  writeFileSync(join(frontend, 'app.js'), 'export const app = true;\n');
  return { root, templates, extensions };
}

function addExtension(extensions, directory, manifest, files = {}) {
  const source = join(extensions, directory);
  mkdirSync(source, { recursive: true });
  writeJson(join(source, 'extension.manifest.json'), manifest);
  for (const [path, contents] of Object.entries(files)) {
    const output = join(source, path);
    mkdirSync(join(output, '..'), { recursive: true });
    writeFileSync(output, contents);
  }
}

test('matches only documented extension version constraints', () => {
  assert.equal(versionSatisfies('1.2.3', '1.2.3'), true);
  assert.equal(versionSatisfies('1.2.4', '^1.2.3'), true);
  assert.equal(versionSatisfies('1.3.0', '^1.2.3'), true);
  assert.equal(versionSatisfies('2.0.0', '^1.2.3'), false);
  assert.equal(versionSatisfies('1.2.2', '^1.2.3'), false);
  assert.equal(versionSatisfies('0.1.4', '^0.1.3'), true);
  assert.equal(versionSatisfies('0.2.0', '^0.1.3'), false);
  assert.equal(versionSatisfies('1.2.4-beta.1', '^1.2.3'), false);
});

test('installs ordered backend and frontend extension overlays and records exact metadata', (t) => {
  const { root, templates, extensions } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  addExtension(extensions, 'base', extensionManifest('community:base', {
    aliases: ['base'], provides: ['feature.base'],
    targets: [{ template: 'backend:test', overlay: 'backend', replace: [], environment: [{ name: 'BASE_FEATURE_KEY', value: 'enabled', secret: false, description: 'Enables the base extension.' }], migrations: ['migrations/001-base.sql'] }],
  }), { 'backend/src/base.js': 'export const extension = true;\n', 'backend/migrations/001-base.sql': '-- base migration\n' });
  addExtension(extensions, 'addon', extensionManifest('community:addon', {
    aliases: ['addon'], provides: ['feature.addon'], apiPrefixes: ['addon-api'],
    requires: { cli: '^0.1.0', capabilities: ['feature.base'], extensions: [{ id: 'community:base', version: '^1.0.0' }] },
    targets: [{ template: 'frontend:test', overlay: 'frontend', replace: [], environment: [], migrations: [] }],
  }), { 'frontend/src/addon.js': 'export const addon = true;\n' });

  const destination = join(root, 'generated');
  generateProject({ destination, backendId: 'test', frontendId: 'test', featureIds: ['addon', 'base'], templatesDirectory: templates, extensionsDirectories: [extensions] });
  assert.equal(existsSync(join(destination, 'backend', 'src', 'base.js')), true);
  assert.equal(existsSync(join(destination, 'backend', 'migrations', '001-base.sql')), true);
  assert.equal(existsSync(join(destination, 'frontend', 'src', 'addon.js')), true);
  assert.match(readFileSync(join(destination, 'backend', '.env.example'), 'utf8'), /^BASE_FEATURE_KEY=enabled$/m);
  assert.match(readFileSync(join(destination, 'frontend', '.env.example'), 'utf8'), /^KEEP_ME=yes$/m);
  assert.match(readFileSync(join(destination, 'deployment', 'nginx.conf'), 'utf8'), /\(auth\|users\|addon-api\)/);
  const metadata = JSON.parse(readFileSync(join(destination, '.create-my-saas.json'), 'utf8'));
  assert.deepEqual(metadata.extensions.map(({ id }) => id), ['community:base', 'community:addon']);
  assert.equal(metadata.extensions[0].version, '1.0.0');
});

test('rejects an undeclared Community-file replacement before creating output', (t) => {
  const { root, templates, extensions } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  addExtension(extensions, 'unsafe', extensionManifest('community:unsafe', {
    targets: [{ template: 'backend:test', overlay: 'backend', replace: [], environment: [], migrations: [] }],
  }), { 'backend/server.js': 'export const altered = true;\n' });
  const destination = join(root, 'generated');
  assert.throws(() => generateProject({ destination, backendId: 'test', frontendId: 'test', featureIds: ['community:unsafe'], templatesDirectory: templates, extensionsDirectories: [extensions] }), /without declaring it/);
  assert.equal(existsSync(destination), false);
});

test('rejects missing explicit dependencies and colliding extension files before creating output', (t) => {
  const { root, templates, extensions } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  addExtension(extensions, 'dependent', extensionManifest('community:dependent', {
    requires: { cli: '^0.1.0', capabilities: [], extensions: [{ id: 'community:missing', version: '^1.0.0' }] }, targets: [{ template: 'backend:test', overlay: 'backend', replace: [], environment: [], migrations: [] }],
  }), { 'backend/src/dependent.js': 'export {};\n' });
  const missingDestination = join(root, 'missing');
  assert.throws(() => generateProject({ destination: missingDestination, backendId: 'test', frontendId: 'test', featureIds: ['community:dependent'], templatesDirectory: templates, extensionsDirectories: [extensions] }), /requires explicit selection/);
  assert.equal(existsSync(missingDestination), false);

  addExtension(extensions, 'one', extensionManifest('community:one', { targets: [{ template: 'backend:test', overlay: 'backend', replace: [], environment: [], migrations: [] }] }), { 'backend/src/shared.js': 'one\n' });
  addExtension(extensions, 'two', extensionManifest('community:two', { targets: [{ template: 'backend:test', overlay: 'backend', replace: [], environment: [], migrations: [] }] }), { 'backend/src/shared.js': 'two\n' });
  const collisionDestination = join(root, 'collision');
  assert.throws(() => generateProject({ destination: collisionDestination, backendId: 'test', frontendId: 'test', featureIds: ['community:one', 'community:two'], templatesDirectory: templates, extensionsDirectories: [extensions] }), /both write/);
  assert.equal(existsSync(collisionDestination), false);
});
