//20261110-2 add - Verify connection readiness through public application operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';
import { createSystem } from './system.mjs';

/******************************************************************************
 * Function Name   : readyBeforeEntering
 * Description     : Keep the device page until notification preparation succeeds and the user enters.
 * Input Parameters: None
 * Return Value    : Promise resolved after connection assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function readyBeforeEntering() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let finishSubscribe;
    let pending;
    let scanId;

    system.platform.subscribe = function subscribe(value) {
        system.calls.push({ method: 'subscribe', ...value });
        return new Promise(function wait(resolve) { finishSubscribe = resolve; });
    };
    await app.start();
    scanId = system.calls.find(function scan(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: '目标模块', rssi: -50 });
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    assert.equal(app.state.status, 'connecting');
    assert.equal(app.state.page, 'devices');
    assert.equal(app.state.scanning, false);
    app.openControl();
    assert.equal(app.state.page, 'devices');
    finishSubscribe({});
    await pending;
    assert.equal(app.state.status, 'ready');
    assert.equal(app.state.page, 'devices');
    app.openControl();
    assert.equal(app.state.page, 'control');
    assert.equal(app.state.currentDevice.deviceId, 'AA:01');
}

test('完成接收准备后仍停留设备页，用户再次操作才进入控制页面', readyBeforeEntering);

/******************************************************************************
 * Function Name   : rejectIncompatibleProfile
 * Description     : Refuse readiness and release the connection when the target profile is absent.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function rejectIncompatibleProfile() {
    const system = createSystem({ services: [{ uuid: 'AA00', characteristics: [] }] });
    const app = createApplication(system.platform, system.clock);
    let scanId;

    await app.start();
    scanId = system.calls.find(function scan(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: '不兼容模块', rssi: -50 });
    await app.connect('AA:01');
    assert.equal(app.state.status, 'disconnected');
    assert.match(app.state.message, /暂不支持该设备/);
    assert.equal(system.calls.filter(function subscribe(call) { return call.method === 'subscribe'; }).length, 0);
    assert.equal(system.calls.filter(function disconnect(call) { return call.method === 'disconnect'; }).length, 1);
    app.openControl();
    assert.equal(app.state.page, 'devices');
}

test('收发通道不匹配时释放连接，不随意试发或进入控制页面', rejectIncompatibleProfile);

/******************************************************************************
 * Function Name   : receiveBeforeEntering
 * Description     : Preserve real notification fragments across navigation and reject unrelated channels.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function receiveBeforeEntering() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let scanId;
    let connection;

    await app.start();
    scanId = system.calls.find(function scan(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: '模块', rssi: -50 });
    await app.connect('AA:01');
    connection = system.calls.find(function connect(call) { return call.method === 'connect'; });
    system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [0, 255] });
    system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE1', value: [99] });
    system.emit('notification', { ...connection, deviceId: 'AA:02', serviceId: 'FFE0', characteristicId: 'FFE2', value: [99] });
    system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [1, 3, 4] });
    assert.equal(app.state.page, 'devices');
    assert.equal(app.state.received.length, 2);
    assert.equal(app.state.received[0].text, '00 FF');
    assert.equal(app.state.received[0].length, 2);
    app.openControl();
    app.backToDevices();
    app.openControl();
    assert.deepEqual(app.state.received.map(function text(record) { return record.text; }), ['00 FF', '01 03 04']);
    assert.equal(system.calls.filter(function connect(call) { return call.method === 'connect'; }).length, 1);
}

test('进入控制页面前的接收片段保留，无关通道或设备不能混入', receiveBeforeEntering);

/******************************************************************************
 * Function Name   : failedSubscriptionAndSingleDevice
 * Description     : Reject failed receive preparation and prevent another device from taking over.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function failedSubscriptionAndSingleDevice() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    const subscribe = system.platform.subscribe;
    let scanId;

    await app.start();
    scanId = system.calls.find(function scan(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: '模块一', rssi: -50 });
    system.emit('deviceFound', { scanId, deviceId: 'AA:02', name: '模块二', rssi: -60 });
    system.platform.subscribe = async function fail() { throw new Error('接收通知开启失败'); };
    await app.connect('AA:01');
    assert.equal(app.state.status, 'disconnected');
    assert.match(app.state.message, /接收通知开启失败/);
    assert.equal(app.state.target, null);
    system.platform.subscribe = subscribe;
    await app.connect('AA:01');
    await app.connect('AA:02');
    assert.equal(app.state.currentDevice.deviceId, 'AA:01');
    assert.equal(system.calls.filter(function second(call) { return call.method === 'connect' && call.deviceId === 'AA:02'; }).length, 0);
}

test('订阅失败不显示就绪，已有就绪设备时另一设备不能抢占', failedSubscriptionAndSingleDevice);

/******************************************************************************
 * Function Name   : revokeReadinessOnLinkLoss
 * Description     : Prevent entry into control after the operating system reports connection loss.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function revokeReadinessOnLinkLoss() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let scanId;
    let connection;

    await app.start();
    scanId = system.calls.find(function scan(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: '模块', rssi: -50 });
    await app.connect('AA:01');
    connection = system.calls.find(function connect(call) { return call.method === 'connect'; });
    system.emit('connectionChanged', { ...connection, connected: false });
    assert.equal(app.state.status, 'disconnected');
    assert.equal(app.state.target, null);
    app.openControl();
    assert.equal(app.state.page, 'devices');
}

test('系统报告链路断开后立即撤销就绪，不能再从卡片进入', revokeReadinessOnLinkLoss);
