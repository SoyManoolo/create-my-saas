import { defaultExtensionsDirectory, loadCatalog } from './catalog.js';
import { generateProject } from './generator.js';

const usage = `Usage: create-my-saas <destination> [options]

Options:
  --backend <id>     Backend template to generate
  --frontend <id>    Frontend template to generate
  --feature <id>           Enable an extension (repeatable)
  --extensions-dir <path>  Discover an additional local extension directory (repeatable)
  --list             List available templates
  --help, -h         Show this help

Examples:
  create-my-saas my-saas --backend nestjs --frontend nextjs
  create-my-saas my-saas --backend nestjs --frontend astro --feature billing
  create-my-saas api-only --backend fastapi
`;

function listTemplates(log, catalog = loadCatalog()) {
  log('Available templates:');
  for (const kind of ['backend', 'frontend']) {
    log(`\n${kind}:`);
    for (const template of catalog[kind]) {
      const capabilities = template.capabilities.join(', ');
      log(`  ${template.key} (${template.version}) - ${capabilities}`);
    }
  }
  if (catalog.extensions.length > 0) {
    log('\nextensions:');
    for (const extension of catalog.extensions) {
      log(`  ${extension.id} (${extension.version}) - ${extension.description}`);
    }
  }
}

export function parseArguments(argumentsList) {
  const options = { backendId: undefined, frontendId: undefined, featureIds: [], extensionsDirectories: [], destination: undefined, list: false, help: false };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument.startsWith('--backend=')) {
      options.backendId = argument.slice('--backend='.length);
      if (!options.backendId) {
        throw new Error('Missing value for --backend.');
      }
    } else if (argument.startsWith('--frontend=')) {
      options.frontendId = argument.slice('--frontend='.length);
      if (!options.frontendId) {
        throw new Error('Missing value for --frontend.');
      }
    } else if (argument.startsWith('--feature=')) {
      const featureId = argument.slice('--feature='.length);
      if (!featureId) {
        throw new Error('Missing value for --feature.');
      }
      options.featureIds.push(featureId);
    } else if (argument.startsWith('--extensions-dir=')) {
      const directory = argument.slice('--extensions-dir='.length);
      if (!directory) throw new Error('Missing value for --extensions-dir.');
      options.extensionsDirectories.push(directory);
    } else
    if (argument === '--backend' || argument === '--frontend' || argument === '--feature' || argument === '--extensions-dir') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      if (argument === '--feature') options.featureIds.push(value);
      else if (argument === '--extensions-dir') options.extensionsDirectories.push(value);
      else options[argument === '--backend' ? 'backendId' : 'frontendId'] = value;
      index += 1;
    } else if (argument === '--list') {
      options.list = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!options.destination) {
      options.destination = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }

  return options;
}

export function run(argumentsList, { log = console.log, error = console.error } = {}) {
  try {
    const options = parseArguments(argumentsList);

    if (options.help) {
      log(usage);
      return 0;
    }
    if (options.list) {
      listTemplates(log, loadCatalog(undefined, [defaultExtensionsDirectory, ...options.extensionsDirectories]));
      return 0;
    }
    if (!options.destination) {
      throw new Error('A destination directory is required.');
    }

    const extensionsDirectories = [defaultExtensionsDirectory, ...options.extensionsDirectories];
    const result = generateProject({ ...options, extensionsDirectories });
    log(`Created ${result.outputDirectory}`);
    return 0;
  } catch (caughtError) {
    error(`Error: ${caughtError.message}`);
    error('Run create-my-saas --help for usage.');
    return 1;
  }
}

export function main(argumentsList) {
  process.exitCode = run(argumentsList);
}
