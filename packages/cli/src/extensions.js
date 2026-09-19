import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const extensionIdPattern = /^(community|pro):[a-z][a-z0-9-]*$/;
const aliasPattern = /^[a-z][a-z0-9-]*$/;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const versionRangePattern = /^(?:[0-9]+\.[0-9]+\.[0-9]+|\^[0-9]+\.[0-9]+\.[0-9]+)$/;
const capabilityPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const environmentPattern = /^[A-Z][A-Z0-9_]*$/;

function isObject(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object';
}

function relativePath(value) {
  return typeof value === 'string' && value.length > 0 && !isAbsolute(value) && !value.includes('\\') && !value.includes(':') && !value.startsWith('/') && !value.split('/').includes('..');
}

function uniqueStrings(values, pattern) {
  return Array.isArray(values) && values.every((value) => typeof value === 'string' && pattern.test(value)) && new Set(values).size === values.length;
}

function validTemplateRequirement(value) {
  return isObject(value) && typeof value.id === 'string' && /^(backend|frontend):[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) && typeof value.version === 'string' && versionRangePattern.test(value.version) && Object.keys(value).every((key) => ['id', 'version'].includes(key));
}

function validEnvironment(value) {
  return isObject(value) && typeof value.name === 'string' && environmentPattern.test(value.name) && typeof value.value === 'string' && typeof value.secret === 'boolean' && typeof value.description === 'string' && value.description.trim() && Object.keys(value).every((key) => ['name', 'value', 'secret', 'description'].includes(key));
}

function validTarget(value) {
  return isObject(value)
    && typeof value.template === 'string'
    && /^(backend|frontend):[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.template)
    && relativePath(value.overlay)
    && uniqueStrings(value.replace, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/)
    && Array.isArray(value.environment) && value.environment.every(validEnvironment)
    && uniqueStrings(value.migrations, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/)
    && new Set(value.environment.map(({ name }) => name)).size === value.environment.length
    && value.environment.every(({ secret, value: environmentValue }) => !secret || environmentValue === '')
    && Object.keys(value).every((key) => ['template', 'overlay', 'replace', 'environment', 'migrations'].includes(key));
}

function invalidManifest(manifestPath) {
  return new Error(`Invalid extension manifest: ${manifestPath}`);
}

export function versionSatisfies(version, range) {
  if (!versionPattern.test(version) || !versionRangePattern.test(range)) return false;
  if (!range.startsWith('^')) return version === range;
  if (version.includes('-')) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  const [requiredMajor, requiredMinor, requiredPatch] = range.slice(1).split('.').map(Number);
  if (major !== requiredMajor) return false;
  if (major === 0 && minor !== requiredMinor) return false;
  if (major === 0 && minor === 0 && patch !== requiredPatch) return false;
  if (minor !== requiredMinor) return minor > requiredMinor;
  return patch >= requiredPatch;
}

function readExtensionManifest(extensionsDirectory, manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const allowed = new Set(['$schema', 'schemaVersion', 'id', 'aliases', 'version', 'displayName', 'description', 'provides', 'requires', 'conflictsWith', 'apiPrefixes', 'supportedStacks', 'targets']);
  if (!isObject(manifest) || Object.keys(manifest).some((key) => !allowed.has(key))
    || manifest.schemaVersion !== 1 || typeof manifest.id !== 'string' || !extensionIdPattern.test(manifest.id)
    || (manifest.aliases !== undefined && !uniqueStrings(manifest.aliases, aliasPattern))
    || typeof manifest.version !== 'string' || !versionPattern.test(manifest.version)
    || typeof manifest.displayName !== 'string' || !manifest.displayName.trim()
    || typeof manifest.description !== 'string' || !manifest.description.trim()
    || !uniqueStrings(manifest.provides, capabilityPattern)
    || !isObject(manifest.requires) || Object.keys(manifest.requires).some((key) => !['cli', 'capabilities', 'extensions'].includes(key))
    || typeof manifest.requires.cli !== 'string' || !versionRangePattern.test(manifest.requires.cli)
    || !uniqueStrings(manifest.requires.capabilities, capabilityPattern)
    || !Array.isArray(manifest.requires.extensions)
    || !manifest.requires.extensions.every((dependency) => isObject(dependency) && extensionIdPattern.test(dependency.id) && versionRangePattern.test(dependency.version) && Object.keys(dependency).every((key) => ['id', 'version'].includes(key)))
    || new Set(manifest.requires.extensions.map(({ id }) => id)).size !== manifest.requires.extensions.length
    || !uniqueStrings(manifest.conflictsWith ?? [], extensionIdPattern)
    || (manifest.apiPrefixes !== undefined && !uniqueStrings(manifest.apiPrefixes, /^[a-z][a-z0-9-]*$/))
    || !Array.isArray(manifest.supportedStacks) || manifest.supportedStacks.length === 0
    || !manifest.supportedStacks.every((stack) => isObject(stack) && Object.keys(stack).every((key) => ['backend', 'frontend'].includes(key)) && Object.keys(stack).length > 0 && (!stack.backend || validTemplateRequirement(stack.backend)) && (!stack.frontend || validTemplateRequirement(stack.frontend)))
    || !Array.isArray(manifest.targets) || manifest.targets.length === 0 || !manifest.targets.every(validTarget)
    || new Set(manifest.targets.map((target) => target.template)).size !== manifest.targets.length
    || manifest.requires.extensions.some(({ id }) => id === manifest.id)
    || (manifest.conflictsWith ?? []).includes(manifest.id)
    || manifest.targets.some((target) => !manifest.supportedStacks.some((stack) => stack.backend?.id === target.template || stack.frontend?.id === target.template))) throw invalidManifest(manifestPath);

  const sourceDirectory = resolve(manifestPath, '..');
  return {
    ...manifest,
    directory: relative(extensionsDirectory, sourceDirectory).replaceAll('\\', '/'),
    sourceDirectory,
  };
}

