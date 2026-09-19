import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultExtensionsDirectory, defaultTemplatesDirectory, loadCatalog } from '../packages/cli/src/catalog.js';
import { extensionTargetFiles } from '../packages/cli/src/extensions.js';

try {
  const catalog = loadCatalog(defaultTemplatesDirectory, [defaultExtensionsDirectory]);
  if (catalog.extensions.length === 0) throw new Error(`No extension.manifest.json files found under ${defaultExtensionsDirectory}.`);
  const templates = new Map([...catalog.backend, ...catalog.frontend].map((template) => [template.id, template]));
  for (const extension of catalog.extensions) {
    for (const target of extension.targets) {
      const template = templates.get(target.template);
      if (!template) throw new Error(`${extension.id} targets unknown template ${target.template}.`);
      const files = new Set(extensionTargetFiles(extension, target).map(({ relativePath }) => relativePath));
      for (const replacement of target.replace) {
        if (!existsSync(join(template.sourceDirectory, replacement))) throw new Error(`${extension.id} replaces missing Community file ${target.template}/${replacement}.`);
        if (!files.has(replacement)) throw new Error(`${extension.id} replacement ${replacement} is not in its overlay.`);
      }
      for (const migration of target.migrations) if (!files.has(migration)) throw new Error(`${extension.id} migration ${migration} is not in its overlay.`);
    }
  }
  console.log(`Validated ${catalog.extensions.length} extension manifest${catalog.extensions.length === 1 ? '' : 's'}.`);
} catch (error) {
  console.error(`Extension manifest validation failed: ${error.message}`);
  process.exitCode = 1;
}
