//20261110-10 change - Use eligible VG device names in existing behavioral scenarios.
//20261110-5 add - Verify cancellation and time at the public operation boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';
import { createSystem } from './system.mjs';

/******************************************************************************
 * Function Name   : discoveredSystem
 * Description     : Reach a discovered target using the actual application path.
 * Input Parameters: None
 * Return Value    : Application and operating-system boundary.
 * Date            : 2026.11.10
 ******************************************************************************/
async function discoveredSystem() {
    const system = createSystem();
    const app = createApplication(system.platform, system.clock);
    let scanId;

    await app.start();
    scanId = system.calls.find(function scan(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: 'VG模块', rssi: -50 });
    return { system, app };
}

/******************************************************************************
 * Function Name   : cancelPendingConnection
 * Description     : Cancel a pending connection and refuse a later successful preparation result.
 * Input Parameters: None
 * Return Value    : Promise resolved after boundary completion.
 * Date            : 2026.11.10
 ******************************************************************************/
async function cancelPendingConnection() {
    const { system, app } = await discoveredSystem();
    let finish;
    let pending;

    system.platform.connect = function connect(value) {
        system.calls.push({ method: 'connect', ...value });
        return new Promise(function wait(resolve) { finish = resolve; });
    };
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    await app.cancelConnection();
    assert.equal(app.state.status, 'disconnected');
    assert.match(app.state.message, /已取消/);
    finish({ mtu: 23, services: [] });
    await pending;
    assert.equal(app.state.status, 'disconnected');
    assert.equal(app.state.target, null);
}

test('连接中可取消，迟到成功不能重新恢复已就绪状态', cancelPendingConnection);

/******************************************************************************
 * Function Name   : totalPreparationDeadline
 * Description     : Include notification preparation in the same twenty-second deadline.
 * Input Parameters: None
 * Return Value    : Promise resolved after expiry and stale boundary completion.
 * Date            : 2026.11.10
 ******************************************************************************/
async function totalPreparationDeadline() {
    const { system, app } = await discoveredSystem();
    let finishSubscribe;
    let pending;

    system.platform.subscribe = function subscribe(value) {
        system.calls.push({ method: 'subscribe', ...value });
        return new Promise(function wait(resolve) { finishSubscribe = resolve; });
    };
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    await system.advance(19999);
    assert.equal(app.state.status, 'connecting');
    await system.advance(1);
    assert.equal(app.state.status, 'disconnected');
    assert.match(app.state.message, /准备超时/);
    finishSubscribe({});
    await pending;
    assert.equal(app.state.status, 'disconnected');
    assert.equal(system.calls.filter(function connect(call) { return call.method === 'connect'; }).length, 1);
}

test('建链后的接收准备也计入20秒总超时，超时不自动重连', totalPreparationDeadline);

/******************************************************************************
 * Function Name   : cancellationCompletesWithoutLateReply
 * Description     : Resolve the cancelled public operation even if its old native reply never arrives.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions and fixture cleanup.
 * Date            : 2026.11.10
 ******************************************************************************/
async function cancellationCompletesWithoutLateReply() {
    const { system, app } = await discoveredSystem();
    let finish;
    let pending;
    let ended;

    system.platform.connect = function connect() {
        return new Promise(function wait(resolve) { finish = resolve; });
    };
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    await app.cancelConnection();
    ended = await Promise.race([pending.then(function done() { return true; }),
        new Promise(function nextTurn(resolve) { setImmediate(function waiting() { resolve(false); }); })]);
    try {
        assert.equal(ended, true, '取消完成后公开操作不能继续等待丢失的旧回包');
    } finally {
        finish({ mtu: 23, services: [] });
        await pending;
    }
}

test('取消完成即结束公开操作，不需要等待可能永远丢失的旧回包', cancellationCompletesWithoutLateReply);

/******************************************************************************
 * Function Name   : lostWriteResultExpires
 * Description     : End uncertain delivery and release the connection when no write reply arrives.
 * Input Parameters: None
 * Return Value    : Promise resolved after stale result cleanup.
 * Date            : 2026.11.10
 ******************************************************************************/
