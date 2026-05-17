import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreByRules } from '../dist/core/rules.js';

const result = {
  id: '1',
  sourceAdapterId: 'demo',
  sourceName: 'Demo',
  title: 'Open Movie 1080p WEB-DL',
  magnetUri: 'magnet:?xt=urn:btih:abcdef&dn=Open%20Movie',
};

test('scoreByRules accepts normal video metadata', () => {
  const metadata = {
    magnetUri: result.magnetUri,
    files: [{ path: 'Open Movie 1080p.mkv', bytes: 4 * 1024 ** 3 }],
    totalBytes: 4 * 1024 ** 3,
    seeders: 88,
    status: 'complete',
  };
  const score = scoreByRules(result, metadata);
  assert.equal(score.accepted, true);
  assert.ok(score.score > 0.7);
});

test('scoreByRules rejects resources without video files', () => {
  const metadata = {
    magnetUri: result.magnetUri,
    files: [{ path: 'readme.txt', bytes: 1024 }],
    totalBytes: 1024,
    status: 'complete',
  };
  const score = scoreByRules({ ...result, title: '广告 QQ群 付费' }, metadata);
  assert.equal(score.accepted, false);
});
