//20261110-0 add - Own the application state independently of page lifetime.
/******************************************************************************
 * Function Name   : createApplication
 * Description     : Expose device-page operations and observable application state.
 * Input Parameters: platform
 * Return Value    : Application facade.
 * Date            : 2026.11.10
 ******************************************************************************/
export function createApplication(platform, clock = globalThis) { //20261110-1 change
    const listeners = new Set();
    const state = { //20261110-2 change - Keep the connected device and records outside the page lifetime.
        page: 'devices', status: 'idle', message: '', devices: [], scanning: false, available: false,
        currentDevice: null, connectionId: 0, target: null, mtu: 23, received: [],
        input: '', sent: [], sending: false, //20261110-3 add - Sending and receiving own separate visible records.
    };
    const app = { state, start, subscribe, scan, stopScan, connect, openControl, backToDevices, setInput, send };
    let scanSequence = 0;
    let scanTimer = null;
    let connectionSequence = 0;
    let recordSequence = 0;

    /******************************************************************************
     * Function Name   : setInput
     * Description     : Keep user-entered hexadecimal text available after manual sending.
     * Input Parameters: text
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function setInput(text) { //20261110-3 add
        state.input = String(text);
        publish();
    }

    /******************************************************************************
     * Function Name   : send
     * Description     : Write raw user bytes and record only the local write outcome.
     * Input Parameters: None
     * Return Value    : Promise resolved when the write outcome is known.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function send() { //20261110-3 add
        const normalized = state.input.replace(/\s/g, '');
        const maximum = Math.min(512, Math.max(0, state.mtu - 3));
        let bytes;
        let record;

        if (state.status !== 'ready' || !state.target || !state.currentDevice) {
            state.message = '设备未就绪或已断开，不能发送';
            publish();
            return;
        }
        if (state.sending) {
            state.message = '正在等待写入结果，请勿重复发送';
            publish();
            return;
        }
        if (!normalized || !/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
            state.message = !normalized ? '发送内容不能为空' : '请输入完整的两位十六进制字节';
            publish();
            return;
        }
        bytes = normalized.match(/.{2}/g).map(function byte(pair) { return parseInt(pair, 16); });
        if (bytes.length > maximum) {
            state.message = '当前单次最多 ' + maximum + ' 字节，超出内容不会发送';
            publish();
            return;
        }
        record = {
            id: ++recordSequence, type: 'data', status: 'pending', length: bytes.length,
            time: new Date(clock.now ? clock.now() : Date.now()).toLocaleTimeString('zh-CN', { hour12: false }),
            text: bytes.map(function hex(value) { return value.toString(16).padStart(2, '0').toUpperCase(); }).join(' '),
        };

        state.sent.push(record);
        state.sending = true;
        publish();
        try {
            await platform.write({
                deviceId: state.currentDevice.deviceId, connectionId: state.connectionId,
                serviceId: state.target.serviceId, characteristicId: state.target.sendId,
                writeNoResponse: state.target.writeNoResponse, value: bytes,
            });
            record.status = 'success';
            state.message = '写入成功；写入结果不代表设备已执行';
        } catch (error) {
            record.status = ['timeout', 'unknown', 'connection'].includes(error.code) ? 'unknown' : 'failed';
            state.message = record.status === 'unknown' ? '结果未知，应用未自动重发；' + error.message : error.message || '写入失败';
        }
        state.sending = false;
        publish();
    }

    platform.on?.('notification', onNotification);
    platform.on?.('connectionChanged', onConnectionChanged);

    /******************************************************************************
     * Function Name   : onConnectionChanged
     * Description     : Revoke readiness when the current native link is lost.
     * Input Parameters: event
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function onConnectionChanged(event) { //20261110-2 add
        if (event.connected || event.connectionId !== state.connectionId
                || String(event.deviceId).toUpperCase() !== state.currentDevice?.deviceId) {
            return;
        }
        state.status = state.available ? 'disconnected' : 'unavailable';
        state.target = null;
        state.message = event.message || '设备连接已断开，请手动重连';
        publish();
    }

    /******************************************************************************
     * Function Name   : onNotification
     * Description     : Preserve each current-device notification without changing its fragment boundary.
     * Input Parameters: event
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function onNotification(event) { //20261110-2 add
        const bytes = Array.from(new Uint8Array(event.value || []));
        const time = new Date(clock.now ? clock.now() : Date.now()).toLocaleTimeString('zh-CN', { hour12: false });

        if (!state.target || event.connectionId !== state.connectionId
                || String(event.deviceId).toUpperCase() !== state.currentDevice?.deviceId
                || !matchesUuid(event.serviceId, state.target.serviceId)
                || !matchesUuid(event.characteristicId, state.target.receiveId)) {
            return;
        }
        state.received.push({
            id: ++recordSequence, type: 'data', time, length: bytes.length,
            text: bytes.map(function hex(value) { return value.toString(16).padStart(2, '0').toUpperCase(); }).join(' '),
        });
        publish();
    }

    /******************************************************************************
     * Function Name   : connect
     * Description     : Prepare communication on the device page before allowing entry.
     * Input Parameters: deviceId
     * Return Value    : Promise resolved when readiness is known.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function connect(deviceId) { //20261110-2 add
        const device = state.devices.find(function same(item) { return item.deviceId === deviceId; });
        let result;
        let connectionId;
        let service;
        let send;
        let receive;

        if (!device || !state.available || state.status === 'connecting' || state.status === 'ready') {
            return;
        }
        connectionId = ++connectionSequence;
        state.connectionId = connectionId;
        state.currentDevice = { ...device };
        state.status = 'connecting';
        await stopScan();
        state.message = '正在连接并准备接收…';
        publish();
        try {
            result = await platform.connect({ deviceId, connectionId });
            if (state.connectionId !== connectionId || state.status !== 'connecting') {
                return;
            }
            state.mtu = Number.isInteger(result.mtu) && result.mtu >= 23 && result.mtu <= 517 ? result.mtu : 23; //20261110-3 change - Use a validated negotiated capacity.
            service = (result.services || []).find(function target(item) { return matchesUuid(item.uuid, 'FFE0'); });
            send = service?.characteristics?.find(function writable(item) { return matchesUuid(item.uuid, 'FFE1') && (item.properties?.write || item.properties?.writeNoResponse); });
            receive = service?.characteristics?.find(function notifiable(item) { return matchesUuid(item.uuid, 'FFE2') && (item.properties?.notify || item.properties?.indicate); });
            if (!service || !send || !receive) {
                throw new Error('暂不支持该设备：未找到所需收发通道');
            }
            state.target = {
                serviceId: service.uuid, sendId: send.uuid, receiveId: receive.uuid,
                writeNoResponse: !send.properties.write && Boolean(send.properties.writeNoResponse),
            };
            await platform.subscribe({ deviceId, connectionId, serviceId: service.uuid, characteristicId: receive.uuid });
            if (state.connectionId !== connectionId || state.status !== 'connecting') {
                return;
            }
            state.status = 'ready';
            state.message = '设备已就绪，点击设备卡片进入控制页面';
        } catch (error) {
            state.status = 'disconnected';
            state.target = null;
            state.message = error.message || '连接准备失败，请重试';
            try {
                await platform.disconnect({ deviceId, connectionId });
            } catch (cleanupError) {
                state.message += '；请重新检查蓝牙状态';
            }
        }
        publish();
    }

    /******************************************************************************
     * Function Name   : openControl
     * Description     : Enter control only after the selected device is fully ready.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function openControl() { //20261110-2 add
        if (state.status === 'ready') {
            state.page = 'control';
            state.message = '设备已就绪'; //20261110-2 add - Keep navigation instructions outside the control page.
            publish();
        }
    }

    /******************************************************************************
     * Function Name   : backToDevices
     * Description     : Return to the device page without replacing its shared connection.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function backToDevices() { //20261110-2 add
        state.page = 'devices';
        if (state.status === 'ready') {
            state.message = '设备已就绪，点击设备卡片进入控制页面';
        }
        publish();
    }

    /******************************************************************************
     * Function Name   : matchesUuid
     * Description     : Compare a profile UUID with either its exact short or standard full form.
     * Input Parameters: actual, short
     * Return Value    : True only for the intended Bluetooth UUID.
     * Date            : 2026.11.10
     ******************************************************************************/
    function matchesUuid(actual, short) { //20261110-2 add
        const uuid = String(actual || '').toUpperCase();
        const expected = String(short || '').toUpperCase();

        return (uuid.length === 4 ? '0000' + uuid + '-0000-1000-8000-00805F9B34FB' : uuid)
                === (expected.length === 4 ? '0000' + expected + '-0000-1000-8000-00805F9B34FB' : expected);
    }

    platform.on?.('deviceFound', onDeviceFound);
    platform.on?.('scanFailed', onScanFailed);
    platform.on?.('adapterState', onAdapterState);

    /******************************************************************************
     * Function Name   : onScanFailed
     * Description     : End only the failed discovery generation and preserve its reason.
     * Input Parameters: event
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function onScanFailed(event) { //20261110-1 add
        if (event.scanId !== scanSequence || !state.scanning) {
            return;
        }
        scanSequence++;
        clock.clearTimeout(scanTimer);
        state.scanning = false;
        state.message = event.message || '扫描失败，请重新扫描';
        publish();
    }

    /******************************************************************************
     * Function Name   : onAdapterState
     * Description     : Remove scanning eligibility when the system adapter becomes unavailable.
     * Input Parameters: event
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function onAdapterState(event) { //20261110-1 add
        if (!event.available) {
            state.available = false;
            state.target = null; //20261110-2 add - No notification remains eligible after adapter loss.
            scanSequence++;
            clock.clearTimeout(scanTimer);
            state.scanning = false;
            state.status = 'unavailable';
            state.message = event.message || '系统蓝牙已关闭，请开启后重新检查';
            publish();
        }
    }

    /******************************************************************************
     * Function Name   : onDeviceFound
     * Description     : Show devices from the current scan without relying on advertised names.
     * Input Parameters: event
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function onDeviceFound(event) { //20261110-1 add
        const deviceId = String(event.deviceId || '').toUpperCase();
        const device = { deviceId, name: String(event.name || '').trim() || '未命名设备', rssi: Number(event.rssi) };
        const existing = state.devices.findIndex(function same(item) { return item.deviceId === deviceId; });

        if (!state.scanning || event.scanId !== scanSequence || !deviceId) {
            return;
        }
        if (existing < 0) { //20261110-1 change - Device identity survives repeated advertisements and renaming.
            state.devices.push(device);
        } else {
            state.devices[existing] = device;
        }
        publish();
    }

    /******************************************************************************
     * Function Name   : scan
     * Description     : Start an explicitly identified device-discovery operation.
     * Input Parameters: None
     * Return Value    : Promise for scan startup.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function scan() { //20261110-1 add
        const scanId = ++scanSequence;

        if (!state.available || state.status === 'connecting' || state.status === 'ready') {
            return;
        }
        clock.clearTimeout(scanTimer);
        state.devices = [];
        state.scanning = true;
        state.message = '正在扫描附近设备…';
        publish();
        try {
            await platform.startScan({ scanId });
        } catch (error) {
            if (scanId === scanSequence) {
                state.scanning = false;
                state.message = error.message || '扫描失败，请重新扫描';
                publish();
            }
            return;
        }
        if (scanId !== scanSequence || !state.scanning) {
            return;
        }
        scanTimer = clock.setTimeout(function finishWindow() { void stopScan(); }, 15000);
    }

    /******************************************************************************
     * Function Name   : stopScan
     * Description     : End the active discovery window while retaining its visible devices.
     * Input Parameters: None
     * Return Value    : Promise resolved after requesting native scan shutdown.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function stopScan() { //20261110-1 add
        const scanId = scanSequence++;

        clock.clearTimeout(scanTimer);
        scanTimer = null;
        state.scanning = false;
        state.message = state.devices.length ? '已发现 ' + state.devices.length + ' 台设备' : '未找到设备，请确认模块已开启后重新扫描';
        publish();
        try {
            await platform.stopScan({ scanId });
        } catch (error) {
            if (scanSequence === scanId + 1 && !state.scanning) {
                state.message = error.message || '停止扫描失败，请重试';
                publish();
            }
        }
    }

    /******************************************************************************
     * Function Name   : publish
     * Description     : Notify page observers after a completed state transition.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function publish() {
        for (const listener of listeners) {
            listener({ ...state });
        }
    }

    /******************************************************************************
     * Function Name   : subscribe
     * Description     : Observe state without registering additional native BLE listeners.
     * Input Parameters: listener
     * Return Value    : Unsubscribe function.
     * Date            : 2026.11.10
     ******************************************************************************/
    function subscribe(listener) {
        listeners.add(listener);
        return function unsubscribe() { listeners.delete(listener); };
    }

    /******************************************************************************
     * Function Name   : start
     * Description     : Open the device page and report actual platform initialization.
     * Input Parameters: None
     * Return Value    : Promise resolved when initialization finishes.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function start() {
        let result;

        if (state.status === 'connecting' || state.status === 'ready') { //20261110-2 add - A scan retry cannot replace an active device session.
            return;
        }
        state.page = 'devices';
        state.status = 'initializing';
        publish();
        try {
            result = await platform.initialize();
            state.available = Boolean(result.available);
            state.status = result.available ? 'idle' : 'unavailable';
            state.message = result.message || (result.available ? '蓝牙已开启' : '蓝牙不可用');
            if (result.available) { //20261110-1 add - Discover automatically only after initialization permits scanning.
                await scan();
            }
        } catch (error) {
            state.status = 'unavailable';
            state.available = false;
            state.scanning = false;
            state.message = error.message || '蓝牙初始化失败';
        }
        publish();
    }

    return app;
}
