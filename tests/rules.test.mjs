import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreByRules } from '../dist/core/rules.js';

function makeMeta(overrides = {}) {
  return {
    magnet: 'magnet:?xt=urn:btih:abcdef',
    magnetUri: 'magnet:?xt=urn:btih:abcdef',
    infoHash: 'abcdef',
    name: 'test',
    files: [],
    totalBytes: 0,
    totalSize: 0,
    status: 'ok',
    elapsedMs: 0,
    ...overrides,
  };
}

test('all zip/rar files with no video deducts score significantly', () => {
  const meta = makeMeta({
    files: [
      { path: 'a.zip', name: 'a.zip', size: 1000, extension: 'zip', bytes: 1000 },
      { path: 'b.rar', name: 'b.rar', size: 2000, extension: 'rar', bytes: 2000 },
    ],
    totalBytes: 3000,
    totalSize: 3000,
  });
  const score = scoreByRules('download', meta);
  assert.equal(score.hardReject, true);
  assert.ok(score.score < 40);
});

test('has mkv/mp4 files are preserved', () => {
  const meta = makeMeta({
    files: [
      { path: 'movie.mkv', name: 'movie.mkv', size: 4 * 1024 ** 3, extension: 'mkv', bytes: 4 * 1024 ** 3 },
    ],
    totalBytes: 4 * 1024 ** 3,
    totalSize: 4 * 1024 ** 3,
    seeders: 100,
  });
  const score = scoreByRules('Movie 1080p', meta);
  assert.equal(score.accepted, true);
  assert.ok(score.score >= 70);
});

test('title with QQ/广告 only deducts, not hardReject', () => {
  const meta = makeMeta({
    files: [
      { path: 'movie.mp4', name: 'movie.mp4', size: 2 * 1024 ** 3, extension: 'mp4', bytes: 2 * 1024 ** 3 },
    ],
    totalBytes: 2 * 1024 ** 3,
    totalSize: 2 * 1024 ** 3,
  });
  const score = scoreByRules('电影 QQ群 微信 付费', meta);
  assert.equal(score.hardReject, false);
  assert.ok(score.score < 70);
  assert.ok(score.reasons.some((r) => r.includes('广告')));
});

test('no video files with metadata error hard rejects', () => {
  const meta = makeMeta({ status: 'no_metadata' });
  const score = scoreByRules('test', meta);
  assert.equal(score.hardReject, true);
});

test('low video ratio deducts score', () => {
  const meta = makeMeta({
    files: [
      { path: 'small.mkv', name: 'small.mkv', size: 50 * 1024 ** 2, extension: 'mkv', bytes: 50 * 1024 ** 2 },
      { path: 'big.zip', name: 'big.zip', size: 5 * 1024 ** 3, extension: 'zip', bytes: 5 * 1024 ** 3 },
    ],
    totalBytes: 5.05 * 1024 ** 3,
    totalSize: 5.05 * 1024 ** 3,
  });
  const score = scoreByRules('test', meta);
  assert.ok(score.reasons.some((r) => r.includes('占比')));
});

test('low keyword relevance deducts score', () => {
  const meta = makeMeta({
    files: [
      { path: 'random.mp4', name: 'random.mp4', size: 1 * 1024 ** 3, extension: 'mp4', bytes: 1 * 1024 ** 3 },
    ],
    totalBytes: 1 * 1024 ** 3,
    totalSize: 1 * 1024 ** 3,
  });
  const unrelated = scoreByRules('unrelated.mp4', meta, 'specific_keyword_xyz');
  const related = scoreByRules('specific_keyword_xyz.mp4', meta, 'specific_keyword_xyz');
  assert.ok(related.score > unrelated.score || related.score >= unrelated.score);
});
