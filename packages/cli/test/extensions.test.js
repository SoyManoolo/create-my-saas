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
  mkdirSync(extensions, { recursive: true });
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

test('merges extension deployment environment separately, once, with comments and secrets', (t) => {
  const { root, templates, extensions } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  addExtension(extensions, 'runtime', extensionManifest('community:runtime', {
    aliases: ['runtime'],
    deploymentEnvironment: [
      { name: 'RELEASE_REGION', value: 'eu-west-1', secret: false, description: 'Region for release jobs.' },
      { name: 'RELEASE_TOKEN', value: '', secret: true, description: 'Token used by release jobs.' },
    ],
    targets: [{ template: 'backend:test', overlay: 'backend', replace: [], environment: [{ name: 'BACKEND_ONLY_TOKEN', value: '', secret: true, description: 'Backend integration token.' }], migrations: [] }],
  }), { 'backend/src/runtime.js': 'export const runtime = true;\n' });
  addExtension(extensions, 'public', extensionManifest('community:public', {
    aliases: ['public'],
    deploymentEnvironment: [{ name: 'RELEASE_REGION', value: 'eu-west-1', secret: false, description: 'Region for release jobs.' }],
    targets: [{ template: 'frontend:test', overlay: 'frontend', replace: [], environment: [{ name: 'NEXT_PUBLIC_RELEASE_CHANNEL', value: 'stable', secret: false, description: 'Public release channel.' }], migrations: [] }],
  }), { 'frontend/src/public.js': 'export const release = true;\n' });

  const destination = join(root, 'generated');
  generateProject({ destination, backendId: 'test', frontendId: 'test', featureIds: ['runtime', 'public'], templatesDirectory: templates, extensionsDirectories: [extensions] });

  const deploymentEnvironment = readFileSync(join(destination, 'deployment', '.env.production.example'), 'utf8');
  assert.match(deploymentEnvironment, /^# Copy this file to \.env\./);
  assert.match(deploymentEnvironment, /# Region for release jobs\.\nRELEASE_REGION=eu-west-1/);
  assert.match(deploymentEnvironment, /# Token used by release jobs\.\nRELEASE_TOKEN=$/m);
  assert.equal((deploymentEnvironment.match(/^RELEASE_REGION=/gm) ?? []).length, 1);
  assert.doesNotMatch(deploymentEnvironment, /BACKEND_ONLY_TOKEN|NEXT_PUBLIC_RELEASE_CHANNEL/);

  const backendEnvironment = readFileSync(join(destination, 'backend', '.env.example'), 'utf8');
  assert.match(backendEnvironment, /# Backend integration token\.\nBACKEND_ONLY_TOKEN=$/m);
  assert.doesNotMatch(backendEnvironment, /RELEASE_REGION|NEXT_PUBLIC_RELEASE_CHANNEL/);

  const frontendEnvironment = readFileSync(join(destination, 'frontend', '.env.example'), 'utf8');
  assert.match(frontendEnvironment, /NEXT_PUBLIC_RELEASE_CHANNEL=stable/);
  assert.doesNotMatch(frontendEnvironment, /RELEASE_REGION|BACKEND_ONLY_TOKEN/);
});

test('keeps the production environment example unchanged without extensions', (t) => {
  const { root, templates, extensions } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const destination = join(root, 'generated');
  generateProject({ destination, backendId: 'test', frontendId: 'test', templatesDirectory: templates, extensionsDirectories: [extensions] });
  assert.equal(readFileSync(join(destination, 'deployment', '.env.production.example'), 'utf8'), `# Copy this file to .env. It is deliberately invalid until every replace-me value and
# every selected email, OAuth, and Stripe setting is configured. Do not commit .env.
BASE_BACKEND=yes

DATABASE_SSL=true
TRUST_PROXY_HEADERS=true
TRUSTED_PROXY_IPS=172.30.0.10
`);
});

test('rejects non-public frontend environment variables', (t) => {
  const { root, extensions } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  addExtension(extensions, 'unsafe-frontend', extensionManifest('community:unsafe-frontend', {
    targets: [{ template: 'frontend:test', overlay: 'frontend', replace: [], environment: [{ name: 'PRIVATE_FRONTEND_TOKEN', value: '', secret: true, description: 'Must not be exposed.' }], migrations: [] }],
  }), { 'frontend/src/unsafe.js': 'export {};\n' });
  assert.throws(() => generateProject({ destination: join(root, 'generated'), backendId: 'test', frontendId: 'test', featureIds: ['community:unsafe-frontend'], templatesDirectory: join(root, 'templates'), extensionsDirectories: [extensions] }), /Invalid extension manifest/);
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
