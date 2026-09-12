import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
export const defaultTemplatesDirectory = join(packageDirectory, '../../../templates');

function readTemplateManifest(templatesDirectory, kind, directoryName) {
  const sourceDirectory = join(templatesDirectory, kind, directoryName);
  const manifestPath = join(sourceDirectory, 'template.manifest.json');

  if (!existsSync(manifestPath)) {
    return undefined;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expectedIdPrefix = `${kind}:`;
  if (
    manifest.schemaVersion !== 1
    || typeof manifest.id !== 'string'
    || !manifest.id.startsWith(expectedIdPrefix)
    || typeof manifest.version !== 'string'
    || manifest.kind !== kind
    || !Array.isArray(manifest.capabilities)
    || (kind === 'backend'
      && (typeof manifest.development?.baseUrl !== 'string' || !manifest.development.baseUrl))
  ) {
    throw new Error(`Invalid template manifest: ${manifestPath}`);
  }

  return {
    ...manifest,
    key: manifest.id.slice(expectedIdPrefix.length),
    directory: relative(templatesDirectory, sourceDirectory).replaceAll('\\', '/'),
    sourceDirectory,
  };
}

function discoverTemplates(templatesDirectory, kind) {
  const categoryDirectory = join(templatesDirectory, kind);
  if (!existsSync(categoryDirectory)) {
    throw new Error(`Template directory not found: ${categoryDirectory}`);
  }

  const templates = readdirSync(categoryDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readTemplateManifest(templatesDirectory, kind, entry.name))
    .filter(Boolean);

  if (templates.length === 0) {
    throw new Error(`No ${kind} templates with template.manifest.json found in ${categoryDirectory}`);
  }

  const duplicateKeys = templates
    .map(({ key }) => key)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    throw new Error(`Duplicate ${kind} template IDs: ${[...new Set(duplicateKeys)].join(', ')}.`);
  }

  return templates;
}

export function loadCatalog(templatesDirectory = defaultTemplatesDirectory) {
  return {
    backend: discoverTemplates(templatesDirectory, 'backend'),
    frontend: discoverTemplates(templatesDirectory, 'frontend'),
  };
}

export function findTemplate(catalog, kind, templateId) {
  const template = catalog[kind].find(({ key }) => key === templateId);

  if (!template) {
    const available = catalog[kind].map(({ key }) => key).join(', ');
    throw new Error(`Unknown ${kind} template "${templateId}". Available: ${available}.`);
  }

  return template;
}
