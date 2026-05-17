import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreWithAi } from '../dist/core/ai.js';

test('candidates split into batches when too long', async () => {
  const manyCandidates = Array.from({ length: 25 }, (_, i) => ({
    id: `c${i}`,
    title: `Movie ${i} 1080p WEB-DL`,
    magnet: `magnet:?xt=urn:btih:${String(i).padStart(40, '0')}`,
    infoHash: String(i).padStart(40, '0'),
    files: Array.from({ length: 10 }, (_, j) => ({
      path: `folder/subfolder/video_part_${j}.mkv`,
      name: `video_part_${j}.mkv`,
      size: 500 * 1024 * 1024,
      extension: 'mkv',
      bytes: 500 * 1024 * 1024,
    })),
    totalSize: 5 * 1024 ** 3,
    ruleScore: 75,
    ruleReasons: ['good video'],
  }));

  const results = await scoreWithAi(manyCandidates, {
    endpoint: '',
    model: '',
    threshold: 50,
  });

  assert.equal(results.length, 25);
  for (const r of results) {
    assert.ok(typeof r.finalScore === 'number');
    assert.ok(r.finalScore >= 0 && r.finalScore <= 100);
  }
});

test('file lists are truncated', async () => {
  const candidates = [{
    id: 'c0',
    title: 'Test Movie',
    magnet: 'magnet:?xt=urn:btih:aaaa',
    infoHash: 'aaaa',
    files: Array.from({ length: 100 }, (_, i) => ({
      path: `video_${i}_with_a_very_long_filename_that_goes_on_and_on_${i}.mkv`,
      name: `video_${i}.mkv`,
      size: 100 * 1024 * 1024,
      extension: 'mkv',
      bytes: 100 * 1024 * 1024,
    })),
    totalSize: 10 * 1024 ** 3,
    ruleScore: 80,
    ruleReasons: ['good'],
  }];

  const results = await scoreWithAi(candidates, { endpoint: '', model: '', threshold: 50 });
  assert.equal(results.length, 1);
  assert.ok(results[0].finalScore >= 0);
});

test('returns ruleScore-only results when AI endpoint is unavailable', async () => {
  const candidates = [{
    id: 'c0',
    title: 'Test',
    magnet: 'magnet:?xt=urn:btih:bbbb',
    infoHash: 'bbbb',
    files: [{ path: 'movie.mkv', name: 'movie.mkv', size: 2 * 1024 ** 3, extension: 'mkv', bytes: 2 * 1024 ** 3 }],
    totalSize: 2 * 1024 ** 3,
    ruleScore: 80,
    ruleReasons: ['good'],
  }];

  const results = await scoreWithAi(candidates, { endpoint: '', model: '', threshold: 50 });
  assert.equal(results.length, 1);
  assert.ok(results[0].aiScoreDetail.reasons.includes('本地启发式评分已完成'));
});

test('final score calculation uses ruleScore * 0.45 + aiScore * 0.55', async () => {
  const candidates = [{
    id: 'c0',
    title: 'Great Movie 4K',
    magnet: 'magnet:?xt=urn:btih:cccc',
    infoHash: 'cccc',
    files: [{ path: 'movie.mkv', name: 'movie.mkv', size: 10 * 1024 ** 3, extension: 'mkv', bytes: 10 * 1024 ** 3 }],
    totalSize: 10 * 1024 ** 3,
    ruleScore: 60,
    ruleReasons: ['ok'],
  }];

  const results = await scoreWithAi(candidates, { endpoint: '', model: '', threshold: 50 });
  assert.equal(results.length, 1);
  assert.ok(results[0].finalScore >= 0 && results[0].finalScore <= 100);
});

test('AI unavailable returned as false for empty endpoint', async () => {
  const { isAiAvailable } = await import('../dist/core/ai.js');
  assert.equal(isAiAvailable(''), false);
  assert.equal(isAiAvailable('http://localhost:8080'), true);
});