async function lostWriteResultExpires() {
    const { system, app } = await discoveredSystem();
    let finish;
    let pending;
    let ended;

    await app.connect('AA:01');
    system.platform.write = function write(value) {
        system.calls.push({ method: 'write', ...value });
        return new Promise(function wait(resolve) { finish = resolve; });
    };
    app.setInput('01');
    pending = app.send();
    await system.advance(4999);
    assert.equal(app.state.sending, true);
    await system.advance(1);
    try {
        assert.equal(app.state.sent[0].status, 'unknown');
        assert.equal(app.state.sending, false);
        assert.equal(app.state.status, 'disconnected');
        assert.match(app.state.message, /未自动重发/);
        ended = await Promise.race([pending.then(function done() { return true; }),
            new Promise(function nextTurn(resolve) { setImmediate(function waiting() { resolve(false); }); })]);
        assert.equal(ended, true);
        assert.equal(system.calls.filter(function write(call) { return call.method === 'write'; }).length, 1);
    } finally {
        finish({});
        await pending;
    }
    assert.equal(app.state.sent[0].status, 'unknown');
}

test('写入结果丢失5秒后标未知并释放连接，不阻塞操作也不自动重发', lostWriteResultExpires);

/******************************************************************************
 * Function Name   : totalDeadlineIncludesScanShutdown
 * Description     : Stop the whole attempt even when the preceding scan-shutdown reply is lost.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions and stale failure delivery.
 * Date            : 2026.11.10
 ******************************************************************************/
async function totalDeadlineIncludesScanShutdown() {
    const { system, app } = await discoveredSystem();
    let failStop;
    let pending;

    system.platform.stopScan = function stopScan() {
        return new Promise(function wait(resolve, reject) { failStop = reject; });
    };
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    await system.advance(20000);
    await pending;
    assert.equal(app.state.status, 'disconnected');
    assert.match(app.state.message, /准备超时/);
    assert.equal(system.calls.filter(function connect(call) { return call.method === 'connect'; }).length, 0);
    failStop(new Error('旧停止回包迟到失败'));
    await new Promise(setImmediate);
    assert.match(app.state.message, /准备超时/);
}

test('停止扫描阶段也受同一总超时保护，旧停止失败不能覆盖结束原因', totalDeadlineIncludesScanShutdown);

/******************************************************************************
 * Function Name   : cancelledSubscribeCannotRestoreNewAttempt
 * Description     : Preserve a newer ready connection after the cancelled descriptor operation returns.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function cancelledSubscribeCannotRestoreNewAttempt() {
    const { system, app } = await discoveredSystem();
    const subscribe = system.platform.subscribe;
    let finishOld;
    let pending;
    let current;

    system.platform.subscribe = function hold() {
        return new Promise(function wait(resolve) { finishOld = resolve; });
    };
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    await app.cancelConnection();
    await pending;
    system.platform.subscribe = subscribe;
    await app.connect('AA:01');
    current = app.state.connectionId;
    finishOld({});
    await new Promise(setImmediate);
    assert.equal(app.state.connectionId, current);
    assert.equal(app.state.status, 'ready');
    assert.equal(system.calls.filter(function connect(call) { return call.method === 'connect'; }).length, 2);
}

test('取消后手动重试成功，旧订阅迟到不能覆盖新一轮状态', cancelledSubscribeCannotRestoreNewAttempt);

/******************************************************************************
 * Function Name   : systemLossKeepsUnknownWarning
 * Description     : Preserve the uncertain-delivery warning across consecutive native loss events.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions and stale completion.
 * Date            : 2026.11.10
 ******************************************************************************/
