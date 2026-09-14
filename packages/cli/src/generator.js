import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
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
  '.features',
  'node_modules',
]);

const excludedFileNames = new Set(['.DS_Store', 'AGENTS.md', 'CLAUDE.md']);

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

function selectFrontendFeatures(frontend, featureIds) {
  if (featureIds.length > 0 && !frontend) {
    throw new Error('Optional features require a frontend template.');
  }

  const availableFeatures = new Map((frontend?.features ?? []).map((feature) => [feature.id, feature]));
  const selectedFeatures = [];
  const selectedIds = new Set();

  for (const featureId of featureIds) {
    if (selectedIds.has(featureId)) throw new Error(`Feature "${featureId}" was selected more than once.`);
    const feature = availableFeatures.get(featureId);
    if (!feature) throw new Error(`Unknown optional feature "${featureId}" for frontend "${frontend.key}".`);
    selectedIds.add(featureId);
    selectedFeatures.push(feature);
  }

  return selectedFeatures;
}

function copyFrontendFeatures(destinationDirectory, frontend, features) {
  const frontendDirectory = join(destinationDirectory, 'frontend');
  for (const feature of features) {
    const sourceDirectory = join(frontend.sourceDirectory, '.features', feature.id);
    if (!existsSync(sourceDirectory)) {
      throw new Error(`Frontend feature source not found: ${sourceDirectory}`);
    }
    for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
      cpSync(join(sourceDirectory, entry.name), join(frontendDirectory, entry.name), { recursive: true, force: true });
    }
  }
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

function frontendApiPrefixes(frontend, features = []) {
  const requiredCapabilities = [
    ...(frontend?.compatibility?.requiresBackendCapabilities ?? []),
    ...features.flatMap((feature) => feature.requiresBackendCapabilities),
  ];
  const prefixes = ['auth', 'users'];
  if (requiredCapabilities.includes('organizations')) prefixes.push('organizations');
  if (requiredCapabilities.includes('billing.stripe')) prefixes.push('billing');
  return prefixes;
}

function backendDatabaseUrl(backend) {
  return backend.key === 'fastapi'
    ? 'postgresql+asyncpg://app:replace-me@postgres.example.com:5432/app'
    : 'postgresql://app:replace-me@postgres.example.com:5432/app';
}

function backendReadinessHealthcheck(backend) {
  const command = backend.key === 'fastapi'
    ? ['CMD', 'python', '-c', "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=1)"]
    : ['CMD', 'node', '-e', "fetch('http://127.0.0.1:8000/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"];
  return JSON.stringify(command);
}

function frontendBuildArguments(frontend) {
  if (frontend.key === 'nextjs') return '      args:\n        API_PROXY_TARGET: http://api:8000\n';
  if (frontend.key === 'astro') return '      args:\n        PUBLIC_SITE_URL: ${FRONTEND_URL}\n        PUBLIC_API_BASE_URL: ""\n';
  return '';
}

function deploymentCompose(backend, frontend) {
  const services = [];
  if (backend) {
    services.push(`  api:
    build:
      context: ../backend
      target: runtime
    env_file:
      - .env
    environment:
      PORT: "8000"
    expose:
      - "8000"
    healthcheck:
      test: ${backendReadinessHealthcheck(backend)}
      interval: 5s
      timeout: 2s
      retries: 12
      start_period: 10s
    networks:
      private:
        ipv4_address: ${'${API_IP:-172.30.0.30}'}
    restart: unless-stopped

  migrate:
    build:
      context: ../backend
      target: migrate
    env_file:
      - .env
    environment:
      PORT: "8000"
    profiles: ["migrate"]
    networks:
      private:
        ipv4_address: ${'${MIGRATE_IP:-172.30.0.31}'}`);
  }
  if (frontend) {
    services.push(`  frontend:
    build:
      context: ../frontend
      target: runtime
${frontendBuildArguments(frontend)}    environment:
      PORT: "3000"
    expose:
      - "3000"
    networks:
      private:
        ipv4_address: ${'${FRONTEND_IP:-172.30.0.20}'}
    restart: unless-stopped`);

    services.push(`  gateway:
    build:
      context: .
      dockerfile: gateway.Dockerfile
    depends_on:
      frontend:
        condition: service_started${backend ? '\n      api:\n        condition: service_healthy' : ''}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./certs:/etc/nginx/certs:ro
    profiles: ["production"]
    networks:
      private:
        ipv4_address: ${'${GATEWAY_IP:-172.30.0.10}'}
    restart: unless-stopped`);
  } else if (backend) {
    services[0] = `${services[0]}\n    ports:\n      - "${'${API_BIND_ADDRESS:-127.0.0.1}'}:${'${API_PORT:-8000}'}:8000"`;
  }

  return `name: create-my-saas

services:
${services.join('\n\n')}

networks:
  private:
    ipam:
      config:
        - subnet: ${'${DEPLOYMENT_SUBNET:-172.30.0.0/24}'}
`;
}

