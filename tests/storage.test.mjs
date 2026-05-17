import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHistory, pushHistory } from '../dist/core/storage.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => Array.from(store.keys())[index] ?? null,
  get length() { return store.size; },
};

function entry(index) {
  return { id: String(index), query: `q${index}`, keyword: `q${index}`, createdAt: new Date(index).toISOString(), results: [] };
}

test('history storage keeps at most five recent entries', () => {
  localStorage.clear();
  for (let index = 0; index < 7; index += 1) pushHistory(entry(index));
  const history = loadHistory();
  assert.equal(history.length, 5);
  assert.equal(history[0].query, 'q6');
  assert.equal(history[4].query, 'q2');
});
