import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInfoHash, normalizeMagnet, dedupeByInfoHash } from '../dist/core/hash.js';
import { parseMagnetUri, isVideoFile, isArchiveFile } from '../dist/core/torrent.js';

test('extractInfoHash extracts hex btih', () => {
  const ih = extractInfoHash('magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12&dn=test');
  assert.equal(ih, 'abcdef1234567890abcdef1234567890abcdef12');
});

test('extractInfoHash returns null for invalid magnet', () => {
  assert.equal(extractInfoHash('not-a-magnet'), null);
  assert.equal(extractInfoHash('magnet:?dn=test'), null);
});

test('normalizeMagnet lowercases infoHash', () => {
  const out = normalizeMagnet('magnet:?xt=urn:btih:ABCDEF123456&dn=TEST');
  assert.ok(out.includes('urn:btih:abcdef123456'));
});

test('dedupeByInfoHash removes duplicates by infoHash', () => {
  const items = [
    { magnet: 'magnet:?xt=urn:btih:AAA', title: 'A' },
    { magnet: 'magnet:?xt=urn:btih:AAA', title: 'A duplicate' },
    { magnet: 'magnet:?xt=urn:btih:BBB', title: 'B' },
  ];
  const result = dedupeByInfoHash(items);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'A');
  assert.equal(result[1].title, 'B');
});

test('isVideoFile classifies video extensions', () => {
  assert.equal(isVideoFile('movie.mkv'), true);
  assert.equal(isVideoFile('show.mp4'), true);
  assert.equal(isVideoFile('clip.avi'), true);
  assert.equal(isVideoFile('video.mov'), true);
  assert.equal(isVideoFile('movie.wmv'), true);
  assert.equal(isVideoFile('movie.flv'), true);
  assert.equal(isVideoFile('movie.webm'), true);
  assert.equal(isVideoFile('movie.m4v'), true);
  assert.equal(isVideoFile('movie.ts'), true);
  assert.equal(isVideoFile('readme.txt'), false);
});

test('isArchiveFile classifies archive extensions', () => {
  assert.equal(isArchiveFile('file.zip'), true);
  assert.equal(isArchiveFile('file.rar'), true);
  assert.equal(isArchiveFile('file.7z'), true);
  assert.equal(isArchiveFile('file.tar'), true);
  assert.equal(isArchiveFile('file.gz'), true);
  assert.equal(isArchiveFile('file.iso'), true);
  assert.equal(isArchiveFile('movie.mp4'), false);
});
