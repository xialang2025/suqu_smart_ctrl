//20261110-0 add - Use only the native transport as a system-boundary substitute.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';
import { createNativePlatform } from '../common/native-platform.js';

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