function developmentCompose(backend, frontend) {
  const services = [];
  if (backend) {
    const databaseUrl = backend.key === 'fastapi'
      ? 'postgresql+asyncpg://postgres:postgres@postgres:5432/app'
      : 'postgresql://postgres:postgres@postgres:5432/app';
    services.push(`  postgres:
    image: postgres:17.4-bookworm
    environment:
      POSTGRES_DB: app
      POSTGRES_PASSWORD: postgres
      POSTGRES_USER: postgres
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d app"]
      interval: 5s
      timeout: 5s
      retries: 20
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks: [private]

  redis:
    image: redis:7.4.2-bookworm
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis-data:/data
    networks: [private]

  api:
    environment:
      APP_ENV: development
      DATABASE_URL: ${databaseUrl}
      DATABASE_SSL: "false"
      REDIS_URL: redis://redis:6379
      FRONTEND_URL: http://localhost:3000
      CORS_ORIGINS: http://localhost:3000
      COOKIE_SECURE: "false"
      TRUST_PROXY_HEADERS: "false"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    ports:
      - "127.0.0.1:${'${API_PORT:-8000}'}:8000"

  migrate:
    environment:
      APP_ENV: development
      DATABASE_URL: ${databaseUrl}
      DATABASE_SSL: "false"
      REDIS_URL: redis://redis:6379
      FRONTEND_URL: http://localhost:3000
      CORS_ORIGINS: http://localhost:3000
      COOKIE_SECURE: "false"
      TRUST_PROXY_HEADERS: "false"
    depends_on:
      postgres:
        condition: service_healthy`);
  }
  if (frontend) {
    services.push(`  frontend:
    ports:
      - "127.0.0.1:${'${FRONTEND_PORT:-3000}'}:3000"`);
  }
  return `services:
${services.join('\n\n')}

volumes:
${backend ? '  postgres-data:\n  redis-data:\n' : ''}`;
}

