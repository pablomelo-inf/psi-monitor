import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatMiB, parseGpuLine } from '../lib/gpu.js';

test('parseGpuLine reads a real nvidia-smi line', () => {
    assert.deepEqual(parseGpuLine('30, 26, 1051, 12288, 60'), {
        util: 30,
        memUtil: 26,
        memUsedMiB: 1051,
        memTotalMiB: 12288,
        tempC: 60,
    });
});

test('parseGpuLine returns null for N/A fields', () => {
    assert.equal(parseGpuLine('30, [N/A], 1051, 12288, 60'), null);
});

test('parseGpuLine returns null for wrong field count or empty input', () => {
    assert.equal(parseGpuLine('30, 26'), null);
    assert.equal(parseGpuLine(''), null);
});

test('formatMiB switches to GiB from 1024 MiB', () => {
    assert.equal(formatMiB(512), '512 MiB');
    assert.equal(formatMiB(1051), '1.0 GiB');
    assert.equal(formatMiB(12288), '12.0 GiB');
});
