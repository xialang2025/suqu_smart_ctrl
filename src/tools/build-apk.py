#20261110-0 add - Build an independently signed APK from local web and Java sources.
import argparse
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOLS = pathlib.Path(os.environ.get('SUQU_ANDROID_TOOLS', pathlib.Path(os.environ['LOCALAPPDATA']) / 'REA-Android-Tools'))
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')


def run(arguments, env=None, cwd=None):
    """
    Function Name   : run
    Description     : Run an SDK command with argument boundaries and hidden helper windows.
    Input Parameters: arguments, env, cwd
    Return Value    : Completed process with UTF-8 output.
    Date            : 2026.11.10
    """
    result = subprocess.run([str(value) for value in arguments], cwd=cwd, env=env,
                            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    try:
        output = result.stdout.decode('utf-8') + result.stderr.decode('utf-8')
    except UnicodeDecodeError:
        output = result.stdout.decode('gb18030', errors='replace') + result.stderr.decode('gb18030', errors='replace')
    print(output, end='')
    if result.returncode != 0:
        raise RuntimeError('Build command failed: ' + pathlib.Path(str(arguments[0])).name)
    return output


def main():
    """
    Function Name   : main
    Description     : Compile bundled assets and native code, preserve signing identity, verify the result.
    Input Parameters: Command-line debug flag.
    Return Value    : None
    Date            : 2026.11.10
    """
    parser = argparse.ArgumentParser()
    args = None
    manifest = json.loads((ROOT / 'manifest.json').read_text('utf-8'))
    sdk = TOOLS / 'sdk-build-tools-35/android-15'
    android = TOOLS / 'sdk-platform-35/android-35/android.jar'
    java = next((TOOLS / 'jdk17').glob('*/bin/java.exe'))
    java_bin = java.parent
    env = dict(os.environ, JAVA_HOME=str(java_bin.parent), PATH=str(java_bin) + os.pathsep + os.environ['PATH'])
    workspace = pathlib.Path(tempfile.mkdtemp(prefix='suqu-native-'))
    classes = workspace / 'classes'
    dex = workspace / 'dex'
    private = ROOT / 'private'
    credentials = private / 'android-signing.json'
    keystore = private / 'android-release.p12'
    dist = ROOT / 'dist'
    password = None
    alias = 'suqu-smartcontrol'
    native_manifest = None
    apk = None
    badging = None
    verification = None
    report = None
    icon_bytes = None

    parser.add_argument('--debug', action='store_true')
    args = parser.parse_args()
    run(['node', ROOT / 'tools/build.mjs'], cwd=ROOT)
    shutil.copytree(ROOT / 'unpackage/h5', workspace / 'assets')
    shutil.copytree(ROOT / 'android/res', workspace / 'res')
    native_manifest = (ROOT / 'android/AndroidManifest.xml').read_text('utf-8')
    if args.debug:
        native_manifest = native_manifest.replace('android:debuggable="false"', 'android:debuggable="true"')
    (workspace / 'AndroidManifest.xml').write_text(native_manifest, encoding='utf-8')
    run([sdk / 'aapt2.exe', 'compile', '--no-crunch', '--dir', workspace / 'res', '-o', workspace / 'resources.zip'])
    run([sdk / 'aapt2.exe', 'link', '-o', workspace / 'resources.ap_', '-I', android,
         '--manifest', workspace / 'AndroidManifest.xml', '-R', workspace / 'resources.zip',
         '-A', workspace / 'assets', '--min-sdk-version', '23', '--target-sdk-version', '35'])
    classes.mkdir()
    run([java_bin / 'javac.exe', '-encoding', 'UTF-8', '--release', '8', '-classpath', android,
         '-d', classes, *list((ROOT / 'android/java').rglob('*.java'))])
    with zipfile.ZipFile(workspace / 'classes.jar', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for compiled in classes.rglob('*.class'):
            archive.write(compiled, compiled.relative_to(classes).as_posix())
    dex.mkdir()
    run([java, '-cp', sdk / 'lib/d8.jar', 'com.android.tools.r8.D8', '--release', '--min-api', '23',
         '--lib', android, '--output', dex, workspace / 'classes.jar'])
    with zipfile.ZipFile(workspace / 'resources.ap_') as resources, zipfile.ZipFile(workspace / 'unsigned.apk', 'w') as archive:
        for entry in resources.infolist():
            archive.writestr(entry.filename, resources.read(entry.filename), compress_type=entry.compress_type)
        for compiled in dex.glob('*.dex'):
            archive.write(compiled, compiled.name, compress_type=zipfile.ZIP_DEFLATED)
    run([sdk / 'zipalign.exe', '-f', '-p', '4', workspace / 'unsigned.apk', workspace / 'aligned.apk'])
    private.mkdir(exist_ok=True)
    if credentials.exists() and not keystore.exists():
        raise RuntimeError('Signing record exists without its key; restore the existing identity before building.')
    if credentials.exists():
        password = json.loads(credentials.read_text('utf-8'))['password']
    elif keystore.exists():
        raise RuntimeError('Existing signing key has no password record; refusing to replace it.')
    else:
        password = secrets.token_urlsafe(36)
        credentials.write_text(json.dumps({'alias': alias, 'password': password}), encoding='utf-8')
    env['SUQU_SIGNING_PASSWORD'] = password
    if not keystore.exists():
        run([java_bin / 'keytool.exe', '-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12',
             '-storepass:env', 'SUQU_SIGNING_PASSWORD', '-keypass:env', 'SUQU_SIGNING_PASSWORD', '-alias', alias,
             '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Suqu Smart Control, O=Suqu, C=CN'], env=env)
    dist.mkdir(exist_ok=True)
    apk = dist / (manifest['name'] + '-' + manifest['versionName'] + ('-debug' if args.debug else '') + '.apk')
    run([java, '-jar', sdk / 'lib/apksigner.jar', 'sign', '--ks', keystore, '--ks-key-alias', alias,
         '--ks-pass', 'env:SUQU_SIGNING_PASSWORD', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
         '--out', apk, workspace / 'aligned.apk'], env=env)
    verification = run([java, '-jar', sdk / 'lib/apksigner.jar', 'verify', '--verbose', '--print-certs', apk], env=env)
    badging = run([sdk / 'aapt2.exe', 'dump', 'badging', apk])
    if "package: name='cn.suqu.smartcontrol'" not in badging or "minSdkVersion:'23'" not in badging or "application-label:'速驱智控'" not in badging:
        raise RuntimeError('APK identity or minimum SDK does not match this application.')
    with zipfile.ZipFile(apk) as archive:
        icon_bytes = archive.read(re.search(r"application-icon-640:'([^']+)'", badging).group(1))
    report = {'name': manifest['name'], 'package': 'cn.suqu.smartcontrol', 'versionName': manifest['versionName'],
              'minSdk': 23, 'targetSdk': 35, 'debuggable': 'application-debuggable' in badging,
              'signatureVerified': 'Verifies' in verification, 'apk': str(apk),
              'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'bytes': apk.stat().st_size,
              'iconSha256': hashlib.sha256(icon_bytes).hexdigest()}
    apk.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('APK:', apk, '\nSHA-256:', report['sha256'])


if __name__ == '__main__':
    main()
