#20261110-9 add - Verify recovery and payload boundaries on the installed release APK.
import importlib
import json
import re
import time

lab = importlib.import_module('device-lab')
RESULTS = []


def payloads(tree, direction):
    """
    Function Name   : payloads
    Description     : Extract actual displayed bytes without interpreting time or delivery labels as data.
    Input Parameters: tree, direction
    Return Value    : Raw byte fragments in rendered order.
    Date            : 2026.11.10
    """
    return [bytes.fromhex(text) for record in lab.records(tree, direction) for text in record['texts']
            if re.fullmatch(r'[0-9A-F]{2}(?: [0-9A-F]{2})*', text)]


def exchange(port, payload, received=None):
    """
    Function Name   : exchange
    Description     : Verify a manual UI write and a new physical receive fragment with exact bytes.
    Input Parameters: port, payload, received
    Return Value    : None
    Date            : 2026.11.10
    """
    received = received if received is not None else payload
    tree = lab.snapshot()
    before = {record['id'] for record in lab.records(tree, 'receive')}
    actual = None
    status = None
    after = None
    incoming = None

    assert lab.TARGET in lab.texts(tree) and '已就绪' in lab.texts(tree)
    lab.set_hex(payload.hex())
    port.reset_input_buffer()
    lab.tap_text('发送')
    actual, status = lab.split_uart(lab.read_uart(port, .8))
    assert actual == payload, {'expected': payload.hex(), 'actual': actual.hex(), 'moduleStatus': status}
    port.write(received)
    port.flush()
    after = lab.refresh_control()
    incoming = b''.join(bytes.fromhex(text) for record in lab.records(after, 'receive') if record['id'] not in before
                        for text in record['texts'] if re.fullmatch(r'[0-9A-F]{2}(?: [0-9A-F]{2})*', text))
    assert incoming == received, {'expectedReceive': received.hex(), 'actualReceive': incoming.hex()}


def window_clear(port):
    """
    Function Name   : window_clear
    Description     : Prove independent clearing affects display only after sustained physical traffic.
    Input Parameters: port
    Return Value    : None
    Date            : 2026.11.10
    """
    tree = lab.snapshot()
    sent = lab.records(tree, 'send')
    after = None
    raw = None

    port.reset_input_buffer()
    lab.tap_text('清空', 0)
    after = lab.snapshot()
    assert not lab.records(after, 'receive') and lab.records(after, 'send') == sent
    assert '00017f80ff' in lab.texts(after) and '已就绪' in lab.texts(after)
    lab.tap_text('清空', 1)
    after = lab.snapshot('持续收发后独立清空')
    assert not lab.records(after, 'send') and '00017f80ff' in lab.texts(after)
    raw = lab.read_uart(port, .5)
    assert raw == b'', raw.hex()
    RESULTS.append({'test': '独立清空不发送命令且保留输入连接', 'passed': True})


def home_resume(port):
    """
    Function Name   : home_resume
    Description     : Verify fresh foreground subscription and retained records after the real Home key.
    Input Parameters: port
    Return Value    : None
    Date            : 2026.11.10
    """
    before = lab.snapshot()
    after = None

    lab.adb('shell', 'input', 'keyevent', '3')
    time.sleep(1)
    lab.adb('shell', 'am', 'start', '-n', 'cn.suqu.smartcontrol/.MainActivity')
    after = lab.wait_text('连接和接收准备已核实；后台数据可能不完整')
    assert lab.records(before, 'receive') == lab.records(after, 'receive')
    assert lab.records(before, 'send') == lab.records(after, 'send')
    lab.snapshot('主页返回已核实')
    exchange(port, bytes.fromhex('00 01 7F 80 FF'), bytes.fromhex('A5 00 01 7F 80 FF'))
    RESULTS.append({'test': '主页后核实接收准备再恢复精确收发', 'passed': True})


def length_boundary(port):
    """
    Function Name   : length_boundary
    Description     : Verify the actual negotiated 247-byte MTU admits 244 bytes and rejects 245 intact.
    Input Parameters: port
    Return Value    : None
    Date            : 2026.11.10
    """
    payload = bytes(range(244))
    before = None
    tree = None
    actual = None

    lab.tap_text('清空', 0)
    lab.tap_text('清空', 1)
    exchange(port, payload, bytes.fromhex('00 01 7F 80 FF'))
    before = len(lab.records(lab.snapshot(), 'send'))
    lab.set_hex(bytes(range(245)).hex())
    port.reset_input_buffer()
    lab.tap_text('发送')
    tree = lab.wait_text('当前单次最多 244 字节，超出内容不会发送')
    actual = lab.read_uart(port, .7)
    assert actual == b'' and len(lab.records(tree, 'send')) == before
    lab.snapshot('实际MTU拒绝超长')
    lab.set_hex('00017f80ff')
    RESULTS.append({'test': '实际MTU247时244字节原样通过而245字节拒发', 'passed': True})


if __name__ == '__main__':
    port = lab.open_uart()
    try:
        lab.assert_app_foreground()
        exchange(port, bytes.fromhex('00 01 7F 80 FF'))
        window_clear(port)
        exchange(port, bytes.fromhex('00 01 7F 80 FF'))
        home_resume(port)
        length_boundary(port)
    finally:
        port.close()
        (lab.OUTPUT / '窗口前后台与长度边界.json').write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2), encoding='utf-8')
