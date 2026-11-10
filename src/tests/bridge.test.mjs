//20261110-10 change - Use eligible VG device names in existing behavioral scenarios.
//20261110-0 add - Use only the native transport as a system-boundary substitute.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';
import { createNativePlatform } from '../common/native-platform.js';
import { createSystem } from './system.mjs';

/******************************************************************************
 * Function Name   : startupAcrossNativeBridge
 * Description     : Run application startup through the real native JSON bridge.
 * Input Parameters: None
 * Return Value    : Promise resolved after the platform response is observed.
 * Date            : 2026.11.10
 ******************************************************************************/
async function startupAcrossNativeBridge() {
    const packets = [];
    const host = {};
    const transport = { postMessage: function (packet) {
        const value = JSON.parse(packet);
        packets.push(value);
        if (value.method === 'startScan' || value.method === 'stopScan') {
            queueMicrotask(function respond() { host.__suquReply(value.id, true, {}); });
        }
    } };
    const platform = createNativePlatform(transport, host);
    const app = createApplication(platform);
    const pending = app.start();

    assert.equal(packets[0].method, 'initialize');
    host.__suquReply(packets[0].id, true, { available: true, message: '蓝牙已开启' });
    await pending;
    assert.equal(app.state.page, 'devices');
    assert.equal(app.state.status, 'idle');
    assert.equal(app.state.scanning, true); //20261110-1 change - Startup now discovers automatically after the real reply.
    await app.stopScan();
}

test('原生初始化回包驱动真实应用状态，链路可用不等于设备就绪', startupAcrossNativeBridge);

/******************************************************************************
 * Function Name   : bridgeRespectsApplicationDeadline
 * Description     : Keep a real bridge connection pending until the application's total deadline.
 * Input Parameters: None
 * Return Value    : Promise resolved after native-boundary cleanup.
 * Date            : 2026.11.10
 ******************************************************************************/
async function bridgeRespectsApplicationDeadline() {
    const system = createSystem();
    const host = {};
    const packets = [];
    const transport = { postMessage: function postMessage(text) {
        const packet = JSON.parse(text);

        packets.push(packet);
        if (packet.method !== 'connect') {
            queueMicrotask(function respond() { host.__suquReply(packet.id, true, packet.method === 'initialize' ? { available: true } : {}); });
        }
    } };
    const platform = createNativePlatform(transport, host, system.clock);
    const app = createApplication(platform, system.clock);
    let scanId;
    let pending;
    let connecting;

    await app.start();
    scanId = packets.find(function scan(packet) { return packet.method === 'startScan'; }).options.scanId;
    host.__suquEvent('deviceFound', { scanId, deviceId: 'AA:01', name: 'VG模块', rssi: -50 });
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    await system.advance(15000);
    try {
        assert.equal(app.state.status, 'connecting', '桥接层不能在20秒总准备期限之前先行判超时');
    } finally {
        await app.cancelConnection();
        connecting = packets.find(function connect(packet) { return packet.method === 'connect'; });
        host.__suquReply(connecting.id, false, { code: 'connection', message: '已结束' });
        await pending;
    }
}

test('真实桥接层不会在15秒提前终止20秒准备窗口', bridgeRespectsApplicationDeadline);