function findExtensionManifests(directory) {
  if (!existsSync(directory)) throw new Error(`Extension directory not found: ${directory}`);
  const manifests = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) manifests.push(...findExtensionManifests(entryPath));
    if (entry.isFile() && entry.name === 'extension.manifest.json') manifests.push(entryPath);
  }
  return manifests;
}

export function loadExtensions(extensionsDirectory) {
  const extensions = findExtensionManifests(extensionsDirectory).map((path) => readExtensionManifest(extensionsDirectory, path));
  const identifiers = new Set();
  for (const extension of extensions) {
    for (const identifier of [extension.id, ...(extension.aliases ?? [])]) {
      if (identifiers.has(identifier)) throw new Error(`Duplicate extension ID or alias: ${identifier}.`);
      identifiers.add(identifier);
    }
  }
  return extensions;
}

export function selectExtensions(extensions, featureIds) {
  const lookup = new Map();
  for (const extension of extensions) {
    lookup.set(extension.id, extension);
    for (const alias of extension.aliases ?? []) lookup.set(alias, extension);
  }
  const selected = [];
  const selectedIds = new Set();
  for (const featureId of featureIds) {
    const extension = lookup.get(featureId);
    if (!extension) throw new Error(`Unknown extension "${featureId}". Available: ${[...lookup.keys()].join(', ') || 'none'}.`);
    if (selectedIds.has(extension.id)) throw new Error(`Extension "${extension.id}" was selected more than once.`);
    selectedIds.add(extension.id);
    selected.push(extension);
  }
  return selected;
}

function stackMatches(stack, backend, frontend) {
  const templateMatches = (requirement, template) => !requirement || Boolean(template && template.id === requirement.id && versionSatisfies(template.version, requirement.version));
  return templateMatches(stack.backend, backend) && templateMatches(stack.frontend, frontend);
}

export function resolveExtensions(selectedExtensions, { backend, frontend, cliVersion }) {
  const selectedById = new Map(selectedExtensions.map((extension) => [extension.id, extension]));
  const resolved = [];
  const visiting = new Set();
  const resolvedIds = new Set();

  function visit(extension) {
    if (resolvedIds.has(extension.id)) return;
    if (visiting.has(extension.id)) throw new Error(`Extension dependency cycle includes "${extension.id}".`);
    if (!versionSatisfies(cliVersion, extension.requires.cli)) throw new Error(`Extension "${extension.id}" requires CLI ${extension.requires.cli}; current version is ${cliVersion}.`);
    if (!extension.supportedStacks.some((stack) => stackMatches(stack, backend, frontend))) throw new Error(`Extension "${extension.id}" does not support the selected template stack.`);
    visiting.add(extension.id);
    for (const dependency of extension.requires.extensions) {
      const required = selectedById.get(dependency.id);
      if (!required) throw new Error(`Extension "${extension.id}" requires explicit selection of "${dependency.id}".`);
      if (!versionSatisfies(required.version, dependency.version)) throw new Error(`Extension "${extension.id}" requires "${dependency.id}" ${dependency.version}; selected version is ${required.version}.`);
      visit(required);
    }
    visiting.delete(extension.id);
    resolvedIds.add(extension.id);
    resolved.push(extension);
  }

  for (const extension of selectedExtensions) visit(extension);
  const selectedIds = new Set(resolved.map(({ id }) => id));
  for (const extension of resolved) {
    const conflict = extension.conflictsWith.find((id) => selectedIds.has(id));
    if (conflict) throw new Error(`Extension "${extension.id}" conflicts with "${conflict}".`);
  }
  const capabilities = new Set([...(backend?.capabilities ?? []), ...(frontend?.capabilities ?? [])]);
  for (const extension of resolved) {
    const missing = extension.requires.capabilities.filter((capability) => !capabilities.has(capability));
    if (missing.length > 0) throw new Error(`Extension "${extension.id}" is missing required capabilities: ${missing.join(', ')}.`);
    extension.provides.forEach((capability) => capabilities.add(capability));
  }
  return resolved;
}

export function extensionTargetFiles(extension, target) {
  const overlayDirectory = resolve(extension.sourceDirectory, target.overlay);
  const overlayRelative = relative(extension.sourceDirectory, overlayDirectory);
  if (!overlayRelative || isAbsolute(overlayRelative) || overlayRelative === '..' || overlayRelative.startsWith(`..${sep}`) || !existsSync(overlayDirectory)) {
    throw new Error(`Extension overlay not found: ${extension.id}/${target.overlay}.`);
  }
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Extension overlays cannot contain symbolic links: ${extension.id}/${target.overlay}.`);
      if (entry.isDirectory()) visit(entryPath);
      if (entry.isFile()) files.push({ source: entryPath, relativePath: relative(overlayDirectory, entryPath).replaceAll('\\', '/') });
    }
  }
  visit(overlayDirectory);
  return files;
}
