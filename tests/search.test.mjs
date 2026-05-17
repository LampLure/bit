import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdapterReady } from '../dist/core/adapterGuide.js';

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
  const adapter = { ...baseAdapter };
  assert.equal(isAdapterReady(adapter), true);
});

test('adapter missing searchInputSelector should not be ready', () => {
  const adapter = { ...baseAdapter, searchInputSelector: '' };
  assert.equal(isAdapterReady(adapter), false);
});

test('adapter missing searchButtonSelector should not be ready', () => {
  const adapter = { ...baseAdapter, searchButtonSelector: '' };
  assert.equal(isAdapterReady(adapter), false);
});

test('adapter missing resultItemSelector should not be ready', () => {
  const adapter = { ...baseAdapter, resultItemSelector: '' };
  assert.equal(isAdapterReady(adapter), false);
});

test('adapter missing magnetLinkSelector should not be ready', () => {
  const adapter = { ...baseAdapter, magnetLinkSelector: '' };
  assert.equal(isAdapterReady(adapter), false);
});

test('url-template mode requires searchUrlTemplate', () => {
  const adapter = { ...baseAdapter, searchMode: 'url-template', searchUrlTemplate: 'https://example.org/search?q={query}', searchInputSelector: '', searchButtonSelector: '' };
  assert.equal(isAdapterReady(adapter), true);
});
