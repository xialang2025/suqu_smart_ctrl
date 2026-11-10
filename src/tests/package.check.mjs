//20261110-0 add - Verify the public build command and actual signed APK metadata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/******************************************************************************
 * Function Name   : independentPackage
 * Description     : Build an APK and verify identity, signature and transparent launcher exports.
 * Input Parameters: None
 * Return Value    : None
 * Date            : 2026.11.10
 ******************************************************************************/
function independentPackage() { //20261110-11 change
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const previous = fs.existsSync(path.join(root, 'dist/速驱智控-1.0.0.json'))
        ? JSON.parse(fs.readFileSync(path.join(root, 'dist/速驱智控-1.0.0.json'), 'utf8')) : null; //20261110-8 add
    const result = spawnSync('python', ['tools/build-apk.py'], { cwd: root, encoding: 'utf8', windowsHide: true });
    const expectedIcons = { //20261110-11 change - Pin all density exports of the background-extracted master PNG.
        'res/drawable-hdpi-v4/icon.png': 'ed4cb70e89235a76325bb3588856780ce9123c2e9fa6aa150a760d55e1af3f7b',
        'res/drawable-xhdpi-v4/icon.png': '7e7ae3b63686dbe22c60e63b60f031ea15fb3d6cc3d4cca957267f7828a401f9',
        'res/drawable-xxhdpi-v4/icon.png': '4f067cc5efd5a78a391f53173ab6033d4c54e4557e87020c8489f149a704f2e8',
        'res/drawable-xxxhdpi-v4/icon.png': '8a1cf71eb08869f7cdf012522654eaef5ab745f8f267fac16d10aefc692e613e',
    };
    let report;
    let icons;
    let transparency;

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
    transparency = spawnSync('python', ['-c', [ //20261110-11 add - Inspect exported PNG alpha, beyond accepting an RGBA source file.
        'import io,json,sys,zipfile',
        'from PIL import Image',
        'archive=zipfile.ZipFile(sys.argv[1])',
        'result={}',
        'for name in archive.namelist():',
        '    if name.endswith("/icon.png"):',
        '        image=Image.open(io.BytesIO(archive.read(name))).convert("RGBA")',
        '        points=[(0,0),(image.width-1,0),(0,image.height-1),(image.width-1,image.height-1)]',
        '        interior=image.getchannel("A").crop((image.width//4,image.height//4,3*image.width//4,3*image.height//4))',
        '        result[name]=all(image.getpixel(point)[3]==0 for point in points) and interior.getextrema()[0]>=250',
        'print(json.dumps(result))',
    ].join('\n'), report.apk], { encoding: 'utf8', windowsHide: true });
    assert.equal(transparency.status, 0, transparency.stderr);
    assert.deepEqual(JSON.parse(transparency.stdout), Object.fromEntries(Object.keys(expectedIcons).map(function transparent(name) { return [name, true]; })),
        '四种桌面图标的外侧四角必须完全透明，中央主体区域须保持接近不透明（alpha至少250）');
    assert.ok(fs.statSync(report.apk).size > 10000);
    assert.equal(report.webAssetsVerified, true); //20261110-8 add - Require evidence from the APK bytes, beyond successful compilation.
    assert.match(report.certificateSha256, /^[0-9a-f]{64}$/);
    assert.match(report.sourceSha256, /^[0-9a-f]{64}$/);
    if (previous?.certificateSha256) {
        assert.equal(report.certificateSha256, previous.certificateSha256, '覆盖安装签名身份不得变化');
    }
}

test('正式安卓包身份独立、签名延续，四种密度桌面图标边缘透明且主体保留', independentPackage);
