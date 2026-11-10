//20261110-10 change - Use eligible VG device names in existing behavioral scenarios.
//20261110-4 add - Verify device ownership through real public connection and send operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';
import { createSystem } from './system.mjs';

/******************************************************************************
 * Function Name   : twoDevices
 * Description     : Discover two real application identities at the simulated Android boundary.
 * Input Parameters: None
 * Return Value    : Application and system boundary.
 * Date            : 2026.11.10
 ******************************************************************************/
async function twoDevices() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let scanId;

    await app.start();
    scanId = system.calls.find(function scan(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: 'VG设备一', rssi: -50 });
    system.emit('deviceFound', { scanId, deviceId: 'AA:02', name: 'VG设备二', rssi: -60 });
    await app.connect('AA:01');
    return { system, app };
}

/******************************************************************************
 * Function Name   : explicitDisconnect
 * Description     : Preserve data while ending the selected connection through a public operation.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function explicitDisconnect() {
    const { system, app } = await twoDevices();
    const connection = system.calls.find(function connect(call) { return call.method === 'connect'; });

    system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [1] });
    app.setInput('FF');
    await app.send();
    await app.disconnect();
    assert.equal(app.state.status, 'disconnected');
    assert.equal(app.state.target, null);
    assert.equal(app.state.received[0].text, '01');
    assert.equal(app.state.sent[0].text, 'FF');
    assert.equal(app.state.input, 'FF');
    system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [99] });
    assert.equal(app.state.received.length, 1);
    assert.equal(system.calls.filter(function disconnect(call) { return call.method === 'disconnect'; }).length, 1);
}

test('主动断开立即取消就绪并保留已有记录，旧通知不再添加', explicitDisconnect);

/******************************************************************************
 * Function Name   : reconnectSameAndSwitchDevice
 * Description     : Preserve a same-device session with markers and clear data on a new target.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function reconnectSameAndSwitchDevice() {
    const { system, app } = await twoDevices();
    const old = system.calls.find(function connect(call) { return call.method === 'connect'; });

    system.emit('notification', { ...old, serviceId: 'FFE0', characteristicId: 'FFE2', value: [1] });
    app.setInput('FF');
    await app.send();
    system.emit('connectionChanged', { ...old, connected: false });
    await app.connect('AA:01');
    assert.equal(app.state.received[0].text, '01');
    assert.equal(app.state.sent[0].text, 'FF');
    assert.equal(app.state.received.at(-1).type, 'marker');
    assert.equal(app.state.sent.at(-1).type, 'marker');
    await app.disconnect();
    await app.connect('AA:02');
    assert.equal(app.state.currentDevice.deviceId, 'AA:02');
    assert.deepEqual(app.state.received, []);
    assert.deepEqual(app.state.sent, []);
    assert.equal(app.state.input, '');
    system.emit('notification', { ...old, serviceId: 'FFE0', characteristicId: 'FFE2', value: [99] });
    system.emit('connectionChanged', { ...old, connected: false });
    assert.equal(app.state.status, 'ready');
    assert.equal(app.state.received.length, 0);
}

test('同设备重连保留并标记记录，换设备清空且不接受旧事件', reconnectSameAndSwitchDevice);

/******************************************************************************
 * Function Name   : isolateLateWriteFromNewDevice
 * Description     : A late old-device write result must not settle or unlock a new-device write.
 * Input Parameters: None
 * Return Value    : Promise resolved after both boundary operations are released.
 * Date            : 2026.11.10
 ******************************************************************************/