function productionEnvironmentExample(backend) {
  if (!backend) return '# This static frontend has no server-side secrets.\nFRONTEND_URL=https://app.example.com\n';
  const source = readFileSync(join(backend.sourceDirectory, '.env.example'), 'utf8');
  const replacements = new Map([
    ['APP_ENV', 'production'],
    ['PORT', '8000'],
    ['DATABASE_URL', backendDatabaseUrl(backend)],
    ['DATABASE_SSL', 'true'],
    ['SECRET_KEY', 'replace-with-at-least-32-random-characters'],
    ['FRONTEND_URL', 'https://app.example.com'],
    ['CORS_ORIGINS', 'https://app.example.com'],
    ['COOKIE_SECURE', 'true'],
    ['REDIS_URL', 'rediss://replace-me@redis.example.com:6380/0'],
    ['TRUST_PROXY_HEADERS', 'true'],
    ['TRUSTED_PROXY_IPS', '172.30.0.10'],
  ]);
  const seen = new Set();
  const configured = source.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || !replacements.has(match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${replacements.get(match[1])}`;
  });
  for (const [name, value] of replacements) if (!seen.has(name) && ['DATABASE_SSL', 'TRUST_PROXY_HEADERS', 'TRUSTED_PROXY_IPS'].includes(name)) configured.push(`${name}=${value}`);
  return `# Copy this file to .env. It is deliberately invalid until every replace-me value and\n# every selected email, OAuth, and Stripe setting is configured. Do not commit .env.\n${configured.join('\n')}\n`;
}

function deploymentGuide(backend, frontend) {
  const apiLine = backend ? `La API seleccionada es **${backend.displayName}** y escucha sólo en la red privada de Compose.` : 'No se seleccionó API; el gateway sólo sirve el frontend estático.';
  const frontendLine = frontend ? `El frontend seleccionado es **${frontend.displayName}**.` : 'No se seleccionó frontend; coloca un gateway TLS externo delante de la API enlazada a loopback.';
  const migration = backend
    ? 'docker compose --env-file .env --profile migrate run --rm migrate\n\ndocker compose --env-file .env --profile production up -d --build'
    : 'docker compose --env-file .env --profile production up -d --build';
  return `# Despliegue reproducible

${apiLine}

${frontendLine}

## Producción

1. Provisiona PostgreSQL y Redis **gestionados con TLS**. No se publican contenedores de datos en esta receta: el contrato fail-closed exige una URL de PostgreSQL con certificado verificable y una \`REDIS_URL\` con esquema \`rediss://\`.
2. Copia \`.env.production.example\` a \`.env\`, reemplaza todos los secretos y configura email, OAuth y Stripe si se usan. El archivo \`.env\` es un secreto de runtime; nunca se añade a la imagen ni al repositorio.
3. Entrega el certificado y la clave TLS en \`certs/fullchain.pem\` y \`certs/privkey.pem\` con permiso de lectura para Docker. El gateway publica 80/443, elimina las cabeceras \`X-Forwarded-*\` entrantes y reconstruye las suyas. Mantén \`GATEWAY_IP\` y \`TRUSTED_PROXY_IPS\` iguales para que la API sólo confíe en ese proxy fijo.
4. Ejecuta la migración como un trabajo de release, una vez por versión, antes de iniciar réplicas de la API:

\`\`\`sh
${migration}
\`\`\`

No automatices \`migrate\` dentro del arranque de cada réplica: permite revisar el resultado y evita carreras entre despliegues simultáneos. Compose comprueba \`/ready\` y el gateway no empieza a enrutar hasta que PostgreSQL y, cuando el rate limiting está activo, Redis estén disponibles. Comprueba \`https://app.example.com/ready\` tras el arranque; \`/health\` sólo confirma que el proceso sigue vivo.

## Comprobación local integrada

\`compose.dev.yaml\` levanta PostgreSQL y Redis sin TLS exclusivamente para desarrollo. Conserva \`APP_ENV=development\`; no representa una topología de producción.

\`\`\`sh
cp .env.production.example .env
docker compose -f compose.yaml -f compose.dev.yaml --env-file .env up -d postgres redis
docker compose -f compose.yaml -f compose.dev.yaml --env-file .env --profile migrate run --rm migrate
docker compose -f compose.yaml -f compose.dev.yaml --env-file .env up --build api frontend
\`\`\`

Usa \`docker compose ... down -v\` sólo para descartar deliberadamente los datos locales de esa comprobación. En producción realiza copias de seguridad, pruebas de restauración y rotación de secretos en los servicios gestionados.
`;
}

function writeDeployment(destinationDirectory, backend, frontend, frontendFeatures) {
  const deploymentDirectory = join(destinationDirectory, 'deployment');
  mkdirSync(deploymentDirectory, { recursive: true });
  writeFileSync(join(deploymentDirectory, 'compose.yaml'), deploymentCompose(backend, frontend), 'utf8');
  writeFileSync(join(deploymentDirectory, 'compose.dev.yaml'), developmentCompose(backend, frontend), 'utf8');
  writeFileSync(join(deploymentDirectory, '.env.production.example'), productionEnvironmentExample(backend), 'utf8');
  writeFileSync(join(deploymentDirectory, 'README.md'), deploymentGuide(backend, frontend), 'utf8');
  if (frontend) {
    writeFileSync(join(deploymentDirectory, '.dockerignore'), '.env\ncerts/\n', 'utf8');
    writeFileSync(join(deploymentDirectory, 'gateway.Dockerfile'), 'FROM nginx:1.27.4-alpine-slim\nCOPY nginx.conf /etc/nginx/conf.d/default.conf\n', 'utf8');
  const apiPrefixes = frontendApiPrefixes(frontend, frontendFeatures).join('|');
  writeFileSync(join(deploymentDirectory, 'nginx.conf'), `server {
  listen 80;
  server_name _;
  return 308 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name _;
  ssl_certificate /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

  location = /health {
    proxy_pass http://${backend ? 'api:8000' : 'frontend:3000'};
    proxy_set_header Host $host;
  }

${backend ? `  location = /ready {
    proxy_pass http://api:8000;
    proxy_set_header Host $host;
  }

  location ~ ^/(${apiPrefixes})(/|$) {
    proxy_pass http://api:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
  }

` : ''}  location / {
    proxy_pass http://frontend:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
  }
}
`, 'utf8');
  }
}

function assertCompatibleTemplates(backend, frontend, features = []) {
  const requiredCapabilities = [
    ...(frontend.compatibility?.requiresBackendCapabilities ?? []),
    ...features.flatMap((feature) => feature.requiresBackendCapabilities),
  ];
  const backendCapabilities = new Set(backend.capabilities);
  const missingCapabilities = requiredCapabilities.filter((capability) => !backendCapabilities.has(capability));

  if (missingCapabilities.length > 0) {
    throw new Error(
      `Frontend "${frontend.key}" is not compatible with backend "${backend.key}". `
      + `Missing backend capabilities: ${missingCapabilities.join(', ')}.`,
    );
  }
}

export function generateProject({
  destination,
  backendId,
  frontendId,
  featureIds = [],
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
  const frontendFeatures = selectFrontendFeatures(frontend, featureIds);

  if (!backend && frontendFeatures.some((feature) => feature.requiresBackendCapabilities.length > 0)) {
    throw new Error('The selected frontend features require a backend template.');
  }

  if (backend && frontend) {
    assertCompatibleTemplates(backend, frontend, frontendFeatures);
  }

  const outputParentDirectory = dirname(outputDirectory);
  let temporaryDirectory;

  try {
    mkdirSync(outputParentDirectory, { recursive: true });
    temporaryDirectory = mkdtempSync(join(outputParentDirectory, `.${basename(outputDirectory)}-`));

    const templateLicense = join(templatesDirectory, 'LICENSE');
    if (existsSync(templateLicense)) {
      copyFileSync(templateLicense, join(temporaryDirectory, 'LICENSE'));
    }

    if (backend) {
      copyTemplate(templatesDirectory, temporaryDirectory, 'backend', backend);
    }

    if (frontend) {
      copyTemplate(templatesDirectory, temporaryDirectory, 'frontend', frontend);
      copyFrontendFeatures(temporaryDirectory, frontend, frontendFeatures);
    }

    if (backend && frontend && frontend.compatibility?.requiresBackendCapabilities?.length > 0) {
      configureFrontendApiProxyTarget(temporaryDirectory, backend);
    }

    writeDeployment(temporaryDirectory, backend, frontend, frontendFeatures);

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

    const metadata = { schemaVersion: 1, templates: selectedTemplates };
    if (frontendFeatures.length > 0) metadata.features = { frontend: frontendFeatures.map((feature) => feature.id) };

    writeFileSync(
      join(temporaryDirectory, '.create-my-saas.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf8',
    );

    if (existsSync(outputDirectory)) {
      throw new Error(`Destination already exists: ${outputDirectory}`);
    }

    renameSync(temporaryDirectory, outputDirectory);
    temporaryDirectory = undefined;
  } catch (error) {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
    throw new Error(`Could not generate project at ${outputDirectory}: ${error.message}`, { cause: error });
  }

  return { outputDirectory, backend, frontend, frontendFeatures };
}
