import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchKonami, normalizeSequence } from '../src/konami.js';

const DEFAULT = 'up,up,down,down,left,right,left,right,b,a';

test('matches the default sequence submitted as an array', () => {
  const submitted = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a'];
  assert.equal(matchKonami(submitted, DEFAULT), true);
});

test('matches the default sequence submitted as a comma string', () => {
  assert.equal(matchKonami(DEFAULT, DEFAULT), true);
});

test('is case-insensitive and trims whitespace', () => {
  const submitted = [' UP', 'Up ', 'DOWN', 'down', 'Left', 'RIGHT', 'left', 'right', 'B', 'A'];
  assert.equal(matchKonami(submitted, DEFAULT), true);
});

test('rejects a wrong sequence', () => {
  const submitted = ['up', 'down', 'up', 'down', 'left', 'right', 'left', 'right', 'b', 'a'];
  assert.equal(matchKonami(submitted, DEFAULT), false);
});

test('rejects a too-short sequence (no length-leak via early match)', () => {
  assert.equal(matchKonami(['up', 'up'], DEFAULT), false);
});

test('rejects empty / non-sequence input', () => {
  assert.equal(matchKonami([], DEFAULT), false);
  assert.equal(matchKonami(undefined, DEFAULT), false);
  assert.equal(matchKonami('', DEFAULT), false);
});

test('normalizeSequence handles array and string forms identically', () => {
  assert.deepEqual(normalizeSequence('a, b ,C'), ['a', 'b', 'c']);
  assert.deepEqual(normalizeSequence(['a', ' b ', 'C']), ['a', 'b', 'c']);
});
