import test from 'node:test';
import assert from 'node:assert/strict';
import { isArchiveFile, isVideoFile, parseMagnetUri } from '../dist/core/torrent.js';

test('parseMagnetUri extracts info hash and display name', () => {
  const parsed = parseMagnetUri('magnet:?xt=urn:btih:ABCDEF123456&dn=Open%20Movie');
  assert.equal(parsed.infoHash, 'ABCDEF123456');
  assert.equal(parsed.displayName, 'Open Movie');
});

test('file helpers classify video and archive extensions', () => {
  assert.equal(isVideoFile('episode.mkv'), true);
  assert.equal(isVideoFile('readme.txt'), false);
  assert.equal(isArchiveFile('payload.rar'), true);
  assert.equal(isArchiveFile('movie.mp4'), false);
});