async function isolateLateWriteFromNewDevice() {
    const { system, app } = await twoDevices();
    const finish = [];
    let oldWrite;
    let newWrite;

    system.platform.write = function write(value) {
        system.calls.push({ method: 'write', ...value });
        return new Promise(function wait(resolve) { finish.push(resolve); });
    };
    app.setInput('01');
    oldWrite = app.send();
    await app.disconnect();
    await app.connect('AA:02');
    app.setInput('02');
    newWrite = app.send();
    try {
        assert.equal(finish.length, 2, '旧会话写入不能阻塞新设备的手动发送');
        finish[0]({});
        await oldWrite;
        assert.equal(app.state.sending, true, '旧写入完成不能解锁新的在途写入');
        assert.equal(app.state.sent[0].text, '02');
        assert.equal(app.state.sent[0].status, 'pending');
    } finally {
        finish.forEach(function done(resolve) { resolve({}); });
        await Promise.all([oldWrite, newWrite]);
    }
    assert.equal(app.state.sent[0].status, 'success');
}

test('切换设备后旧写入回调不能结算或解锁新设备发送', isolateLateWriteFromNewDevice);

/******************************************************************************
 * Function Name   : markerBeforeEarlyReconnectData
 * Description     : Place the reconnect boundary before notifications arriving during subscription completion.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function markerBeforeEarlyReconnectData() {
    const { system, app } = await twoDevices();
    const old = system.calls.find(function connect(call) { return call.method === 'connect'; });

    system.emit('notification', { ...old, serviceId: 'FFE0', characteristicId: 'FFE2', value: [1] });
    system.emit('connectionChanged', { ...old, connected: false });
    system.platform.subscribe = async function subscribe(value) {
        system.emit('notification', { ...value, value: [2] });
        return {};
    };
    await app.connect('AA:01');
    assert.deepEqual(app.state.received.map(function type(record) { return record.type; }), ['data', 'marker', 'data']);
    assert.equal(app.state.received.at(-1).text, '02');
}

test('重连订阅期间提前到达的数据排在重连标记之后', markerBeforeEarlyReconnectData);

/******************************************************************************
 * Function Name   : retryUnconfirmedDisconnect
 * Description     : Keep a cleanup failure distinct from release and retry the original native identity.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function retryUnconfirmedDisconnect() {
    const { system, app } = await twoDevices();
    const release = system.platform.disconnect;
    const original = app.state.connectionId;
    let failed = false;

    system.platform.disconnect = async function disconnect(value) {
        if (!failed) {
            failed = true;
            throw new Error('系统未返回确认');
        }
        return release(value);
    };
    await app.disconnect();
    assert.equal(app.state.status, 'disconnect-error');
    await app.connect('AA:02');
    assert.equal(app.state.currentDevice.deviceId, 'AA:01');
    await app.disconnect();
    assert.equal(app.state.status, 'disconnected');
    assert.equal(system.calls.find(function disconnect(call) { return call.method === 'disconnect'; }).connectionId, original);
    await app.connect('AA:02');
    assert.equal(app.state.currentDevice.deviceId, 'AA:02');
}

test('断开未确认时不抢占连接，重试仍释放原来的连接身份', retryUnconfirmedDisconnect);

/******************************************************************************
 * Function Name   : ignoreOldPreparationFailure
 * Description     : A delayed old connection failure cannot revoke the newer device readiness.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function ignoreOldPreparationFailure() {
    const { system, app } = await twoDevices();
    const normal = system.platform.connect;
    const first = system.calls.find(function connect(call) { return call.method === 'connect'; });
    let rejectOld;
    let pending;
    let old;

    system.emit('connectionChanged', { ...first, connected: false });
    system.platform.connect = function connect(value) {
        if (value.deviceId === 'AA:01') {
            system.calls.push({ method: 'connect', ...value });
            return new Promise(function wait(resolve, reject) { rejectOld = reject; });
        }
        return normal(value);
    };
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    old = system.calls.filter(function connect(call) { return call.method === 'connect'; }).at(-1);
    system.emit('connectionChanged', { ...old, connected: false });
    await app.connect('AA:02');
    rejectOld(new Error('旧连接延迟返回失败'));
    await pending;
    assert.equal(app.state.currentDevice.deviceId, 'AA:02');
    assert.equal(app.state.status, 'ready');
    assert.ok(app.state.target);
}

test('旧连接准备的延迟失败不能撤销新设备的就绪状态', ignoreOldPreparationFailure);
