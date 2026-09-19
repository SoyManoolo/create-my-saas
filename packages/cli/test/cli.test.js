import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultTemplatesDirectory } from '../src/catalog.js';
import { parseArguments, run } from '../src/cli.js';
import { generateProject } from '../src/generator.js';

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'create-my-saas-'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createTestTemplates(workspace, {
  backendEnvironment = true,
  frontendEnvironment = true,
  frontendFeature = true,
} = {}) {
  const templatesDirectory = join(workspace, 'templates');
  const backendDirectory = join(templatesDirectory, 'backend', 'test-backend');
  const frontendDirectory = join(templatesDirectory, 'frontend', 'test-frontend');
  mkdirSync(backendDirectory, { recursive: true });
  mkdirSync(frontendDirectory, { recursive: true });

  writeJson(join(backendDirectory, 'template.manifest.json'), {
    schemaVersion: 1,
    id: 'backend:test-backend',
    kind: 'backend',
    version: '1.0.0',
    displayName: 'Test backend',
    capabilities: ['auth.password'],
    development: { baseUrl: 'http://localhost:8000' },
  });
  writeFileSync(join(backendDirectory, 'server.js'), 'export {};\n', 'utf8');
  if (backendEnvironment) {
    writeFileSync(join(backendDirectory, '.env.example'), 'APP_ENV=development\n', 'utf8');
  }

  writeJson(join(frontendDirectory, 'template.manifest.json'), {
    schemaVersion: 1,
    id: 'frontend:test-frontend',
    kind: 'frontend',
    version: '1.0.0',
    displayName: 'Test frontend',
    capabilities: [],
    compatibility: { requiresBackendCapabilities: ['auth.password'] },
    features: [{
      id: 'optional',
      description: 'Optional test feature',
      capabilities: [],
      requiresBackendCapabilities: [],
    }],
  });
  writeFileSync(join(frontendDirectory, 'app.js'), 'export {};\n', 'utf8');
  if (frontendEnvironment) {
    writeFileSync(join(frontendDirectory, '.env.example'), 'API_PROXY_TARGET=\n', 'utf8');
  }
  if (frontendFeature) {
    const featureDirectory = join(frontendDirectory, '.features', 'optional');
    mkdirSync(featureDirectory, { recursive: true });
    writeFileSync(join(featureDirectory, 'optional.js'), 'export {};\n', 'utf8');
  }

  return templatesDirectory;
}

function assertFailedGenerationIsClean({ workspace, templatesDirectory, generate, error }) {
  const outputParent = join(workspace, 'output');
  const destination = join(outputParent, 'demo');
  const existingSibling = join(outputParent, '.demo-existing');
  mkdirSync(existingSibling, { recursive: true });
  writeFileSync(join(existingSibling, 'keep.txt'), 'keep\n', 'utf8');

  assert.throws(
    () => generateProject({
      destination,
      backendId: 'test-backend',
      frontendId: 'test-frontend',
      templatesDirectory,
      ...generate,
    }),
    error,
  );

  assert.equal(existsSync(destination), false);
  assert.equal(readFileSync(join(existingSibling, 'keep.txt'), 'utf8'), 'keep\n');
  assert.deepEqual(readdirSync(outputParent), ['.demo-existing']);
}

test('parses template selections and a destination', () => {
  assert.deepEqual(
    parseArguments(['demo', '--backend', 'nestjs', '--frontend', 'nextjs']),
    { destination: 'demo', backendId: 'nestjs', frontendId: 'nextjs', featureIds: [], extensionsDirectories: [], list: false, help: false },
  );
});

test('parses equals-style template selections', () => {
  assert.deepEqual(
    parseArguments(['demo', '--backend=fastapi', '--frontend=nextjs']),
    { destination: 'demo', backendId: 'fastapi', frontendId: 'nextjs', featureIds: [], extensionsDirectories: [], list: false, help: false },
  );
});

test('parses repeatable optional frontend features', () => {
  assert.deepEqual(
    parseArguments(['demo', '--frontend=astro', '--feature', 'billing']),
    { destination: 'demo', backendId: undefined, frontendId: 'astro', featureIds: ['billing'], extensionsDirectories: [], list: false, help: false },
  );
});

