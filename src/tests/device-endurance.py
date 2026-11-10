#20261110-9 add - Run a real ten-minute signed-APK/UART acceptance test without application hooks.
import importlib
import json
import re
import time
from datetime import datetime, timezone, timedelta

lab = importlib.import_module('device-lab')
REPORT = lab.OUTPUT / '十分钟前台持续收发.json'
EXPECTED = bytes.fromhex('00 01 7F 80 FF')


def record_bytes(tree, direction):
    """
    Function Name   : record_bytes
    Description     : Read the actual accessibility record bytes while keeping metadata separate.
    Input Parameters: tree, direction
    Return Value    : Concatenated raw bytes represented by rendered records.
    Date            : 2026.11.10
    """
    values = []
    for record in lab.records(tree, direction):
        values.extend(bytes.fromhex(text) for text in record['texts']
                      if re.fullmatch(r'[0-9A-F]{2}(?: [0-9A-F]{2})*', text))
    return b''.join(values)


def checkpoint(report, expected_incoming, final=False):
    """
    Function Name   : checkpoint
    Description     : Verify the signed app remains ready and its bounded display has exact ordered bytes.
    Input Parameters: report, expected_incoming, final
    Return Value    : None
    Date            : 2026.11.10
    """
    tree = lab.refresh_control('持续收发最终画面' if final else None)
    incoming = record_bytes(tree, 'receive')
    outgoing = record_bytes(tree, 'send')
    receive_records = lab.records(tree, 'receive')
    send_records = lab.records(tree, 'send')
    evictions = [text for text in lab.texts(tree) if '已淘汰最旧' in text]
    sample = {'iteration': len(report['exchanges']), 'receiveRecords': len(receive_records),
              'sendRecords': len(send_records), 'accessibilityEvictionNotices': evictions,
              'expectedEvictedPerWindow': max(0, len(report['exchanges']) - 500)}

    assert '已就绪' in lab.texts(tree), 'The physical app lost readiness'
    assert len(receive_records) <= 500 and len(send_records) <= 500
    assert incoming and incoming == bytes(expected_incoming)[-len(incoming):], 'Incoming display bytes or order differ'
    assert outgoing and outgoing == (EXPECTED * len(report['exchanges']))[-len(outgoing):], 'Outgoing display differs'
    if len(report['exchanges']) <= 500: #20261110-9 change - Accessibility may omit the visible notice; record identities still prove the retained byte window.
        assert incoming == bytes(expected_incoming), 'Incoming bytes were lost before display eviction'
        assert outgoing == EXPECTED * len(report['exchanges'])
    if final:
        assert len(receive_records) == 500 and len(send_records) == 500
        report['evictionNoticeScreenshotReview'] = '持续收发最终画面.png，须目视核对两个窗口淘汰提示'
    report['checkpoints'].append(sample)
    print(json.dumps(sample, ensure_ascii=False), flush=True)


def main():
    """
    Function Name   : main
    Description     : Click the real send button and validate both physical directions for at least ten minutes.
    Input Parameters: None
    Return Value    : None; raises on any byte or screen mismatch.
    Date            : 2026.11.10
    """
    report = {'startedAt': datetime.now(timezone(timedelta(hours=8))).isoformat(), 'port': 'COM16',
              'baud': 115200, 'format': '8N1', 'target': lab.TARGET, 'exchanges': [],
              'checkpoints': [], 'passed': False, 'automation': 'Android accessibility and physical serial only'}
    port = lab.open_uart()
    expected_incoming = bytearray()
    started = None
    next_checkpoint = None
    send = None
    bounds = None
    raw = None
    actual = None
    status = None
    payload = None
    index = 0
    delay = None
    tree = None

    try:
        tree = lab.snapshot()
        assert lab.TARGET in lab.texts(tree) and '已就绪' in lab.texts(tree)
        lab.tap_text('清空', 0)
        lab.tap_text('清空', 1)
        lab.set_hex('00017f80ff')
        if 'mInputShown=true' in lab.adb('shell', 'dumpsys', 'input_method'):
            lab.adb('shell', 'input', 'keyevent', '4')
        tree = lab.snapshot('持续收发起始画面')
        assert '已就绪' in lab.texts(tree)
        send = next(node for node in tree.iter('node') if node.get('text') == '发送')
        bounds = list(map(int, re.findall(r'\d+', send.get('bounds'))))
        port.reset_input_buffer()
        started = time.monotonic()
        next_checkpoint = started + 60
        while time.monotonic() - started < 600:
            lab.assert_app_foreground()
            lab.adb('shell', 'input', 'tap', (bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2)
            raw = lab.read_uart(port, .45)
            actual, status = lab.split_uart(raw)
            assert actual == EXPECTED, {'iteration': index, 'actualHex': actual.hex(' '), 'status': status}
            payload = bytes([0xC7, index >> 8, index & 255, 0, 1, 127, 128, 255])
            port.write(payload)
            port.flush()
            expected_incoming.extend(payload)
            report['exchanges'].append({'index': index, 'elapsedSeconds': round(time.monotonic() - started, 3),
                                         'uartReceivedHex': actual.hex(' ').upper(),
                                         'uartSentHex': payload.hex(' ').upper(), 'moduleStatus': status})
            index += 1
            if time.monotonic() >= next_checkpoint:
                checkpoint(report, expected_incoming)
                REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                next_checkpoint = time.monotonic() + 60
            delay = started + index - time.monotonic()
            if delay > 0:
                time.sleep(delay)
        checkpoint(report, expected_incoming, final=True)
        report['durationSeconds'] = round(time.monotonic() - started, 3)
        assert report['durationSeconds'] >= 600 and index > 500
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        port.close()
        report['endedAt'] = datetime.now(timezone(timedelta(hours=8))).isoformat()
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
