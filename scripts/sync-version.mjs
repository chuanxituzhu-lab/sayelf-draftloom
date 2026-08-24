import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = join(root, 'package.json');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const version = String(packageJson.version || '').trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid package version: ${version}`);

const versionPath = join(root, 'src', 'version.js');
await writeFile(versionPath, `export const APP_VERSION = '${version}';\n`, 'utf8');

const readUtf8 = path => readFile(path, 'utf8');
const replaceVersion = (text, pattern, replacement) => {
  if (!pattern.test(text)) throw new Error(`Version marker not found in ${text.slice(0, 40)}`);
  return text.replace(pattern, replacement);
};

const readmePath = join(root, 'README.md');
const readme = await readUtf8(readmePath);
await writeFile(readmePath, replaceVersion(readme, /^# 公众号排版 MVP v[^\r\n]+/m, `# 公众号排版 MVP v${version}`), 'utf8');

const harnessPath = join(root, 'docs', 'HARNESS_CONTRACT.json');
const harness = await readUtf8(harnessPath);
await writeFile(harnessPath, replaceVersion(harness, /^(\s*"version"\s*:\s*)"[^"]+"/m, `$1"${version}"`), 'utf8');

console.log(`Synced Draftloom version ${version}`);
