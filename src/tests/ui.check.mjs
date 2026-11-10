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
