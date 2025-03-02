import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Sample test', () => {
	assert.strictEqual(-1, [1, 2, 3].indexOf(5));
	assert.strictEqual(-1, [1, 2, 3].indexOf(0));
});
