//20261110-1 add - Verify device discovery through public application operations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';
import { createSystem } from './system.mjs';

/******************************************************************************
 * Function Name   : discoverUnnamedDevice
 * Description     : Start scanning after initialization and render a device with its actual identity.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function discoverUnnamedDevice() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let scan;

    await app.start();
    scan = system.calls.find(function find(call) { return call.method === 'startScan'; });
    assert.ok(scan, '蓝牙条件具备后应自动扫描');
    system.emit('deviceFound', { scanId: scan.scanId, deviceId: 'AA:01', name: '', rssi: -53 });
    assert.equal(app.state.scanning, true);
    assert.equal(app.state.devices[0].deviceId, 'AA:01');
    assert.equal(app.state.devices[0].name, '未命名设备');
    assert.equal(app.state.devices[0].rssi, -53);
}

test('进入设备页自动扫描，无名称模块仍显示地址和信号', discoverUnnamedDevice);

/******************************************************************************
 * Function Name   : updateDeviceIdentity
 * Description     : Update repeated advertisements while distinguishing equal names by address.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function updateDeviceIdentity() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let scanId;

    await app.start();
    scanId = system.calls.find(function find(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'aa:01', name: '改名模块', rssi: -70 });
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: '改名模块', rssi: -40 });
    system.emit('deviceFound', { scanId, deviceId: 'AA:02', name: '改名模块', rssi: -60 });
    assert.equal(app.state.devices.length, 2);
    assert.equal(app.state.devices[0].rssi, -40);
    assert.notEqual(app.state.devices[0].deviceId, app.state.devices[1].deviceId);
}

test('重复广播更新原卡片，同名不同地址的设备分别保留', updateDeviceIdentity);

/******************************************************************************
 * Function Name   : stopDiscoveryAfterWindow
 * Description     : Preserve scan results after the public discovery window expires.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function stopDiscoveryAfterWindow() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let scanId;

    await app.start();
    scanId = system.calls.find(function find(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: '模块', rssi: -50 });
    await system.advance(14999);
    assert.equal(app.state.scanning, true);
    await system.advance(1);
    assert.equal(app.state.scanning, false);
    assert.equal(app.state.devices.length, 1);
    assert.equal(system.calls.filter(function stop(call) { return call.method === 'stopScan'; }).length, 1);
    system.emit('deviceFound', { scanId, deviceId: 'AA:02', name: '迟到模块', rssi: -50 });
    assert.equal(app.state.devices.length, 1);
}

test('扫描约15秒自动停止并保留结果，迟到广播不再添加', stopDiscoveryAfterWindow);

/******************************************************************************
 * Function Name   : retryAfterScanFailure
 * Description     : Recover from a native scan failure without allowing old events into a new scan.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function retryAfterScanFailure() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let oldId;
    let nextId;

    await app.start();
    oldId = system.calls.find(function find(call) { return call.method === 'startScan'; }).scanId;
    system.emit('scanFailed', { scanId: oldId, message: '扫描过于频繁，请稍后重试' });
    assert.equal(app.state.scanning, false);
    assert.match(app.state.message, /扫描过于频繁/);
    await app.scan();
    nextId = system.calls.filter(function find(call) { return call.method === 'startScan'; }).at(-1).scanId;
    system.emit('deviceFound', { scanId: oldId, deviceId: 'AA:01', name: '旧广告', rssi: -50 });
    system.emit('deviceFound', { scanId: nextId, deviceId: 'AA:02', name: '新广告', rssi: -60 });
    assert.deepEqual(app.state.devices.map(function identity(device) { return device.deviceId; }), ['AA:02']);
}

test('扫描失败可重试，重新扫描不接受旧扫描事件', retryAfterScanFailure);

/******************************************************************************
 * Function Name   : recoverPermissionAndAdapter
 * Description     : Avoid scanning without permission and recover through the public retry operation.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function recoverPermissionAndAdapter() {
    const options = { initialization: { available: false, message: '未授予蓝牙权限' } };
    const system = createSystem(options);
    const app = createApplication(system.platform, system.clock);

    await app.start();
    assert.equal(system.calls.filter(function scans(call) { return call.method === 'startScan'; }).length, 0);
    assert.match(app.state.message, /未授予/);
    options.initialization = { available: true };
    await app.start();
    assert.equal(app.state.scanning, true);
    system.emit('adapterState', { available: false });
    assert.equal(app.state.scanning, false);
    await app.scan();
    assert.equal(app.state.scanning, false, '蓝牙已关闭后不能直接绕过条件检查扫描');
}

test('权限拒绝后可重新检查恢复，蓝牙关闭后不可绕过条件发起扫描', recoverPermissionAndAdapter);
