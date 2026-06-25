import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyQueryPlaceholders } from './index.js';

test('applyQueryPlaceholders does not corrupt $10 when replacing $1', () => {
  const sql = 'WHERE id IN ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
  const bound = applyQueryPlaceholders(sql, 10);
  assert.equal(
    bound,
    'WHERE id IN (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9)',
  );
  assert.doesNotMatch(bound, /@p00/);
});

test('applyQueryPlaceholders handles pagination params after filters', () => {
  const sql = 'WHERE c.channel = $1 OFFSET $3 ROWS FETCH NEXT $2 ROWS ONLY';
  const bound = applyQueryPlaceholders(sql, 3);
  assert.equal(bound, 'WHERE c.channel = @p0 OFFSET @p2 ROWS FETCH NEXT @p1 ROWS ONLY');
});
