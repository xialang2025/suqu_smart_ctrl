//20261110-7 add - Exercise continuous records and independent clear through the public facade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';
import { createSystem } from './system.mjs';

/******************************************************************************
 * Function Name   : readyWindows
 * Description     : Open real control state and expose only the external notification boundary.
 * Input Parameters: None
 * Return Value    : Application, system and current connection.
 * Date            : 2026.11.10
 ******************************************************************************/
async function readyWindows() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let scan;
    let connection;

    await app.start();
    scan = system.calls.find(function scan(call) { return call.method === 'startScan'; });
    system.emit('deviceFound', { scanId: scan.scanId, deviceId: 'AA:01', name: '模块', rssi: -40 });
    await app.connect('AA:01');
    connection = system.calls.find(function connect(call) { return call.method === 'connect'; });
    app.openControl();
    app.setInput('AB');
    return { app, system, connection };
}

/******************************************************************************
 * Function Name   : independentClear
 * Description     : Clear only the selected display without changing input or issuing native operations.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function independentClear() {
    const { app, system, connection } = await readyWindows();
    let count;

    system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [255] });
    await app.send();
    count = system.calls.length;
    app.clearWindow('receive');
    assert.equal(app.state.received.length, 0);
    assert.equal(app.state.sent.length, 1);
    assert.equal(app.state.input, 'AB');
    app.clearWindow('send');
    assert.equal(app.state.sent.length, 0);
    assert.equal(app.state.status, 'ready');
    assert.equal(system.calls.length, count);
    system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [1] });
    assert.equal(app.state.received[0].text, '01');
}

test('两个窗口分别清空，保留输入与连接，不发送任何蓝牙命令', independentClear);

/******************************************************************************
 * Function Name   : boundedContinuousRecords
 * Description     : Retain the latest five hundred records in arrival order and expose eviction separately.
 * Input Parameters: None
 * Return Value    : Promise resolved after sustained receive and send operations.
 * Date            : 2026.11.10
 ******************************************************************************/
async function boundedContinuousRecords() {
    const { app, system, connection } = await readyWindows();

    for (let index = 0; index < 520; index++) {
        system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [index >> 8, index & 255] });
        await app.send();
    }
    assert.equal(app.state.received.length, 500);
    assert.equal(app.state.sent.length, 500);
    assert.equal(app.state.received[0].text, '00 14');
    assert.equal(app.state.received.at(-1).text, '02 07');
    assert.equal(app.state.receivedDropped, 20);
    assert.equal(app.state.sentDropped, 20);
    app.backToDevices();
    app.openControl();
    assert.equal(app.state.received.length, 500);
    app.clearWindow('receive');
    assert.equal(app.state.receivedDropped, 0);
    assert.equal(app.state.sentDropped, 20);
}

test('持续520次收发只保留各自最近500条，显示淘汰数量且切页不重复', boundedContinuousRecords);

/******************************************************************************
 * Function Name   : boundedPreparationAndDeviceSwitch
 * Description     : Bound early notifications and reset eviction counters when ownership changes.
 * Input Parameters: None
 * Return Value    : Promise resolved after delayed subscription and new-device selection.
 * Date            : 2026.11.10
 ******************************************************************************/
async function boundedPreparationAndDeviceSwitch() {
    const { app, system } = await readyWindows();
    const subscribe = system.platform.subscribe;
    let finish;
    let pending;
    let connection;
    let scan;

    await app.disconnect();
    system.platform.subscribe = function subscribe() { return new Promise(function wait(resolve) { finish = resolve; }); };
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    connection = system.calls.filter(function connect(call) { return call.method === 'connect'; }).at(-1);
    for (let index = 0; index < 520; index++) {
        system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [index & 255] });
    }
    try {
        assert.equal(app.state.receivedDropped, 20);
    } finally {
        finish({});
        await pending;
    }
    assert.equal(app.state.received.length, 500);
    await app.disconnect();
    await app.start();
    scan = system.calls.filter(function scan(call) { return call.method === 'startScan'; }).at(-1);
    system.emit('deviceFound', { scanId: scan.scanId, deviceId: 'AA:02', name: '新模块', rssi: -50 });
    system.platform.subscribe = subscribe;
    await app.connect('AA:02');
    assert.equal(app.state.receivedDropped, 0);
    assert.equal(app.state.sentDropped, 0);
    assert.equal(app.state.received.length, 0);
}

test('准备期间提前通知同样有上限，换设备后淘汰提示与记录重新开始', boundedPreparationAndDeviceSwitch);
