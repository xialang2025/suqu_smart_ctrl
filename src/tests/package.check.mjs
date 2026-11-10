//20261110-0 add - Verify the public build command and actual signed APK metadata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/******************************************************************************
 * Function Name   : independentPackage
 * Description     : Build an APK and verify its identity, signature and all user-supplied launcher densities.
 * Input Parameters: None
 * Return Value    : None
 * Date            : 2026.11.10
 ******************************************************************************/
function independentPackage() { //20261110-10 change
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const previous = fs.existsSync(path.join(root, 'dist/速驱智控-1.0.0.json'))
        ? JSON.parse(fs.readFileSync(path.join(root, 'dist/速驱智控-1.0.0.json'), 'utf8')) : null; //20261110-8 add
    const result = spawnSync('python', ['tools/build-apk.py'], { cwd: root, encoding: 'utf8', windowsHide: true });
    const expectedIcons = { //20261110-10 add - Pin exact PNG exports of 手机APP桌面图标2.png at Android launcher sizes.
        'res/drawable-hdpi-v4/icon.png': '4b2c5cf5045918ef935a058c9d82935b4c6313153a9f0db757fd4ade2f13a38a',
        'res/drawable-xhdpi-v4/icon.png': 'a90273db282e622f27ca3ad28826d01b43726cd6584967e2b7979256a160d2f5',
        'res/drawable-xxhdpi-v4/icon.png': '4f4c803d039b9fffef0efa493e1c391ddbd2cc03504fa1f56dfb06664df7558b',
        'res/drawable-xxxhdpi-v4/icon.png': '0c291d0263ec000d4eb0f0181ca16ecc5b7c9776b0aa0b98fce8ba7130897a2b',
    };
    let report;
    let icons;

    assert.equal(result.status, 0, result.stdout + result.stderr);
    report = JSON.parse(fs.readFileSync(path.join(root, 'dist/速驱智控-1.0.0.json'), 'utf8'));
    assert.equal(report.name, '速驱智控');
    assert.equal(report.package, 'cn.suqu.smartcontrol');
    assert.equal(report.minSdk, 23);
    assert.equal(report.debuggable, false);
    assert.equal(report.signatureVerified, true);
    assert.equal(report.iconSha256, expectedIcons['res/drawable-xxxhdpi-v4/icon.png']);
    icons = spawnSync('python', ['-c',
        'import hashlib,json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.endswith("/icon.png")}))',
        report.apk], { encoding: 'utf8', windowsHide: true });
    assert.equal(icons.status, 0, icons.stderr);
    assert.deepEqual(JSON.parse(icons.stdout), expectedIcons, '正式APK的全部桌面图标密度均须使用指定新图');
    assert.ok(fs.statSync(report.apk).size > 10000);
    assert.equal(report.webAssetsVerified, true); //20261110-8 add - Require evidence from the APK bytes, beyond successful compilation.
    assert.match(report.certificateSha256, /^[0-9a-f]{64}$/);
    assert.match(report.sourceSha256, /^[0-9a-f]{64}$/);
    if (previous?.certificateSha256) {
        assert.equal(report.certificateSha256, previous.certificateSha256, '覆盖安装签名身份不得变化');
    }
}

test('正式安卓包身份独立、签名延续，四种密度桌面图标均为用户指定新图', independentPackage);
