import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    cpuUsagePercent,
    diskOfDevice,
    diskRates,
    mountsByDisk,
    parseCpuStat,
    parseDiskstats,
    parseMeminfo,
} from '../lib/system.js';

const MEMINFO = [
    'MemTotal:       32686532 kB',
    'MemFree:        13000000 kB',
    'MemAvailable:   22502352 kB',
    'SwapTotal:      15625212 kB',
    'SwapFree:       15625212 kB',
].join('\n');

test('parseMeminfo derives used RAM from MemAvailable', () => {
    const mem = parseMeminfo(MEMINFO);
    assert.ok(Math.abs(mem.totalMiB - 31920.6) < 1);
    assert.ok(Math.abs(mem.usedMiB - 9945.1) < 1);
    assert.equal(mem.swapUsedMiB, 0);
});

test('parseMeminfo returns null without the required fields', () => {
    assert.equal(parseMeminfo('MemTotal: 100 kB'), null);
    assert.equal(parseMeminfo(''), null);
});

test('parseCpuStat separates busy from idle+iowait', () => {
    const stat = parseCpuStat('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 1 1 1 1 0 0 0 0 0\n');
    assert.deepEqual(stat, { busy: 150, total: 1000 });
});

test('parseCpuStat returns null for garbage', () => {
    assert.equal(parseCpuStat('nothing here'), null);
    assert.equal(parseCpuStat('cpu  a b c d e'), null);
});

test('cpuUsagePercent compares two samples', () => {
    const usage = cpuUsagePercent({ busy: 100, total: 1000 }, { busy: 200, total: 1200 });
    assert.equal(usage, 50);
    assert.equal(cpuUsagePercent(null, { busy: 1, total: 2 }), null);
    assert.equal(cpuUsagePercent({ busy: 1, total: 5 }, { busy: 1, total: 5 }), null);
});

const DISKSTATS = [
    '   8       0 sda 100 0 2000 50 300 0 4000 80 0 559780 130 0 0 0 0 0 0',
    '   8       3 sda3 90 0 1800 40 250 0 3500 70 0 500000 110 0 0 0 0 0 0',
    '   8      16 sdb 5 0 80 1 0 0 0 0 0 143 1 0 0 0 0 0 0',
    '   7       0 loop0 1 0 2 0 0 0 0 0 0 1 0 0 0 0 0 0 0',
    ' 259       0 nvme0n1 10 0 160 2 20 0 320 4 0 77 6 0 0 0 0 0 0',
].join('\n');

test('parseDiskstats keeps whole disks only', () => {
    const disks = parseDiskstats(DISKSTATS);
    assert.deepEqual(Object.keys(disks).sort(), ['nvme0n1', 'sda', 'sdb']);
    assert.deepEqual(disks.sda, { sectorsRead: 2000, sectorsWritten: 4000, ioTicksMs: 559780 });
});

test('diskRates computes busy percent and MB/s', () => {
    const prev = { sectorsRead: 0, sectorsWritten: 0, ioTicksMs: 0 };
    const cur = { sectorsRead: 4000, sectorsWritten: 2000, ioTicksMs: 500 };
    const rates = diskRates(prev, cur, 2000);
    assert.equal(rates.busyPercent, 25);
    assert.ok(Math.abs(rates.readMBs - 1.024) < 1e-9);
    assert.ok(Math.abs(rates.writeMBs - 0.512) < 1e-9);
});

test('diskRates returns null without a previous sample or elapsed time', () => {
    assert.equal(
        diskRates(undefined, { sectorsRead: 0, sectorsWritten: 0, ioTicksMs: 0 }, 1000),
        null,
    );
    assert.equal(
        diskRates(
            { sectorsRead: 0, sectorsWritten: 0, ioTicksMs: 0 },
            { sectorsRead: 0, sectorsWritten: 0, ioTicksMs: 0 },
            0,
        ),
        null,
    );
});

test('diskOfDevice maps partitions to their whole disk', () => {
    assert.equal(diskOfDevice('/dev/sda6'), 'sda');
    assert.equal(diskOfDevice('/dev/nvme0n1p2'), 'nvme0n1');
    assert.equal(diskOfDevice('/dev/mmcblk0p1'), 'mmcblk0');
    assert.equal(diskOfDevice('/dev/mapper/vg-root'), null);
    assert.equal(diskOfDevice('tmpfs'), null);
});

test('mountsByDisk groups mount points per disk', () => {
    const mounts = [
        '/dev/sda3 / ext4 rw 0 0',
        '/dev/sda4 /boot/efi vfat rw 0 0',
        '/dev/sda6 /home ext4 rw 0 0',
        'tmpfs /run tmpfs rw 0 0',
        '/dev/loop3 /snap/core ext4 ro 0 0',
    ].join('\n');
    assert.deepEqual(mountsByDisk(mounts), { sda: ['/', '/boot/efi', '/home'] });
});
