import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');

test('Draftloom logo is local, reusable by the WebUI, and wired as favicon', async () => {
  const [logo, index, app, logoStats] = await Promise.all([
    readFile(join(root, 'assets', 'sayelf-logo.png')),
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'src', 'app.js'), 'utf8'),
    stat(join(root, 'assets', 'sayelf-logo.png'))
  ]);

  assert.equal(logo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(logoStats.size > 1000);
  assert.match(index, /rel="icon"[^>]+\/assets\/sayelf-logo\.png/);
  assert.match(app, /class="app-logo-mark"[^>]+src="\/assets\/sayelf-logo\.png"/);
  assert.match(app, /alt="SAYELF 山野精灵"/);
});
