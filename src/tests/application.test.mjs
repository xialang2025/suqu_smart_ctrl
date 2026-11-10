//20261110-0 add - Exercise the application through its public startup operation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../common/application.js';

/******************************************************************************
 * Function Name   : startupReportsUnavailablePlatform
 * Description     : Verify that startup opens the device page and reports the real platform failure.
 * Input Parameters: None
 * Return Value    : Promise resolved after assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function startupReportsUnavailablePlatform() {
    const platform = { initialize: async function () { throw new Error('当前环境不支持蓝牙'); } };
    const app = createApplication(platform);

    await app.start();
    assert.equal(app.state.page, 'devices');
    assert.equal(app.state.status, 'unavailable');
    assert.equal(app.state.message, '当前环境不支持蓝牙');
    assert.deepEqual(app.state.devices, []);
}

test('启动进入设备页，平台不可用时不伪造就绪状态', startupReportsUnavailablePlatform);
