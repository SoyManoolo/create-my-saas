import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const text = (command, argumentsList) => execFileSync(command, argumentsList, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const trackedFiles = text('git', ['ls-files', '-z']).split('\0').filter(Boolean);
const failures = [];
const forbiddenPath = /(^|\/)(node_modules|\.venv|venv|env|dist|build|\.next|\.cache|\.turbo|playwright-report|test-results|coverage|__pycache__)(\/|$)|(^|\/)\.env(?:\..+)?$|(^|\/)(?:logs?|secrets?)(\/|$)|\.(?:pem|key|p12|pfx|py[co]|sqlite3?)$|(?:^|\/)dump\.rdb$/i;
const allowedEnvironmentExample = /(^|\/)\.env(?:\.[^/]+)?\.example$/i;
const secretPatterns = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/], ['GitHub token', /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/], ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}\b/], ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/], ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/], ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/], ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const privateRepositoryName = `create-my-saas-${'pro'}`;
const privateRegistryPattern = new RegExp([['npm', 'pkg', 'github', 'com'].join('\\.'), ['registry', '(?:internal|corp|local)'].join('\\.'), `arti${'factory'}`, `ver${'daccio'}`].join('|'), 'i');
const internalPatterns = [['private repository reference', new RegExp(privateRepositoryName, 'i')], ['local user path', /(?:[A-Z]:\\Users\\|\/(?:Users|home)\/)[^\s'"`]+/], ['private npm registry', privateRegistryPattern]];
function report(scope, label) { failures.push(`${scope}: ${label}`); }
function scanText(scope, content) {
  for (const [label, pattern] of [...secretPatterns, ...internalPatterns]) if (pattern.test(content)) report(scope, label);
  for (const match of content.matchAll(/(?:postgres(?:ql)?|mongodb(?:\+srv)?):\/\/([^\s:@]+):([^\s@]+)@([^\s/'"`]+)/gi)) {
    const [user, password] = [match[1], match[2]].map((value) => value.toLowerCase());
    const host = match[3].replace(/:\d+$/, '').toLowerCase();
    const placeholder = /(?:example|replace|change|your|usuario|clave|password|secret)/.test(`${user}:${password}`);
    if (!placeholder && !['localhost', '127.0.0.1', 'postgres', 'db'].includes(host) && !host.includes('${')) report(scope, 'credentialed production database URL');
  }
}
function scanDependencyManifest(path, content) {
  if (path.endsWith('package.json')) {
    let manifest;
    try { manifest = JSON.parse(content); } catch { report(path, 'invalid package.json'); return; }
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const [name, version] of Object.entries(manifest[section] ?? {})) if (/^(?:git\+ssh:|ssh:|git@|https?:\/\/[^/]+@)/i.test(version)) report(path, `non-public dependency source for ${name}`);
  }
  if (/^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|uv\.lock|pyproject\.toml|requirements[^/]*\.txt)$/i.test(path) && /(?:git\+ssh:|ssh:\/\/|git@)/i.test(content)) report(path, 'non-public dependency source');
  if (/^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|uv\.lock|pyproject\.toml|requirements[^/]*\.txt)$/i.test(path) && privateRegistryPattern.test(content)) report(path, 'non-public dependency source');
}
for (const path of trackedFiles) {
  if (forbiddenPath.test(path) && !allowedEnvironmentExample.test(path)) report(path, 'forbidden generated, local, credential, or environment file');
  const content = readFileSync(path, 'utf8'); scanText(path, content); scanDependencyManifest(path, content);
  if (path.startsWith('extensions/') && path.endsWith('extension.manifest.json') && !String(JSON.parse(content).id ?? '').startsWith('community:')) report(path, 'non-Community extension manifest');
}
for (const path of text('git', ['log', '--all', '--name-only', '--format=']).split(/\r?\n/).filter(Boolean)) if (forbiddenPath.test(path) && !allowedEnvironmentExample.test(path)) report(`Git history (${path})`, 'forbidden generated, local, credential, or environment file');
scanText('Git history', text('git', ['log', '--all', '-p', '--no-ext-diff']));
if (failures.length) { console.error('Public repository audit failed:'); for (const failure of [...new Set(failures)]) console.error(`- ${failure}`); process.exitCode = 1; } else console.log(`Public repository audit passed (${trackedFiles.length} tracked files and reachable Git history).`);
