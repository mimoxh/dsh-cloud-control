import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLUGIN_VERSION } from '../lib/endpoint.mjs';

const root = new URL('../', import.meta.url);

/** @param {string} name - file name relative to the package root. */
const read = (name) => readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

test('package manifest declares the client bundle and the bundle patch', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.name, 'dsh-cloud-control');
  assert.equal(manifest.version, PLUGIN_VERSION);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.exports['./client'], './client.js');
  assert.equal(manifest.exports['.'], './index.js');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.client.immediately, true);
  assert.deepEqual(manifest.dsh.client.external, []);
  assert.ok(manifest.files.includes('client.js'));
  assert.ok(manifest.files.includes('lib/*.mjs'));
});

test('the bundle patch inserts the documented row id', () => {
  const patch = read('cordis.patch.yml');
  assert.match(patch, /id: cloud-control/u);
  assert.match(patch, /name: dsh-cloud-control/u);
});

test('the locale files carry the plugin display metadata', () => {
  for (const language of ['en', 'zh']) {
    const meta = JSON.parse(read(`locale/${language}.json`));
    assert.equal(typeof meta.meta.title, 'string');
    assert.ok(meta.meta.title.length > 0);
    assert.equal(typeof meta.meta.description, 'string');
  }
});

test('the browser half registers the documented panel id', () => {
  const bundle = read('client.js');
  assert.match(bundle, /window\.__ModuleLoader__\.load\(\{/u);
  assert.match(bundle, /id: 'dsh-cloud-control'/u);
  assert.match(bundle, /PANEL_ID = 'cloud-control'/u);
});
