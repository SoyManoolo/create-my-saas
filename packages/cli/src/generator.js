import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { defaultTemplatesDirectory, findTemplate, loadCatalog } from './catalog.js';

const excludedDirectoryNames = new Set([
  '.git',
  '.next',
  '.pnpm-store',
  '.pytest_cache',
  '.ruff_cache',
  '.turbo',
  '.uv-validation-cache',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const excludedFileNames = new Set(['.DS_Store']);

function shouldCopy(source) {
  const entryName = basename(source);

  return !excludedDirectoryNames.has(entryName)
    && !excludedFileNames.has(entryName)
    && !entryName.endsWith('.pyc')
    && !entryName.endsWith('.tsbuildinfo');
}

function copyTemplate(templatesDirectory, destinationDirectory, kind, template) {
  const sourceDirectory = template.sourceDirectory;

  if (!existsSync(sourceDirectory)) {
    throw new Error(`Template source not found: ${sourceDirectory}`);
  }

  cpSync(sourceDirectory, join(destinationDirectory, kind), {
    recursive: true,
    errorOnExist: true,
    filter: shouldCopy,
  });
}

function configureFrontendApiProxyTarget(destinationDirectory, backend) {
  const envExamplePath = join(destinationDirectory, 'frontend', '.env.example');
  if (!existsSync(envExamplePath)) {
    throw new Error(`Frontend template is missing .env.example: ${envExamplePath}`);
  }

  const originalContents = readFileSync(envExamplePath, 'utf8');
  const apiProxyTargetPattern = /^API_PROXY_TARGET=.*$/m;
  if (!apiProxyTargetPattern.test(originalContents)) {
    throw new Error(`Frontend .env.example is missing API_PROXY_TARGET: ${envExamplePath}`);
  }

  const configuredContents = originalContents.replace(
    apiProxyTargetPattern,
    () => `API_PROXY_TARGET=${backend.development.baseUrl}`,
  );
  writeFileSync(envExamplePath, configuredContents, 'utf8');
}

export function generateProject({
  destination,
  backendId,
  frontendId,
  templatesDirectory = defaultTemplatesDirectory,
}) {
  if (!backendId && !frontendId) {
    throw new Error('Select at least one template with --backend or --frontend.');
  }

  const outputDirectory = resolve(destination);

  if (existsSync(outputDirectory)) {
    throw new Error(`Destination already exists: ${outputDirectory}`);
  }

  const catalog = loadCatalog(templatesDirectory);
  const backend = backendId ? findTemplate(catalog, 'backend', backendId) : undefined;
  const frontend = frontendId ? findTemplate(catalog, 'frontend', frontendId) : undefined;

  mkdirSync(outputDirectory, { recursive: true });

  try {
    if (backend) {
      copyTemplate(templatesDirectory, outputDirectory, 'backend', backend);
    }

    if (frontend) {
      copyTemplate(templatesDirectory, outputDirectory, 'frontend', frontend);
    }

    if (backend && frontend) {
      configureFrontendApiProxyTarget(outputDirectory, backend);
    }

    const selectedTemplates = {};
    if (backend) {
      selectedTemplates.backend = {
        id: backend.id,
        version: backend.version,
        source: backend.directory,
      };
    }
    if (frontend) {
      selectedTemplates.frontend = {
        id: frontend.id,
        version: frontend.version,
        source: frontend.directory,
      };
    }

    writeFileSync(
      join(outputDirectory, '.create-my-saas.json'),
      `${JSON.stringify({ schemaVersion: 1, templates: selectedTemplates }, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    throw new Error(`Could not generate project at ${outputDirectory}: ${error.message}`, { cause: error });
  }

  return { outputDirectory, backend, frontend };
}
