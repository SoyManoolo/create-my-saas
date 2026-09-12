import { loadCatalog } from './catalog.js';
import { generateProject } from './generator.js';

const usage = `Usage: create-my-saas <destination> [options]

Options:
  --backend <id>     Backend template to generate
  --frontend <id>    Frontend template to generate
  --list             List available templates
  --help, -h         Show this help

Examples:
  create-my-saas my-saas --backend nestjs --frontend nextjs
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
}

export function parseArguments(argumentsList) {
  const options = { backendId: undefined, frontendId: undefined, destination: undefined, list: false, help: false };

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
    } else
    if (argument === '--backend' || argument === '--frontend') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      options[argument === '--backend' ? 'backendId' : 'frontendId'] = value;
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
      listTemplates(log);
      return 0;
    }
    if (!options.destination) {
      throw new Error('A destination directory is required.');
    }

    const result = generateProject(options);
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
