import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BADGES, canHide, isShown, sanitizeHidden, setShown } from '../lib/badges.js';

test('BADGES lists the six badges in top bar order', () => {
    assert.deepEqual(
        BADGES.map(([key]) => key),
        ['io', 'cpu', 'memory', 'gpu', 'wifi', 'ethernet'],
    );
});

test('sanitizeHidden drops unknown keys and duplicates', () => {
    assert.deepEqual(sanitizeHidden(['gpu', 'gpu', 'nope', 'wifi']), ['gpu', 'wifi']);
    assert.deepEqual(sanitizeHidden([]), []);
});

test('sanitizeHidden shows the always-available badges again if all were hidden', () => {
    assert.deepEqual(sanitizeHidden(['io', 'cpu', 'memory', 'gpu']), ['gpu']);
});

test('isShown is the opposite of being in the hidden list', () => {
    assert.equal(isShown(['gpu'], 'gpu'), false);
    assert.equal(isShown(['gpu'], 'cpu'), true);
});

test('canHide refuses to hide the last always-available badge', () => {
    assert.equal(canHide([], 'io'), true);
    assert.equal(canHide(['io'], 'cpu'), true);
    assert.equal(canHide(['io', 'cpu'], 'memory'), false);
});

test('canHide always allows the hardware-dependent badges', () => {
    assert.equal(canHide(['io', 'cpu'], 'gpu'), true);
    assert.equal(canHide([], 'ethernet'), true);
});

test('setShown hides and shows one badge', () => {
    assert.deepEqual(setShown([], 'gpu', false), ['gpu']);
    assert.deepEqual(setShown(['gpu', 'wifi'], 'gpu', true), ['wifi']);
});

test('setShown ignores hiding twice and hiding the last always-available badge', () => {
    assert.deepEqual(setShown(['gpu'], 'gpu', false), ['gpu']);
    assert.deepEqual(setShown(['io', 'cpu'], 'memory', false), ['io', 'cpu']);
});

test('setShown does not change the list it was given', () => {
    const hidden = ['gpu'];
    setShown(hidden, 'wifi', false);
    assert.deepEqual(hidden, ['gpu']);
});
