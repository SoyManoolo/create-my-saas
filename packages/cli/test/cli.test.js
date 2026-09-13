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
    { destination: 'demo', backendId: 'nestjs', frontendId: 'nextjs', featureIds: [], list: false, help: false },
  );
});

test('parses equals-style template selections', () => {
  assert.deepEqual(
    parseArguments(['demo', '--backend=fastapi', '--frontend=nextjs']),
    { destination: 'demo', backendId: 'fastapi', frontendId: 'nextjs', featureIds: [], list: false, help: false },
  );
});

test('parses repeatable optional frontend features', () => {
  assert.deepEqual(
    parseArguments(['demo', '--frontend=astro', '--feature', 'billing']),
    { destination: 'demo', backendId: undefined, frontendId: 'astro', featureIds: ['billing'], list: false, help: false },
  );
});

test('lists templates from manifests', () => {
  const output = [];
  const status = run(['--list'], { log: (line) => output.push(line), error: () => {} });

  assert.equal(status, 0);
  assert.match(output.join('\n'), /fastapi/);
  assert.match(output.join('\n'), /nestjs/);
  assert.match(output.join('\n'), /fastify/);
  assert.match(output.join('\n'), /nextjs/);
  assert.match(output.join('\n'), /astro/);
  assert.match(output.join('\n'), /react-router/);
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
  assert.equal(existsSync(join(destination, 'backend', 'Dockerfile')), true);
  assert.equal(existsSync(join(destination, 'frontend', 'Dockerfile')), true);
  assert.equal(existsSync(join(destination, 'deployment', 'compose.yaml')), true);
  assert.equal(existsSync(join(destination, 'deployment', 'compose.dev.yaml')), true);

  const deploymentCompose = readFileSync(join(destination, 'deployment', 'compose.yaml'), 'utf8');
  assert.match(deploymentCompose, /target: migrate/);
  assert.match(deploymentCompose, /gateway/);
  const productionEnvironment = readFileSync(join(destination, 'deployment', '.env.production.example'), 'utf8');
  assert.match(productionEnvironment, /^APP_ENV=production$/m);
  assert.match(productionEnvironment, /^DATABASE_SSL=true$/m);
  assert.match(productionEnvironment, /^REDIS_URL=rediss:\/\//m);

  const frontendEnvironment = readFileSync(join(destination, 'frontend', '.env.example'), 'utf8');
  assert.match(frontendEnvironment, /^API_PROXY_TARGET=http:\/\/localhost:8000$/m);

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

test('generates the Astro frontend without a selected backend', (t) => {
  const workspace = temporaryDirectory();
  const destination = join(workspace, 'marketing-site');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  generateProject({
    destination,
    frontendId: 'astro',
    templatesDirectory: defaultTemplatesDirectory,
  });

  const frontendEnvironment = readFileSync(join(destination, 'frontend', '.env.example'), 'utf8');
  assert.match(frontendEnvironment, /^PUBLIC_SITE_URL=/m);
  assert.match(frontendEnvironment, /^API_PROXY_TARGET=$/m);
  assert.equal(existsSync(join(destination, 'frontend', 'src', 'pages', 'index.astro')), true);
  assert.equal(existsSync(join(destination, 'deployment', 'gateway.Dockerfile')), true);
});

test('configures the React Router API proxy from the selected backend', (t) => {
  const workspace = temporaryDirectory();
  const destination = join(workspace, 'react-router-saas');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  generateProject({
    destination,
    backendId: 'nestjs',
    frontendId: 'react-router',
    templatesDirectory: defaultTemplatesDirectory,
  });

  const frontendEnvironment = readFileSync(join(destination, 'frontend', '.env.example'), 'utf8');
  assert.match(frontendEnvironment, /^API_PROXY_TARGET=http:\/\/localhost:3001$/m);
  assert.equal(existsSync(join(destination, 'frontend', 'app', 'routes', 'login.tsx')), true);
});

test('rejects Fastify for a frontend that requires organizations and Stripe Billing', (t) => {
  const workspace = temporaryDirectory();
  const destination = join(workspace, 'fastify-saas');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  assert.throws(
    () => generateProject({
      destination,
      backendId: 'fastify',
      frontendId: 'react-router',
      templatesDirectory: defaultTemplatesDirectory,
    }),
    /Missing backend capabilities: organizations, billing\.stripe/,
  );
  assert.equal(existsSync(destination), false);
});

test('generates the lightweight authenticated Astro site with Fastify', (t) => {
  const workspace = temporaryDirectory();
  const destination = join(workspace, 'astro-saas');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  generateProject({
    destination,
    backendId: 'fastify',
    frontendId: 'astro',
    templatesDirectory: defaultTemplatesDirectory,
  });

  const frontendEnvironment = readFileSync(join(destination, 'frontend', '.env.example'), 'utf8');
  assert.match(frontendEnvironment, /^API_PROXY_TARGET=http:\/\/localhost:3002$/m);
  assert.equal(existsSync(join(destination, 'backend', 'src', 'server.ts')), true);
  assert.equal(existsSync(join(destination, 'frontend', 'src', 'pages', 'billing', 'index.astro')), false);
  assert.doesNotMatch(readFileSync(join(destination, 'frontend', 'astro.config.mjs'), 'utf8'), /organizations|billing/);
});

test('rejects Astro billing with Fastify before creating output', (t) => {
  const workspace = temporaryDirectory();
  const destination = join(workspace, 'astro-billing-fastify');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  assert.throws(
    () => generateProject({
      destination,
      backendId: 'fastify',
      frontendId: 'astro',
      featureIds: ['billing'],
      templatesDirectory: defaultTemplatesDirectory,
    }),
    /Missing backend capabilities: organizations, billing\.stripe/,
  );
  assert.equal(existsSync(destination), false);
});

test('rejects Astro billing without a backend before creating output', (t) => {
  const workspace = temporaryDirectory();
  const destination = join(workspace, 'astro-billing-static');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  assert.throws(
    () => generateProject({
      destination,
      frontendId: 'astro',
      featureIds: ['billing'],
      templatesDirectory: defaultTemplatesDirectory,
    }),
    /selected frontend features require a backend template/,
  );
  assert.equal(existsSync(destination), false);
});

test('generates Astro billing with NestJS and records the selected feature', (t) => {
  const workspace = temporaryDirectory();
  const destination = join(workspace, 'astro-billing-nest');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  generateProject({
    destination,
    backendId: 'nestjs',
    frontendId: 'astro',
    featureIds: ['billing'],
    templatesDirectory: defaultTemplatesDirectory,
  });

  assert.equal(existsSync(join(destination, 'frontend', 'src', 'pages', 'billing', 'index.astro')), true);
  assert.match(readFileSync(join(destination, 'frontend', 'astro.config.mjs'), 'utf8'), /organizations/);
  assert.match(readFileSync(join(destination, 'frontend', 'astro.config.mjs'), 'utf8'), /billing/);
  const metadata = JSON.parse(readFileSync(join(destination, '.create-my-saas.json'), 'utf8'));
  assert.deepEqual(metadata.features, { frontend: ['billing'] });
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
