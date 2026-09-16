import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');

test('Draftloom logo is local, reusable by the WebUI, and wired as favicon', async () => {
  const [logo, index, app] = await Promise.all([
    readFile(join(root, 'assets', 'draftloom-logo.svg'), 'utf8'),
    readFile(join(root, 'index.html'), 'utf8'),
    readFile(join(root, 'src', 'app.js'), 'utf8')
  ]);

  assert.match(logo, /<svg[^>]+viewBox="0 0 64 64"/);
  assert.match(logo, /#11a866/);
  assert.match(index, /rel="icon"[^>]+\/assets\/draftloom-logo\.svg/);
  assert.match(app, /class="app-logo-mark"[^>]+src="\/assets\/draftloom-logo\.svg"/);
});
