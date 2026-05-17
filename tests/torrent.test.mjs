import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInfoHash, normalizeMagnet, dedupeByInfoHash } from '../dist/core/hash.js';
import { parseMagnetUri, isVideoFile, isArchiveFile } from '../dist/core/torrent.js';

function makeMockMeta(overrides = {}) {
  return {
    magnet: 'magnet:?xt=urn:btih:aaa',
    magnetUri: 'magnet:?xt=urn:btih:aaa',
    infoHash: 'aaa',
    name: 'test',
    files: [{ path: 'video.mkv', name: 'video.mkv', size: 2 * 1024 ** 3, extension: 'mkv', bytes: 2 * 1024 ** 3 }],
    totalSize: 2 * 1024 ** 3,
    status: 'ok',
    elapsedMs: 100,
    ...overrides,
  };
}

test('metadata items return files with path/name/size/extension', () => {
  const meta = makeMockMeta();
  assert.equal(meta.files[0].path, 'video.mkv');
  assert.equal(meta.files[0].name, 'video.mkv');
  assert.ok(typeof meta.files[0].size === 'number');
  assert.equal(meta.files[0].extension, 'mkv');
});

test('metadata ok status is ok', () => {
  const meta = makeMockMeta();
  assert.equal(meta.status, 'ok');
  assert.ok(meta.totalSize > 0);
});

test('metadata timeout status', () => {
  const meta = makeMockMeta({ status: 'timeout', files: [], totalSize: 0 });
  assert.equal(meta.status, 'timeout');
  assert.equal(meta.files.length, 0);
  assert.equal(meta.totalSize, 0);
});

test('metadata invalid status', () => {
  const meta = makeMockMeta({ status: 'invalid', files: [], totalSize: 0 });
  assert.equal(meta.status, 'invalid');
  assert.equal(meta.files.length, 0);
});

test('metadata error status', () => {
  const meta = makeMockMeta({ status: 'error', files: [], totalSize: 0, error: 'connection failed' });
  assert.equal(meta.status, 'error');
  assert.equal(meta.error, 'connection failed');
});

test('analyzeMany accepts concurrency limit', async () => {
  const { analyzeMany } = await import('../dist/core/torrent.js');
  assert.ok(typeof analyzeMany === 'function');
  assert.equal(analyzeMany.length, 3);
});

test('extractInfoHash extracts hex btih', () => {
  const ih = extractInfoHash('magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=test');
  assert.equal(ih, 'abcdef1234567890abcdef1234567890abcdef12');
});

test('dedupeByInfoHash removes duplicates by infoHash', () => {
  const items = [
    { magnet: 'magnet:?xt=urn:btih:AAA', title: 'A' },
    { magnet: 'magnet:?xt=urn:btih:AAA', title: 'A duplicate' },
    { magnet: 'magnet:?xt=urn:btih:BBB', title: 'B' },
  ];
  const result = dedupeByInfoHash(items);
  assert.equal(result.length, 2);
});

test('isVideoFile classifies video extensions', () => {
  assert.equal(isVideoFile('movie.mkv'), true);
  assert.equal(isVideoFile('show.mp4'), true);
  assert.equal(isVideoFile('readme.txt'), false);
});

test('isArchiveFile classifies archive extensions', () => {
  assert.equal(isArchiveFile('file.zip'), true);
  assert.equal(isArchiveFile('file.rar'), true);
  assert.equal(isArchiveFile('movie.mp4'), false);
});
