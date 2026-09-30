import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { importArticle } from '../src/core.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

test('CLI check and local publish do not alter the source article state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftloom-publish-test-'));
  try {
    const dataPath = join(root, 'state.json');
    const body = '内容保持原样，C# 与 2*3 都不能丢。';
    const doc = importArticle({ text: `# 测试标题\n\n${body}`, filename: 'source.md' });
    const saved = JSON.stringify({ doc, selectedId: null, history: [], future: [] });
    await writeFile(dataPath, saved, 'utf8');
    const check = JSON.parse(execFileSync(process.execPath, ['scripts/cli.mjs', 'wechat-check', '--data', dataPath], { cwd: projectRoot, encoding: 'utf8', windowsHide: true }));
    assert.equal(check.changed, false);
    assert.equal(await readFile(dataPath, 'utf8'), saved);
    const manifest = JSON.parse(execFileSync(process.execPath, ['scripts/cli.mjs', 'publish', '--data', dataPath, '--out', join(root, 'bundle')], { cwd: projectRoot, encoding: 'utf8', windowsHide: true }));
    assert.equal(manifest.delivery.mode, 'local-bundle');
    assert.equal(manifest.optimization, null);
    assert.equal(await readFile(dataPath, 'utf8'), saved);
    assert.match(await readFile(manifest.htmlPath, 'utf8'), /C#/);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir(), 'draftloom-publish-test-'))) throw new Error('临时测试路径不安全');
    await rm(root, { recursive: true, force: true });
  }
});
