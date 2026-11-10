#20261110-9 add - Exercise the signed app through Android accessibility and a physical UART boundary.
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
import serial

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'artifacts/sc10-20261110'
ADB = Path(os.environ['LOCALAPPDATA']) / 'REA-Android-Tools/adb-tools/platform-tools/adb.exe'
DEVICE = os.environ.get('SUQU_ADB_SERIAL')
TARGET = os.environ.get('SUQU_BLE_ADDRESS', 'DE:9F:56:EB:2D:F8')


def adb(*arguments, binary=False):
    """
    Function Name   : adb
    Description     : Execute a bounded command against the explicitly selected physical phone.
    Input Parameters: arguments, binary
    Return Value    : UTF-8 text or raw bytes.
    Date            : 2026.11.10
    """
    global DEVICE
    inventory = None
    connected = None
    result = None

    if not DEVICE: #20261110-9 change - Keep the user's USB serial outside versioned source and reject ambiguous device selection.
        inventory = subprocess.run([str(ADB), 'devices'], capture_output=True, check=True,
                                   timeout=10, creationflags=subprocess.CREATE_NO_WINDOW).stdout.decode('utf-8')
        connected = [line.split()[0] for line in inventory.splitlines() if len(line.split()) == 2 and line.split()[1] == 'device']
        if len(connected) != 1:
            raise RuntimeError('Connect exactly one authorized phone or set SUQU_ADB_SERIAL')
        DEVICE = connected[0]
    result = subprocess.run([str(ADB), '-s', DEVICE, *map(str, arguments)], capture_output=True,
                            timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode != 0:
        raise RuntimeError((result.stdout + result.stderr).decode('utf-8', errors='replace'))
    return result.stdout if binary else result.stdout.decode('utf-8', errors='replace')


def snapshot(name=None):
    """
    Function Name   : snapshot
    Description     : Read actual Android accessibility nodes and optionally preserve screen evidence.
    Input Parameters: name
    Return Value    : Parsed accessibility tree.
    Date            : 2026.11.10
    """
    remote = None
    result = None
    data = None

    for attempt in range(3):
        remote = '/sdcard/suqu-ui-' + str(time.monotonic_ns()) + '.xml'
        result = adb('shell', 'uiautomator', 'dump', remote)
        try:
            data = adb('exec-out', 'cat', remote, binary=True)
            ET.fromstring(data)
            adb('shell', 'rm', remote)
            break
        except (RuntimeError, ET.ParseError):
            if attempt == 2:
                raise RuntimeError('Accessibility dump did not produce a fresh hierarchy: ' + result)
    if name:
        tree = ET.fromstring(data)
        primary = next(tree.iter('node'), None)
        if primary is None or primary.get('package') not in {'cn.suqu.smartcontrol', 'com.android.settings', 'com.android.permissioncontroller', 'android'}:
            raise RuntimeError('No test screenshot was saved because the phone left the test interface')
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / (name + '.xml')).write_bytes(data)
        (OUTPUT / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    return ET.fromstring(data)


def texts(tree):
    """
    Function Name   : texts
    Description     : Return rendered accessibility text without reading application internals.
    Input Parameters: tree
    Return Value    : Nonempty text strings in screen order.
    Date            : 2026.11.10
    """
    return [node.get('text') for node in tree.iter('node') if node.get('text')]


def tap_node(node):
    """
    Function Name   : tap_node
    Description     : Tap the visible center of a node from the latest actual screen tree.
    Input Parameters: node
    Return Value    : None
    Date            : 2026.11.10
    """
    bounds = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))

    if node.get('package') not in {'cn.suqu.smartcontrol', 'com.android.settings', 'com.android.permissioncontroller', 'android'}:
        raise RuntimeError('The phone left the acceptance-test interface; no tap was issued')
    if len(bounds) != 4 or bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
        raise ValueError('Target accessibility node is not visible')
    adb('shell', 'input', 'tap', (bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2)


def tap_text(text, occurrence=0):
    """
    Function Name   : tap_text
    Description     : Operate a visible control by its actual rendered label.
    Input Parameters: text, occurrence
    Return Value    : None
    Date            : 2026.11.10
    """
    nodes = [node for node in snapshot().iter('node') if node.get('text') == text
             and node.get('enabled') == 'true' and node.get('bounds') != '[0,0][0,0]']
    tap_node(nodes[occurrence])


def connect_target():
    """
    Function Name   : connect_target
    Description     : Connect only the observed target card, never neighboring BLE appliances.
    Input Parameters: None
    Return Value    : None
    Date            : 2026.11.10
    """
    tree = snapshot()
    cards = [node for node in tree.iter('node') if any(child.get('text') == TARGET for child in node)
             and any(child.get('text') == '连接' for child in node)]
    button = None
    bounds = None
    if len(cards) != 1:
        raise RuntimeError('The selected target card is missing or ambiguous')
    button = next(node for node in cards[0] if node.get('text') == '连接')
    for attempt in range(5):
        bounds = list(map(int, re.findall(r'\d+', button.get('bounds', ''))))
        if len(bounds) == 4 and bounds[3] > bounds[1]:
            tap_node(button)
            return
        adb('shell', 'input', 'swipe', '600', '2150', '600', '850', '400')
        tree = snapshot()
        cards = [node for node in tree.iter('node') if any(child.get('text') == TARGET for child in node)
                 and any(child.get('text') == '连接' for child in node)]
        button = next(node for node in cards[0] if node.get('text') == '连接')
    raise RuntimeError('Target card could not be brought into the visible device list')


def set_hex(value):
    """
    Function Name   : set_hex
    Description     : Type ASCII hex into the real input using Android key events.
    Input Parameters: value
    Return Value    : None
    Date            : 2026.11.10
    """
    tree = snapshot()
    inputs = [node for node in tree.iter('node') if node.get('class') == 'android.widget.EditText']
    field = inputs[0]
    assert_app_foreground()
    if TARGET not in texts(tree):
        raise RuntimeError('The expected module is not the current control target')
    tap_node(field)
    adb('shell', 'input', 'keyevent', '123')
    adb('shell', 'input', 'keyevent', *(['67'] * (len(field.get('text', '')) + 2)))
    adb('shell', 'input', 'text', value)


def assert_app_foreground():
    """
    Function Name   : assert_app_foreground
    Description     : Stop scheduled input when a call or another activity replaces the test app.
    Input Parameters: None
    Return Value    : None; raises before issuing any test tap.
    Date            : 2026.11.10
    """
    activities = adb('shell', 'dumpsys', 'activity', 'activities')

    if not re.search(r'mResumedActivity:[^\n]*cn\.suqu\.smartcontrol/', activities):
        raise RuntimeError('The phone is in use outside the test app; scheduled input stopped')


def wait_text(value, timeout=20):
    """
    Function Name   : wait_text
    Description     : Wait for an observable page outcome with a finite device-test deadline.
    Input Parameters: value, timeout
    Return Value    : Latest accessibility tree.
    Date            : 2026.11.10
    """
    deadline = time.monotonic() + timeout
    tree = None
    while time.monotonic() < deadline:
        tree = snapshot()
        if value in texts(tree):
            return tree
    raise AssertionError('Expected screen text not reached: ' + value)


def open_uart():
    """
    Function Name   : open_uart
    Description     : Open the user-confirmed module port with the physically verified UART settings.
    Input Parameters: None
    Return Value    : Open serial port with modem control outputs disabled.
    Date            : 2026.11.10
    """
    port = serial.Serial(port=None, baudrate=115200, timeout=.1, write_timeout=2)
    port.dtr = False
    port.rts = False
    port.port = os.environ.get('SUQU_UART_PORT', 'COM16')
    port.open()
    return port


def read_uart(port, duration=.5):
    """
    Function Name   : read_uart
    Description     : Capture all UART bytes in a bounded observation window.
    Input Parameters: port, duration
    Return Value    : Unmodified received bytes.
    Date            : 2026.11.10
    """
    deadline = time.monotonic() + duration
    data = bytearray()
    while time.monotonic() < deadline:
        data.extend(port.read(max(1, port.in_waiting)))
    return bytes(data)


def split_uart(data):
    """
    Function Name   : split_uart
    Description     : Preserve observed module status lines separately from the exact test payload.
    Input Parameters: data
    Return Value    : Payload bytes and raw observed status messages.
    Date            : 2026.11.10
    """
    pattern = rb'\+(?:CONNECT|DISCONNECT|MTU|CNNTINTV)-S-\d+\r\n\x00'
    messages = re.findall(pattern, data)
    return re.sub(pattern, b'', data), [value.decode('ascii') for value in messages]


def records(tree, direction):
    """
    Function Name   : records
    Description     : Extract complete visible and offscreen rendered records by their public HTML identities.
    Input Parameters: tree, direction
    Return Value    : Record identities and accessibility text in display order.
    Date            : 2026.11.10
    """
    return [{'id': node.get('resource-id'), 'texts': texts(node)} for node in tree.iter('node')
            if node.get('resource-id', '').startswith(direction + '-')]


def refresh_control(name=None):
    """
    Function Name   : refresh_control
    Description     : Refresh stale vendor accessibility content through the normal retained-session page navigation.
    Input Parameters: name
    Return Value    : Fresh actual control-page tree without reconnecting or injecting app state.
    Date            : 2026.11.10
    """
    tap_text('返回设备页')
    wait_text('设备页')
    tap_text(TARGET)
    wait_text('接收窗口')
    return snapshot(name)


if __name__ == '__main__':
    print(json.dumps([{'text': node.get('text'), 'class': node.get('class'), 'bounds': node.get('bounds')}
                      for node in snapshot().iter('node') if node.get('text')], ensure_ascii=False))
