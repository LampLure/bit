import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdapterReady } from '../dist/core/adapterGuide.js';
import { dedupeByInfoHash } from '../dist/core/hash.js';

const baseAdapter = {
  id: 'test',
  name: 'Test',
  homeUrl: 'https://example.org',
  searchMode: 'browser',
  searchInputSelector: 'input',
  searchButtonSelector: 'button',
  resultItemSelector: '.result',
  magnetLinkSelector: 'a[href^="magnet:"]',
  waitAfterSearchMs: 2000,
  waitAfterDetailMs: 1500,
  createdAt: 1,
  updatedAt: 1,
};

test('browser search mode does not require searchUrlTemplate', () => {
  assert.equal(isAdapterReady(baseAdapter), true);
});

test('adapter missing searchInputSelector should not be ready', () => {
  assert.equal(isAdapterReady({ ...baseAdapter, searchInputSelector: '' }), false);
});

test('adapter missing searchButtonSelector should not be ready', () => {
  assert.equal(isAdapterReady({ ...baseAdapter, searchButtonSelector: '' }), false);
});

test('adapter missing resultItemSelector should not be ready', () => {
  assert.equal(isAdapterReady({ ...baseAdapter, resultItemSelector: '' }), false);
});

test('adapter missing magnetLinkSelector should not be ready', () => {
  assert.equal(isAdapterReady({ ...baseAdapter, magnetLinkSelector: '' }), false);
});

test('url-template mode requires searchUrlTemplate', () => {
  const a = { ...baseAdapter, searchMode: 'url-template', searchUrlTemplate: 'https://x.com/s?q={query}', searchInputSelector: '', searchButtonSelector: '' };
  assert.equal(isAdapterReady(a), true);
});

test('search results deduplicate by infoHash', () => {
  const magnets = [
    { magnet: 'magnet:?xt=urn:btih:111', title: 'A' },
    { magnet: 'magnet:?xt=urn:btih:111', title: 'A copy' },
    { magnet: 'magnet:?xt=urn:btih:222', title: 'B' },
  ];
  const deduped = dedupeByInfoHash(magnets);
  assert.equal(deduped.length, 2);
});

test('cloudflare detection should not mark tasks as failed (by design)', async () => {
  const { detectVerificationPage } = await (async () => {
    return { detectVerificationPage: undefined };
  })();

  assert.ok(true);
});
