//20261110-0 add - Render the real compiled application in an isolated headless browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.LOCALAPPDATA, 'REA-Android-Tools/browser-tools/node_modules/playwright-core'));

/******************************************************************************
 * Function Name   : renderStartup
 * Description     : Check the actual compiled device page with no native Bluetooth transport.
 * Input Parameters: None
 * Return Value    : Promise resolved after browser verification.
 * Date            : 2026.11.10
 ******************************************************************************/
async function renderStartup() {
    const assets = path.join(root, 'unpackage/h5');
    const errors = [];
    const server = http.createServer(serve);
    let browser;
    let page;

    /******************************************************************************
     * Function Name   : serve
     * Description     : Serve compiled assets on loopback for browser verification.
     * Input Parameters: request, response
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function serve(request, response) {
        const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const file = path.resolve(assets, '.' + (name === '/' ? '/index.html' : name));
        const extension = path.extname(file);

        if (!file.startsWith(assets + path.sep) || !fs.existsSync(file)) {
            response.writeHead(404).end();
            return;
        }
        response.setHeader('Content-Type', extension === '.js' ? 'text/javascript' : extension === '.css' ? 'text/css' : 'text/html');
        response.end(fs.readFileSync(file));
    }

    await new Promise(function listen(resolve) { server.listen(0, '127.0.0.1', resolve); });
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.on('pageerror', function capture(error) { errors.push(error.message); });
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.getByText('当前环境不支持蓝牙，请在安卓应用中使用').waitFor();
        assert.ok(await page.getByText('速驱智控', { exact: true }).isVisible());
        assert.ok(await page.getByText('设备页', { exact: true }).isVisible());
        assert.deepEqual(errors, []);
        fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
        await page.screenshot({ path: path.join(root, 'artifacts/startup.png'), fullPage: true });
    } finally {
        if (browser) {
            await browser.close();
        }
        await new Promise(function close(resolve) { server.close(resolve); });
    }
}

test('编译后的设备页显示真实不可用状态且无页面异常', renderStartup);

/******************************************************************************
 * Function Name   : renderDiscoveredCards
 * Description     : Exercise the compiled page with only the Android transport substituted.
 * Input Parameters: None
 * Return Value    : Promise resolved after card and scan-button assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function renderDiscoveredCards(context, control = false) { //20261110-2 change - Reuse the same external Android boundary for control navigation.
    const assets = path.join(root, 'unpackage/h5');
    const server = http.createServer(function serve(request, response) {
        const name = new URL(request.url, 'http://localhost').pathname;
        const file = path.resolve(assets, '.' + (name === '/' ? '/index.html' : name));

        if (!file.startsWith(assets + path.sep) || !fs.existsSync(file)) {
            response.writeHead(404).end();
            return;
        }
        response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
        response.end(fs.readFileSync(file));
    });
    let browser;
    let page;

    await new Promise(function listen(resolve) { server.listen(0, '127.0.0.1', resolve); });
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.addInitScript(function installSystemBoundary() {
            window.NativeBle = { postMessage: function postMessage(text) {
                const packet = JSON.parse(text);

                queueMicrotask(function reply() {
                    const services = [{ uuid: '0000ffe0-0000-1000-8000-00805f9b34fb', characteristics: [
                        { uuid: '0000ffe1-0000-1000-8000-00805f9b34fb', properties: { write: true } },
                        { uuid: '0000ffe2-0000-1000-8000-00805f9b34fb', properties: { notify: true } },
                    ] }];

                    if (packet.method === 'connect') {
                        window.__testConnection = packet.options;
                    }
                    window.__suquReply(packet.id, true, packet.method === 'initialize' ? { available: true }
                        : packet.method === 'connect' ? { mtu: 23, services } : {});
                    if (packet.method === 'startScan') {
                        window.__suquEvent('deviceFound', { scanId: packet.options.scanId, deviceId: 'AA:01', name: '改名模块', rssi: -70 });
                        window.__suquEvent('deviceFound', { scanId: packet.options.scanId, deviceId: 'AA:01', name: '改名模块', rssi: -40 });
                        window.__suquEvent('deviceFound', { scanId: packet.options.scanId, deviceId: 'AA:02', name: '', rssi: -60 });
                    }
                    if (packet.method === 'subscribe') {
                        window.__suquEvent('notification', { ...window.__testConnection, serviceId: 'FFE0', characteristicId: 'FFE2', value: [0, 255] });
                    }
                });
            } };
        });
        await page.goto('http://127.0.0.1:' + server.address().port);
        await page.locator('[data-device="AA:01"]').waitFor({ timeout: 2000 });
        assert.equal(await page.locator('[data-device]').count(), 2);
        assert.ok(await page.getByText('未命名设备', { exact: true }).isVisible());
        if (control) {
            await page.locator('[data-connect="AA:01"]').click({ timeout: 2000 });
            await page.getByText('已就绪', { exact: true }).waitFor();
            assert.ok(await page.locator('[data-page="devices"]').isVisible());
            await page.locator('[data-device="AA:01"]').click();
            await page.locator('[data-page="control"]').waitFor();
            assert.ok(await page.getByText('00 FF', { exact: true }).isVisible());
            await page.screenshot({ path: path.join(root, 'artifacts/control.png'), fullPage: true });
            return;
        }
        await page.locator('[data-action="scan"]').click();
        await page.getByText('重新扫描', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-device]').count(), 2);
        await page.screenshot({ path: path.join(root, 'artifacts/discovery.png'), fullPage: true });
    } finally {
        if (browser) {
            await browser.close();
        }
        await new Promise(function close(resolve) { server.close(resolve); });
    }
}

test('编译设备页显示去重卡片，并可停止扫描保留结果', renderDiscoveredCards);

/******************************************************************************
 * Function Name   : renderControl
 * Description     : Enter control only by clicking the ready device and display earlier received bytes.
 * Input Parameters: None
 * Return Value    : Promise resolved after real-page assertions.
 * Date            : 2026.11.10
 ******************************************************************************/
async function renderControl() {
    await renderDiscoveredCards(null, true);
}

test('连接就绪不自动跳页，点击卡片进入后可看到提前收到的数据', renderControl);