test('parses explicit local extension directories', () => {
  assert.deepEqual(
    parseArguments(['demo', '--backend', 'fastapi', '--extensions-dir', 'C:/pro/extensions', '--extensions-dir=./extra']),
    { destination: 'demo', backendId: 'fastapi', frontendId: undefined, featureIds: [], extensionsDirectories: ['C:/pro/extensions', './extra'], list: false, help: false },
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
  assert.equal(existsSync(join(destination, 'frontend', 'AGENTS.md')), false);
  assert.equal(existsSync(join(destination, 'frontend', 'CLAUDE.md')), false);
  assert.equal(existsSync(join(destination, 'backend', 'Dockerfile')), true);
  assert.equal(existsSync(join(destination, 'frontend', 'Dockerfile')), true);
  assert.equal(existsSync(join(destination, 'deployment', 'compose.yaml')), true);
  assert.equal(existsSync(join(destination, 'deployment', 'compose.dev.yaml')), true);
  assert.match(readFileSync(join(destination, 'LICENSE'), 'utf8'), /^MIT License$/m);

  const deploymentCompose = readFileSync(join(destination, 'deployment', 'compose.yaml'), 'utf8');
  assert.match(deploymentCompose, /target: migrate/);
  assert.match(deploymentCompose, /gateway/);
  assert.match(deploymentCompose, /healthcheck:[\s\S]*\/ready/);
  assert.match(deploymentCompose, /api:\n\s+condition: service_healthy/);
  const gateway = readFileSync(join(destination, 'deployment', 'nginx.conf'), 'utf8');
  assert.match(gateway, /location = \/health/);
  assert.match(gateway, /location = \/ready[\s\S]*proxy_pass http:\/\/api:8000/);
  const deploymentGuide = readFileSync(join(destination, 'deployment', 'README.md'), 'utf8');
  assert.match(deploymentGuide, /app\.example\.com\/ready/);
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
  assert.deepEqual(readdirSync(workspace), ['demo']);
});

test('refuses to overwrite a destination directory', (t) => {
  const workspace = temporaryDirectory();
  const sentinel = join(workspace, 'keep.txt');
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(sentinel, 'keep\n', 'utf8');

  assert.throws(
    () => generateProject({ destination: workspace, backendId: 'nestjs', templatesDirectory: defaultTemplatesDirectory }),
    /Destination already exists/,
  );
  assert.equal(readFileSync(sentinel, 'utf8'), 'keep\n');
});

test('removes its temporary project when backend configuration fails', (t) => {
  const workspace = temporaryDirectory();
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const templatesDirectory = createTestTemplates(workspace, { backendEnvironment: false });

  assertFailedGenerationIsClean({
    workspace,
    templatesDirectory,
    error: /Could not generate project.*\.env\.example/,
  });
});

test('removes its temporary project when frontend configuration fails', (t) => {
  const workspace = temporaryDirectory();
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const templatesDirectory = createTestTemplates(workspace, { frontendEnvironment: false });

  assertFailedGenerationIsClean({
    workspace,
    templatesDirectory,
    error: /Frontend template is missing \.env\.example/,
  });
});

test('rejects an unknown extension without creating output', (t) => {
  const workspace = temporaryDirectory();
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const templatesDirectory = createTestTemplates(workspace, { frontendFeature: false });

  assertFailedGenerationIsClean({
    workspace,
    templatesDirectory,
    generate: { featureIds: ['optional'] },
    error: /Unknown extension "optional"/,
  });
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
  const deploymentCompose = readFileSync(join(destination, 'deployment', 'compose.yaml'), 'utf8');
  assert.match(deploymentCompose, /fetch\('http:\/\/127\.0\.0\.1:8000\/ready'\)/);
  assert.match(deploymentCompose, /api:\n\s+condition: service_healthy/);
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
  const deploymentCompose = readFileSync(join(destination, 'deployment', 'compose.yaml'), 'utf8');
  assert.match(deploymentCompose, /fetch\('http:\/\/127\.0\.0\.1:8000\/ready'\)/);
  assert.match(readFileSync(join(destination, 'deployment', 'nginx.conf'), 'utf8'), /location = \/ready/);
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
    /does not support the selected template stack/,
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
    /does not support the selected template stack/,
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
  assert.equal(metadata.schemaVersion, 2);
  assert.deepEqual(metadata.extensions, [{
    id: 'community:astro-billing', version: '1.0.0', source: 'community-astro-billing', manifestSchemaVersion: 1,
  }]);
  assert.match(readFileSync(join(destination, 'frontend', '.env.example'), 'utf8'), /^PUBLIC_POSTHOG_KEY=$/m);
  const billingLayout = readFileSync(join(destination, 'frontend', 'src', 'layouts', 'BaseLayout.astro'), 'utf8');
  assert.match(billingLayout, /noindex\?: boolean/);
  assert.match(billingLayout, /initializePostHog/);
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
