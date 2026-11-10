//20261110-3 add - Drive actual manual sending through the public application facade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';
import { createSystem } from './system.mjs';

/******************************************************************************
 * Function Name   : readySystem
 * Description     : Reach readiness using real application startup and connection operations.
 * Input Parameters: options
 * Return Value    : Application and controllable operating-system boundary.
 * Date            : 2026.11.10
 ******************************************************************************/
async function readySystem(options = {}) {
    const system = createSystem(options);
    const app = createApplication(system.platform, system.clock);
    let scanId;

    await app.start();
    scanId = system.calls.find(function scan(call) { return call.method === 'startScan'; }).scanId;
    system.emit('deviceFound', { scanId, deviceId: 'AA:01', name: '模块', rssi: -50 });
    await app.connect('AA:01');
    app.openControl();
    return { system, app };
}

/******************************************************************************
 * Function Name   : sendRawBytes
 * Description     : Send mixed-case spaced hexadecimal without adding protocol bytes.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function sendRawBytes() {
    const { system, app } = await readySystem();
    let writes;

    app.setInput('00 01 7f\n80 ff');
    await app.send();
    writes = system.calls.filter(function write(call) { return call.method === 'write'; });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].value, [0, 1, 127, 128, 255]);
    assert.equal(writes[0].serviceId, 'FFE0');
    assert.equal(writes[0].characteristicId, 'FFE1');
    assert.equal(app.state.input, '00 01 7f\n80 ff');
    assert.equal(app.state.sent[0].text, '00 01 7F 80 FF');
    assert.equal(app.state.sent[0].length, 5);
    assert.equal(app.state.sent[0].status, 'success');
    assert.equal(app.state.received.length, 0);
}

test('手动发送精确原始字节，不加协议内容且保留输入与独立发送记录', sendRawBytes);

/******************************************************************************
 * Function Name   : rejectInvalidInput
 * Description     : Refuse empty, nonhexadecimal and incomplete bytes before the native boundary.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function rejectInvalidInput() {
    const { system, app } = await readySystem();
    const invalid = ['', ' \n ', '0', '001', '0G', '0x01', '01,02', '-01'];
    let value;

    for (value of invalid) {
        app.setInput(value);
        await app.send();
    }
    assert.equal(system.calls.filter(function write(call) { return call.method === 'write'; }).length, 0);
    assert.equal(app.state.sent.length, 0);
    assert.match(app.state.message, /十六进制|字节|不能为空/);
}

test('空输入、非法字符和残缺字节全部拒发，不补零或截断', rejectInvalidInput);

/******************************************************************************
 * Function Name   : honorActualWriteLength
 * Description     : Accept the exact negotiated payload boundary and reject the next byte without splitting.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function honorActualWriteLength() {
    const { system, app } = await readySystem();
    let writes;

    app.setInput('FF'.repeat(20));
    await app.send();
    app.setInput('FF'.repeat(21));
    await app.send();
    writes = system.calls.filter(function write(call) { return call.method === 'write'; });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].value.length, 20);
    assert.match(app.state.message, /20.*字节/);
}

test('实际MTU为23时最多单次发送20字节，超过拒发且不拆包', honorActualWriteLength);

/******************************************************************************
 * Function Name   : singleWriteInFlight
 * Description     : Reject rapid repeated submissions until the current native write settles.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions and boundary cleanup.
 * Date            : 2026.11.10
 ******************************************************************************/
async function singleWriteInFlight() {
    const { system, app } = await readySystem();
    const finish = [];
    let first;
    let second;

    system.platform.write = function write(value) {
        system.calls.push({ method: 'write', ...value });
        return new Promise(function pending(resolve) { finish.push(resolve); });
    };
    app.setInput('01');
    first = app.send();
    second = app.send();
    try {
        assert.equal(system.calls.filter(function write(call) { return call.method === 'write'; }).length, 1);
        assert.equal(app.state.sending, true);
    } finally {
        finish.forEach(function done(resolve) { resolve({}); });
        await Promise.all([first, second]);
    }
    assert.equal(app.state.sending, false);
    assert.equal(app.state.sent.length, 1);
}

test('快速连点只提交一笔写入，完成之前不能再次发送', singleWriteInFlight);

/******************************************************************************
 * Function Name   : refuseWithoutReadiness
 * Description     : Do not create a send attempt after the connection loses eligibility.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function refuseWithoutReadiness() {
    const { system, app } = await readySystem();
    const connection = system.calls.find(function connect(call) { return call.method === 'connect'; });

    system.emit('connectionChanged', { ...connection, connected: false });
    app.setInput('01');
    await app.send();
    assert.equal(system.calls.filter(function write(call) { return call.method === 'write'; }).length, 0);
    assert.equal(app.state.sent.length, 0);
    assert.match(app.state.message, /未就绪|已断开/);
}

test('设备失去就绪后不发出写入，也不伪造发送记录', refuseWithoutReadiness);

/******************************************************************************
 * Function Name   : distinguishUnknownResult
 * Description     : Separate explicit rejection from uncertain delivery without automatic retries.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function distinguishUnknownResult() {
    const { system, app } = await readySystem();
    let attempts = 0;

    system.platform.write = async function failWrite() {
        const error = new Error(attempts === 0 ? '系统拒绝写入' : '等待结果超时');

        error.code = attempts++ === 0 ? 'rejected' : 'unknown';
        throw error;
    };
    app.setInput('01');
    await app.send();
    assert.equal(app.state.sent[0].status, 'failed');
    await app.send();
    assert.equal(app.state.sent[1].status, 'unknown');
    assert.match(app.state.message, /未自动重发/);
    assert.equal(attempts, 2);
    assert.equal(app.state.sending, false);
}

test('明确拒绝记失败，不明确结果记未知，应用不会自动重发', distinguishUnknownResult);

/******************************************************************************
 * Function Name   : honorWriteWithoutResponseCapability
 * Description     : Preserve the selected write capability rather than forcing a response-only channel.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function honorWriteWithoutResponseCapability() {
    const { system, app } = await readySystem({ services: [{ uuid: 'FFE0', characteristics: [
        { uuid: 'FFE1', properties: { writeNoResponse: true } },
        { uuid: 'FFE2', properties: { notify: true } },
    ] }] });
    let request;

    app.setInput('FF');
    await app.send();
    request = system.calls.find(function write(call) { return call.method === 'write'; });
    assert.equal(request.writeNoResponse, true);
    assert.deepEqual(request.value, [255]);
    assert.equal(app.state.sent[0].status, 'success');
}

test('目标仅支持无响应写入时仍按真实能力发送，不强制错误类型', honorWriteWithoutResponseCapability);
