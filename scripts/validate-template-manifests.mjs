import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const templatesRoot = resolve(root, 'templates');
const idPattern = /^(backend|frontend):[a-z0-9]+(?:-[a-z0-9]+)*$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const capabilityPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const environmentPattern = /^[A-Z][A-Z0-9_]*$/;
const allowedTopLevelFields = new Set([
  '$schema', 'schemaVersion', 'id', 'version', 'kind', 'displayName', 'description', 'runtime', 'capabilities', 'development', 'environment',
]);
const allowedRuntimeFields = new Set(['language', 'version', 'packageManager']);
const allowedDevelopmentFields = new Set(['port', 'baseUrl']);
const allowedEnvironmentFields = new Set(['required']);
const allowedVariableFields = new Set(['name', 'secret', 'description']);

const failures = [];
const manifests = [];

function fail(file, message) {
  failures.push(`${relative(root, file)}: ${message}`);
}

function hasOnlyKeys(file, value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(file, `${label} contains unsupported field "${key}".`);
  }
}

async function findManifests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findManifests(path));
    if (entry.isFile() && entry.name === 'template.manifest.json') files.push(path);
  }
  return files;
}

function validateManifest(file, manifest) {
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') {
    fail(file, 'must contain a JSON object.');
    return;
  }
  hasOnlyKeys(file, manifest, allowedTopLevelFields, 'manifest');
  if (manifest.schemaVersion !== 1) fail(file, 'schemaVersion must be 1.');
  if (typeof manifest.id !== 'string' || !idPattern.test(manifest.id)) fail(file, 'id must use the form <kind>:<kebab-case-slug>.');
  if (typeof manifest.version !== 'string' || !versionPattern.test(manifest.version)) fail(file, 'version must use semantic versioning (for example, 1.0.0).');
  if (!['backend', 'frontend'].includes(manifest.kind)) fail(file, 'kind must be "backend" or "frontend".');
  if (typeof manifest.id === 'string' && typeof manifest.kind === 'string' && !manifest.id.startsWith(`${manifest.kind}:`)) fail(file, 'id prefix must match kind.');
  for (const field of ['displayName', 'description']) if (typeof manifest[field] !== 'string' || !manifest[field].trim()) fail(file, `${field} must be a non-empty string.`);

  if (!manifest.runtime || Array.isArray(manifest.runtime) || typeof manifest.runtime !== 'object') {
    fail(file, 'runtime must be an object.');
  } else {
    hasOnlyKeys(file, manifest.runtime, allowedRuntimeFields, 'runtime');
    for (const field of ['language', 'packageManager']) if (typeof manifest.runtime[field] !== 'string' || !manifest.runtime[field].trim()) fail(file, `runtime.${field} must be a non-empty string.`);
    if ('version' in manifest.runtime && (typeof manifest.runtime.version !== 'string' || !manifest.runtime.version.trim())) fail(file, 'runtime.version must be a non-empty string when set.');
  }

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    fail(file, 'capabilities must be a non-empty array.');
  } else {
    const capabilities = new Set();
    for (const capability of manifest.capabilities) {
      if (typeof capability !== 'string' || !capabilityPattern.test(capability)) fail(file, 'capabilities must use dot-separated lowercase identifiers.');
      if (capabilities.has(capability)) fail(file, `capabilities contains duplicate "${capability}".`);
      capabilities.add(capability);
    }
  }

  if (manifest.kind === 'backend' && !manifest.development) fail(file, 'backend templates must declare development settings.');
  if (manifest.development !== undefined) {
    if (!manifest.development || Array.isArray(manifest.development) || typeof manifest.development !== 'object') {
      fail(file, 'development must be an object.');
    } else {
      hasOnlyKeys(file, manifest.development, allowedDevelopmentFields, 'development');
      if (!Number.isInteger(manifest.development.port) || manifest.development.port < 1 || manifest.development.port > 65535) fail(file, 'development.port must be a valid TCP port.');
      if (typeof manifest.development.baseUrl !== 'string' || !/^https?:\/\/[^/]+(?:\/.*)?$/.test(manifest.development.baseUrl)) fail(file, 'development.baseUrl must be an absolute HTTP(S) URL.');
    }
  }

  if (!manifest.environment || Array.isArray(manifest.environment) || typeof manifest.environment !== 'object') {
    fail(file, 'environment must be an object.');
    return;
  }
  hasOnlyKeys(file, manifest.environment, allowedEnvironmentFields, 'environment');
  if (!Array.isArray(manifest.environment.required)) {
    fail(file, 'environment.required must be an array.');
    return;
  }
  const names = new Set();
  for (const variable of manifest.environment.required) {
    if (!variable || Array.isArray(variable) || typeof variable !== 'object') {
      fail(file, 'environment.required entries must be objects.');
      continue;
    }
    hasOnlyKeys(file, variable, allowedVariableFields, 'environment.required entry');
    if (typeof variable.name !== 'string' || !environmentPattern.test(variable.name)) fail(file, 'environment variable names must be uppercase snake case.');
    if (typeof variable.secret !== 'boolean') fail(file, 'environment variable secret must be boolean.');
    if (typeof variable.description !== 'string' || !variable.description.trim()) fail(file, 'environment variable description must be non-empty.');
    if (names.has(variable.name)) fail(file, `environment.required contains duplicate "${variable.name}".`);
    names.add(variable.name);
  }

  const expectedKind = relative(templatesRoot, file).split(sep)[0];
  if (manifest.kind !== expectedKind) fail(file, `kind must match its templates/${expectedKind}/ directory.`);
}

const files = await findManifests(templatesRoot);
if (files.length === 0) failures.push('No template.manifest.json files found under templates/.');
for (const file of files) {
  try {
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    validateManifest(file, manifest);
    manifests.push({ file, id: manifest.id });
  } catch (error) {
    fail(file, `could not parse JSON (${error.message}).`);
  }
}
const ids = new Set();
for (const manifest of manifests) {
  if (ids.has(manifest.id)) fail(manifest.file, `id "${manifest.id}" must be unique.`);
  ids.add(manifest.id);
}

if (failures.length) {
  console.error(`Template manifest validation failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} template manifest${files.length === 1 ? '' : 's'}.`);
}
