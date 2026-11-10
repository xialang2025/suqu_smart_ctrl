//20261110-0 add - Reuse the pinned compiler with local staging for a Windows network workspace.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, 'node_modules');
const cached = path.join(os.tmpdir(), 'rea-ble-build-20261109/node_modules');
const modules = process.env.SUQU_NODE_MODULES || (fs.existsSync(path.join(local, '@dcloudio/vite-plugin-uni/bin/uni.js')) ? local : cached);
const cli = path.join(modules, '@dcloudio/vite-plugin-uni/bin/uni.js');
//20261110-0 change - Resolve dependencies through the compiler cache parent without a Windows junction.
const staging = fs.mkdtempSync(path.join(path.dirname(modules), 'suqu-web-'));
let result;

/******************************************************************************
 * Function Name   : copySource
 * Description     : Copy network-workspace inputs without Node recursive-copy native crashes.
 * Input Parameters: source, target
 * Return Value    : None
 * Date            : 2026.11.10
 ******************************************************************************/
function copySource(source, target) {
    const directory = fs.statSync(source).isDirectory();
    let entries;

    if (directory) {
        fs.mkdirSync(target, { recursive: true });
        entries = fs.readdirSync(source);
        for (const entry of entries) {
            copySource(path.join(source, entry), path.join(target, entry));
        }
    } else {
        fs.writeFileSync(target, fs.readFileSync(source));
    }
}

if (!fs.existsSync(cli)) {
    throw new Error('未找到固定版本编译器，请在src运行npm ci或配置SUQU_NODE_MODULES');
}
for (const item of ['App.vue', 'main.js', 'index.html', 'pages.json', 'manifest.json', 'vite.config.js', 'package.json', 'pages', 'common', 'components', 'static']) {
    if (fs.existsSync(path.join(root, item))) {
        copySource(path.join(root, item), path.join(staging, item));
    }
}
result = spawnSync(process.execPath, [cli, 'build', '-p', 'h5'], {
    cwd: staging, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, UNI_INPUT_DIR: staging, UNI_OUTPUT_DIR: path.join(root, 'unpackage/h5') },
});
if (result.error) {
    throw result.error;
}
process.exit(result.status ?? 1);
