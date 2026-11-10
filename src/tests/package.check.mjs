//20261110-0 add - Verify the public build command and actual signed APK metadata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/******************************************************************************
 * Function Name   : independentPackage
 * Description     : Build an APK and verify its exported identity, signature and original icon.
 * Input Parameters: None
 * Return Value    : None
 * Date            : 2026.11.10
 ******************************************************************************/
function independentPackage() {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = spawnSync('python', ['tools/build-apk.py'], { cwd: root, encoding: 'utf8', windowsHide: true });
    let report;

    assert.equal(result.status, 0, result.stdout + result.stderr);
    report = JSON.parse(fs.readFileSync(path.join(root, 'dist/速驱智控-1.0.0.json'), 'utf8'));
    assert.equal(report.name, '速驱智控');
    assert.equal(report.package, 'cn.suqu.smartcontrol');
    assert.equal(report.minSdk, 23);
    assert.equal(report.debuggable, false);
    assert.equal(report.signatureVerified, true);
    assert.equal(report.iconSha256, '84f4d548cda5bfacec6d0b423619c54fe1070b370f35d63d5e1be4d911322673');
    assert.ok(fs.statSync(report.apk).size > 10000);
}

test('正式安卓包身份独立、签名有效且图标等同参考原图标', independentPackage);