async function systemLossKeepsUnknownWarning() {
    const { system, app } = await discoveredSystem();
    let finish;
    let pending;
    let connection;

    await app.connect('AA:01');
    connection = system.calls.find(function connect(call) { return call.method === 'connect'; });
    system.platform.write = function write() { return new Promise(function wait(resolve) { finish = resolve; }); };
    app.setInput('01');
    pending = app.send();
    system.emit('connectionChanged', { ...connection, connected: false, message: '设备连接已断开' });
    system.emit('adapterState', { available: false, message: '系统蓝牙已关闭' });
    await pending;
    assert.equal(app.state.sent[0].status, 'unknown');
    assert.match(app.state.message, /结果未知.*未自动重发/);
    finish({});
    await new Promise(setImmediate);
    assert.equal(app.state.sent[0].status, 'unknown');
}

test('写入中接连收到断线和蓝牙关闭，仍明确提示未知且未自动重发', systemLossKeepsUnknownWarning);

/******************************************************************************
 * Function Name   : pendingReleaseCannotBeBypassed
 * Description     : A system state change must not allow new discovery before old release is confirmed.
 * Input Parameters: None
 * Return Value    : Promise resolved after release and stale completion cleanup.
 * Date            : 2026.11.10
 ******************************************************************************/
async function pendingReleaseCannotBeBypassed() {
    const { system, app } = await discoveredSystem();
    let finishConnect;
    let finishRelease;
    let preparing;
    let cancelling;

    system.platform.connect = function connect() { return new Promise(function wait(resolve) { finishConnect = resolve; }); };
    system.platform.disconnect = function disconnect() { return new Promise(function wait(resolve) { finishRelease = resolve; }); };
    preparing = app.connect('AA:01');
    await new Promise(setImmediate);
    cancelling = app.cancelConnection();
    system.emit('adapterState', { available: false });
    await app.start();
    try {
        assert.equal(system.calls.filter(function init(call) { return call.method === 'initialize'; }).length, 1);
        assert.equal(app.state.scanning, false);
    } finally {
        finishRelease({});
        await cancelling;
        finishConnect({ mtu: 23, services: [] });
        await preparing;
    }
}

test('蓝牙状态变化也不能绕过尚未确认的旧连接释放', pendingReleaseCannotBeBypassed);

/******************************************************************************
 * Function Name   : unknownReplyRetiresConnection
 * Description     : Require manual reconnection after an immediate uncertain native write result.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function unknownReplyRetiresConnection() {
    const { system, app } = await discoveredSystem();

    await app.connect('AA:01');
    system.platform.write = async function unknown(value) {
        system.calls.push({ method: 'write', ...value });
        throw Object.assign(new Error('传输结果无法确认'), { code: 'unknown' });
    };
    app.setInput('01');
    await app.send();
    assert.equal(app.state.status, 'disconnected');
    assert.equal(app.state.sent[0].status, 'unknown');
    await app.send();
    assert.equal(system.calls.filter(function write(call) { return call.method === 'write'; }).length, 1);
}

test('直接收到未知写入结果也必须结束旧连接，手动重连前不能再次写入', unknownReplyRetiresConnection);

/******************************************************************************
 * Function Name   : failedPreparationOwnsRelease
 * Description     : Hold eligibility until a failed preparation has released its original native client.
 * Input Parameters: None
 * Return Value    : Promise resolved after delayed release.
 * Date            : 2026.11.10
 ******************************************************************************/
async function failedPreparationOwnsRelease() {
    const { system, app } = await discoveredSystem();
    const releases = [];
    let pending;

    system.platform.subscribe = async function fail() { throw new Error('接收准备失败'); };
    system.platform.disconnect = function disconnect() { return new Promise(function wait(resolve) { releases.push(resolve); }); };
    pending = app.connect('AA:01');
    await new Promise(setImmediate);
    void app.connect('AA:01');
    await new Promise(setImmediate);
    try {
        assert.equal(app.state.status, 'disconnecting');
        assert.equal(system.calls.filter(function connect(call) { return call.method === 'connect'; }).length, 1);
    } finally {
        releases.forEach(function done(resolve) { resolve({}); });
        await pending;
    }
    assert.match(app.state.message, /接收准备失败/);
}

test('准备失败的清理未确认时不能启动新连接，结束原因保持原样', failedPreparationOwnsRelease);
