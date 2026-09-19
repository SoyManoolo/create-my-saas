import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const executableClients = [
  'templates/frontend/nextjs-starter/app/lib/api.ts',
  'templates/frontend/react-router-starter/app/lib/api.client.ts',
];
const astroClients = [
  'templates/frontend/astro-starter/src/scripts/auth.ts',
  'extensions/community-astro-billing/overlays/frontend/src/scripts/auth.ts',
];

const modules = await Promise.all(executableClients.map((path) => import(pathToFileURL(resolve(root, path)).href)));
const astroSources = await Promise.all(astroClients.map((path) => readFile(resolve(root, path), 'utf8')));

function astroErrorCatalog(source) {
  const catalog = source.match(/export const API_ERROR_MESSAGES:[^{]+\{([\s\S]*?)\n\};/);
  assert.ok(catalog, 'Astro must export API_ERROR_MESSAGES');
  return Object.fromEntries(
    [...catalog[1].matchAll(/^\s+([A-Z0-9_]+): "([^"]+)",$/gm)].map(([, code, message]) => [code, message]),
  );
}

test('all frontend templates share the Spanish error-code catalog', () => {
  const [reference, ...others] = modules.map(({ API_ERROR_MESSAGES }) => API_ERROR_MESSAGES);
  for (const catalog of others) assert.deepEqual(catalog, reference);
  for (const source of astroSources) assert.deepEqual(astroErrorCatalog(source), reference);
});

test('stable backend codes and unknown failures produce safe Spanish UI copy', () => {
  for (const { apiErrorMessage } of modules) {
    assert.equal(apiErrorMessage('INVALID_CREDENTIALS', 401), 'El correo o la contraseña no son correctos.');
    assert.equal(apiErrorMessage('EMAIL_ALREADY_EXISTS', 409), 'Ya existe una cuenta con este correo electrónico.');
    assert.equal(apiErrorMessage('UNKNOWN_BACKEND_ERROR', 500), 'El servicio no está disponible temporalmente. Inténtalo de nuevo más tarde.');
    assert.equal(apiErrorMessage('UNKNOWN_BACKEND_ERROR', 418), 'La operación no se ha podido completar.');
  }
  for (const source of astroSources) {
    assert.match(source, /if \(code && API_ERROR_MESSAGES\[code\]\) return API_ERROR_MESSAGES\[code\];/);
    assert.match(source, /if \(status === 400 \|\| status === 422\) return "Revisa los datos introducidos e inténtalo de nuevo\.";/);
    assert.match(source, /return "La operación no se ha podido completar\.";/);
  }
});

test('API clients never use backend message fields as UI copy', async () => {
  for (const path of [...executableClients, ...astroClients]) {
    const source = await readFile(resolve(root, path), 'utf8');
    assert.doesNotMatch(source, /error\?\.message|responseBody\.message|result\.message/);
  }
});
