import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    classifyInterface,
    formatRate,
    interfacesWithIpv4,
    isConnected,
    isLinkUp,
    parseWireless,
    ratePerSecond,
    summarize,
} from '../lib/network.js';

const WIRELESS = [
    'Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE',
    ' face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22',
    ' wlo1: 0000   70.  -23.  -256        0      0      0      0     10        0',
].join('\n');

test('parseWireless reads link quality and signal level', () => {
    assert.deepEqual(parseWireless(WIRELESS), { wlo1: { quality: 70, levelDbm: -23 } });
});

test('parseWireless converts an unsigned level to dBm', () => {
    const text = ' wlan0: 0000   50.  193.  161        0      0      0      0      0        0';
    assert.equal(parseWireless(text).wlan0.levelDbm, -63);
});

test('parseWireless returns nothing when there is no wireless interface', () => {
    assert.deepEqual(parseWireless('Inter-| sta-|   Quality\n face | tus | link level\n'), {});
    assert.deepEqual(parseWireless(''), {});
});

test('classifyInterface tells physical from virtual interfaces', () => {
    const virtual = '../../devices/virtual/net/veth197646c';
    const pci = '../../devices/pci0000:00/0000:00:1c.0/0000:01:00.0/net/eno2';
    assert.equal(classifyInterface({ name: 'lo', linkTarget: virtual }), 'loopback');
    assert.equal(classifyInterface({ name: 'veth197646c', linkTarget: virtual }), 'virtual');
    assert.equal(classifyInterface({ name: 'br-3c8c', linkTarget: virtual }), 'virtual');
    assert.equal(classifyInterface({ name: 'eno2', linkTarget: pci }), 'ethernet');
    assert.equal(classifyInterface({ name: 'wlo1', linkTarget: pci, wireless: true }), 'wifi');
});

test('classifyInterface works without a link target', () => {
    assert.equal(classifyInterface({ name: 'eth0' }), 'ethernet');
});

test('isLinkUp accepts up and unknown, rejects the rest', () => {
    assert.equal(isLinkUp('up'), true);
    assert.equal(isLinkUp('unknown'), true);
    assert.equal(isLinkUp('down'), false);
    assert.equal(isLinkUp('lowerlayerdown'), false);
    assert.equal(isLinkUp('notpresent'), false);
});

test('ratePerSecond divides the byte delta by the elapsed time', () => {
    assert.equal(ratePerSecond(1000, 5000, 2), 2000);
    assert.equal(ratePerSecond(5, 5, 2), 0);
});

test('ratePerSecond returns null without data and 0 for a reset counter', () => {
    assert.equal(ratePerSecond(undefined, 10, 2), null);
    assert.equal(ratePerSecond(1, 2, 0), null);
    assert.equal(ratePerSecond(9000, 100, 2), 0);
});

test('formatRate picks a readable decimal unit', () => {
    assert.equal(formatRate(0), '0 B/s');
    assert.equal(formatRate(999), '999 B/s');
    assert.equal(formatRate(1500), '1.5 KB/s');
    assert.equal(formatRate(85000), '85 KB/s');
    assert.equal(formatRate(1_200_000), '1.2 MB/s');
    assert.equal(formatRate(2_500_000_000), '2.50 GB/s');
});

const ROUTES = [
    'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
    'wlo1\t00000000\t0164A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0',
    'wlo1\t0064A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0',
    'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
    'eno3\t0000FEA9\t00000000\t0001\t0\t0\t1000\t0000FFFF\t0\t0\t0',
].join('\n');

test('interfacesWithIpv4 lists the interfaces that have a route', () => {
    assert.deepEqual([...interfacesWithIpv4(ROUTES)].sort(), ['docker0', 'wlo1']);
});

test('interfacesWithIpv4 ignores link-local routes and the header', () => {
    assert.equal(interfacesWithIpv4(ROUTES).has('eno3'), false);
    assert.equal(interfacesWithIpv4(ROUTES).has('Iface'), false);
});

test('interfacesWithIpv4 returns an empty set for empty or garbage input', () => {
    assert.equal(interfacesWithIpv4('').size, 0);
    assert.equal(interfacesWithIpv4('header only\n').size, 0);
});

test('isConnected needs the link up and an IPv4 route', () => {
    assert.equal(isConnected('up', true), true);
    assert.equal(isConnected('up', false), false); // link up, turned off from the menu
    assert.equal(isConnected('down', true), false);
    assert.equal(isConnected('down', false), false);
    assert.equal(isConnected('unknown', true), true);
});

test('isConnected falls back to the link state when routes are unknown', () => {
    assert.equal(isConnected('up'), true);
    assert.equal(isConnected('up', null), true);
    assert.equal(isConnected('down', null), false);
});

test('summarize sums only the connected interfaces', () => {
    const group = [
        { connected: true, rxRate: 1000, txRate: 100 },
        { connected: true, rxRate: 500, txRate: 50 },
        { connected: false, rxRate: 9999, txRate: 9999 },
    ];
    assert.deepEqual(summarize(group), { up: true, rxRate: 1500, txRate: 150 });
});

test('summarize reports down when nothing is connected and null rates before data', () => {
    assert.deepEqual(summarize([{ connected: false, rxRate: 1, txRate: 1 }]), {
        up: false,
        rxRate: null,
        txRate: null,
    });
    assert.deepEqual(summarize([]), { up: false, rxRate: null, txRate: null });
    assert.deepEqual(summarize([{ connected: true, rxRate: null, txRate: null }]), {
        up: true,
        rxRate: null,
        txRate: null,
    });
});
