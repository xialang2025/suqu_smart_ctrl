//20261110-10 change - Use eligible VG device names in existing behavioral scenarios.
//20261110-6 add - Exercise lifecycle through public application operations and host events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';
import { createSystem } from './system.mjs';

/******************************************************************************
 * Function Name   : readyApplication
 * Description     : Connect a discovered target through the real application facade.
 * Input Parameters: None
 * Return Value    : Application and system fixture.
 * Date            : 2026.11.10
 ******************************************************************************/
async function readyApplication() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let scan;

    await app.start();
    scan = system.calls.find(function scan(call) { return call.method === 'startScan'; });
    system.emit('deviceFound', { scanId: scan.scanId, deviceId: 'AA:01', name: 'VG模块', rssi: -40 });
    await app.connect('AA:01');
    app.openControl();
    app.setInput('01');
    return { app, system };
}

/******************************************************************************
 * Function Name   : backNavigatesThenExits
 * Description     : Preserve the control session on first back and revoke it before host exit on second back.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function backNavigatesThenExits() {
    const { app, system } = await readyApplication();

    system.platform.exit = async function exit() { system.calls.push({ method: 'exit' }); };
    system.emit('back', {});
    assert.equal(app.state.page, 'devices');
    assert.equal(app.state.status, 'ready');
    assert.equal(app.state.input, '01');
    system.emit('back', {});
    await new Promise(setImmediate);
    assert.equal(app.state.status, 'exiting');
    assert.equal(app.state.target, null);
    await app.send();
    assert.equal(system.calls.filter(function write(call) { return call.method === 'write'; }).length, 0);
    assert.equal(system.calls.filter(function exit(call) { return call.method === 'exit'; }).length, 1);
}

test('安卓返回先保留会话回设备页，再撤销通信并交给宿主退出', backNavigatesThenExits);

/******************************************************************************
 * Function Name   : resumeRequiresFreshPreparation
 * Description     : Block writes until the foreground link and receive subscription are verified again.
 * Input Parameters: None
 * Return Value    : Promise resolved after foreground verification.
 * Date            : 2026.11.10
 ******************************************************************************/
async function resumeRequiresFreshPreparation() {
    const { app, system } = await readyApplication();
    let verify;

    system.platform.verify = function verifyConnection(value) {
        system.calls.push({ method: 'verify', ...value });
        return new Promise(function wait(resolve) { verify = resolve; });
    };
    system.emit('lifecycle', { foreground: false });
    await app.send();
    assert.equal(system.calls.filter(function write(call) { return call.method === 'write'; }).length, 0);
    system.emit('lifecycle', { foreground: true });
    assert.equal(app.state.status, 'checking');
    await app.send();
    assert.equal(system.calls.filter(function write(call) { return call.method === 'write'; }).length, 0);
    verify({ ready: true });
    await new Promise(setImmediate);
    assert.equal(app.state.status, 'ready');
    await app.send();
    assert.equal(app.state.sent[0].status, 'success');
    assert.equal(system.calls.filter(function connect(call) { return call.method === 'connect'; }).length, 1);
}

test('后台和前台核实期间拒发，真实连接及接收准备核实成功后才恢复发送', resumeRequiresFreshPreparation);

/******************************************************************************
 * Function Name   : repeatedForegroundKeepsVerification
 * Description     : Ignore duplicate foreground events without stranding the active readiness check.
 * Input Parameters: None
 * Return Value    : Promise resolved after delayed verification.
 * Date            : 2026.11.10
 ******************************************************************************/
async function repeatedForegroundKeepsVerification() {
    const { app, system } = await readyApplication();
    let finish;

    system.platform.verify = function verify() { return new Promise(function wait(resolve) { finish = resolve; }); };
    system.emit('lifecycle', { foreground: false });
    system.emit('lifecycle', { foreground: true });
    system.emit('lifecycle', { foreground: true });
    finish({ ready: true });
    await new Promise(setImmediate);
    assert.equal(app.state.status, 'ready');
}

test('重复前台事件不能使正在核实的会话永久等待', repeatedForegroundKeepsVerification);

/******************************************************************************
 * Function Name   : exitDuringInitialization
 * Description     : Refuse a late initialization result after the user has already exited.
 * Input Parameters: None
 * Return Value    : Promise resolved after the obsolete result.
 * Date            : 2026.11.10
 ******************************************************************************/
async function exitDuringInitialization() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let finish;
    let pending;

    system.platform.initialize = function initialize() { return new Promise(function wait(resolve) { finish = resolve; }); };
    system.platform.exit = async function exit() {};
    pending = app.start();
    system.emit('back', {});
    finish({ available: true });
    await pending;
    assert.equal(app.state.status, 'exiting');
    assert.equal(system.calls.some(function scan(call) { return call.method === 'startScan'; }), false);
}

test('权限初始化期间退出，迟到初始化不能重新开始扫描', exitDuringInitialization);

/******************************************************************************
 * Function Name   : invalidForegroundCannotRestore
 * Description     : Keep records while rejecting lost links, expired checks and late results after release.
 * Input Parameters: None
 * Return Value    : Promise resolved after all system-event scenarios.
 * Date            : 2026.11.10
 ******************************************************************************/
async function invalidForegroundCannotRestore() {
    let fixture;
    let finish;
    let connection;

    for (const reason of ['invalid', 'timeout', 'lost', 'disconnect']) {
        fixture = await readyApplication();
        connection = fixture.system.calls.find(function connect(call) { return call.method === 'connect'; });
        fixture.system.emit('notification', { ...connection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [255] });
        fixture.system.platform.verify = function verify() { return new Promise(function wait(resolve) { finish = resolve; }); };
        fixture.system.emit('lifecycle', { foreground: false });
        fixture.system.emit('lifecycle', { foreground: true });
        if (reason === 'invalid') {
            finish({ ready: false });
        } else if (reason === 'timeout') {
            await fixture.system.advance(6000);
        } else if (reason === 'lost') {
            fixture.system.emit('connectionChanged', { ...connection, connected: false });
        } else {
            await fixture.app.disconnect();
        }
        await new Promise(setImmediate);
        finish({ ready: true });
        await new Promise(setImmediate);
        assert.equal(fixture.app.state.status, 'disconnected', reason);
        assert.equal(fixture.app.state.received[0].text, 'FF');
        assert.equal(fixture.app.state.input, '01');
        await fixture.app.send();
        assert.equal(fixture.system.calls.some(function write(call) { return call.method === 'write'; }), false);
    }
}

test('前台核实失败超时断线或主动断开，保留数据且迟到核实不能恢复发送', invalidForegroundCannotRestore);

/******************************************************************************
 * Function Name   : coldApplicationStartsClean
 * Description     : Create a fresh process-level facade without restoring former communication state.
 * Input Parameters: None
 * Return Value    : Promise resolved after clean startup.
 * Date            : 2026.11.10
 ******************************************************************************/
async function coldApplicationStartsClean() {
    const previous = await readyApplication();
    const system = createSystem();
    const next = createApplication(system.platform, system.clock);

    await previous.app.send();
    await next.start();
    assert.equal(next.state.page, 'devices');
    assert.equal(next.state.currentDevice, null);
    assert.equal(next.state.input, '');
    assert.deepEqual(next.state.sent, []);
    assert.deepEqual(next.state.received, []);
    assert.equal(system.calls.some(function connection(call) { return ['connect', 'write'].includes(call.method); }), false);
}

test('新进程从干净设备页开始，不恢复输入记录连接或待发送任务', coldApplicationStartsClean);
