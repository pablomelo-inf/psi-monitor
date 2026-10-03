import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatPercent, instantPercent, levelFor, parsePressure } from '../lib/psi.js';

const IO_SAMPLE = [
    'some avg10=22.20 avg60=9.25 avg300=2.22 total=99181834',
    'full avg10=18.74 avg60=7.80 avg300=1.87 total=93316273',
    '',
].join('\n');

test('parsePressure reads some and full lines', () => {
    const result = parsePressure(IO_SAMPLE);
    assert.equal(result.some.avg10, 22.2);
    assert.equal(result.some.avg300, 2.22);
    assert.equal(result.some.total, 99181834);
    assert.equal(result.full.avg60, 7.8);
});

test('parsePressure accepts files with only a some line', () => {
    const result = parsePressure('some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n');
    assert.equal(result.full, null);
    assert.equal(result.some.avg10, 0);
});

test('parsePressure returns null for empty or garbage input', () => {
    assert.equal(parsePressure(''), null);
    assert.equal(parsePressure('not pressure data\n'), null);
});

test('parsePressure ignores malformed fields', () => {
    const result = parsePressure('some avg10=abc avg60=1.50 total=7\n');
    assert.equal(result.some.avg10, undefined);
    assert.equal(result.some.avg60, 1.5);
});

test('levelFor maps percentages to severity', () => {
    assert.equal(levelFor(0), 'ok');
    assert.equal(levelFor(4.99), 'ok');
    assert.equal(levelFor(5), 'warn');
    assert.equal(levelFor(19.9), 'warn');
    assert.equal(levelFor(20), 'crit');
});

test('levelFor honours custom thresholds', () => {
    assert.equal(levelFor(3, { warn: 2, crit: 3 }), 'crit');
});

test('formatPercent uses two decimals by default and accepts a custom count', () => {
    assert.equal(formatPercent(0), '0.00%');
    assert.equal(formatPercent(22.204), '22.20%');
    assert.equal(formatPercent(0.0123, 3), '0.012%');
});

test('instantPercent computes stall share from the cumulative counter', () => {
    // 20 000 us stalled in a 2 s (2 000 000 us) window = 1%
    assert.equal(instantPercent(1_000_000, 1_020_000, 2_000_000), 1);
    assert.equal(instantPercent(5, 5, 2_000_000), 0);
});

test('instantPercent returns null for missing data or bad intervals', () => {
    assert.equal(instantPercent(undefined, 10, 1000), null);
    assert.equal(instantPercent(1, 2, 0), null);
});

test('instantPercent clamps counter glitches into 0..100', () => {
    assert.equal(instantPercent(100, 50, 1000), 0);
    assert.equal(instantPercent(0, 5_000_000, 1000), 100);
});
