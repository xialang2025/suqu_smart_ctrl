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
        wasReady: false, //20261110-4 add - A new target owns a fresh record history.
        foreground: true, //20261110-6 add - A visible ready state alone cannot authorize a background write.
        recordLimit: 500, receivedDropped: 0, sentDropped: 0, //20261110-7 add - Each independent window has a fixed display budget.
    };
    const app = { state, start, subscribe, scan, stopScan, connect, disconnect, cancelConnection, openControl, backToDevices, setInput, send, clearWindow };
    let scanSequence = 0;
    let scanTimer = null;
    let connectionSequence = 0;
    let recordSequence = 0;
    let disconnectLease = null;
    let activeWrite = null; //20261110-4 add - A late result can settle only its own visible operation.
    let pendingNotifications = []; //20261110-4 add - Preserve arrival order without placing new bytes before a reconnect boundary.
    let activePreparation = null; //20261110-5 add - Public cancellation must not wait for a lost native reply.
    let uncertainWrite = false;
    let exiting = false; //20261110-6 add - No late operation may reopen a terminating activity.
    let lifecycleSequence = 0;

    /******************************************************************************
     * Function Name   : appendRecord
     * Description     : Keep the latest display records and report eviction outside the byte stream.
     * Input Parameters: direction, record
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function appendRecord(direction, record) { //20261110-7 add
        const records = direction === 'receive' ? state.received : state.sent;
        const counter = direction === 'receive' ? 'receivedDropped' : 'sentDropped';
        let removed;

        records.push(record);
        removed = Math.max(0, records.length - state.recordLimit);
        if (removed) {
            records.splice(0, removed);
            state[counter] += removed;
        }
    }

    /******************************************************************************
     * Function Name   : clearWindow
     * Description     : Clear only the chosen display history without changing transmission or input.
     * Input Parameters: direction
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function clearWindow(direction) { //20261110-7 add
        if (direction === 'receive') {
            state.received = [];
            state.receivedDropped = 0;
            pendingNotifications = [];
        } else if (direction === 'send') {
            state.sent = [];
            state.sentDropped = 0;
        } else {
            return;
        }
        publish();
    }

    platform.on?.('back', onBack);
    platform.on?.('lifecycle', onLifecycle);
    /******************************************************************************
     * Function Name   : onLifecycle
     * Description     : Suspend writes in background and revalidate the current link and subscription on return.
     * Input Parameters: event
     * Return Value    : Promise resolved after foreground verification or release.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function onLifecycle(event) { //20261110-6 add
        let sequence;
        const connectionId = state.connectionId;
        let timer;
        let result;

        if (state.foreground === Boolean(event.foreground)) {
            return;
        }
        sequence = ++lifecycleSequence;
        state.foreground = Boolean(event.foreground);
        if (exiting) {
            return;
        }
        if (!state.foreground) {
            if (state.status === 'connecting' || activeWrite) {
                await endConnection('应用进入后台，连接已结束，请手动重连');
            } else if (state.status === 'ready' || state.status === 'checking') {
                state.status = 'suspended';
                state.message = '应用在后台，回前台后核实连接';
            } else if (state.scanning) {
                await stopScan();
            }
            publish();
            return;
        }
        if (state.status !== 'suspended' || !state.target) {
            publish();
            return;
        }
        state.status = 'checking';
        state.message = '正在核实连接和接收准备…';
        publish();
        try {
            result = await Promise.race([platform.verify({
                deviceId: state.currentDevice.deviceId, connectionId,
                serviceId: state.target.serviceId, characteristicId: state.target.receiveId,
                sendId: state.target.sendId,
            }), new Promise(function deadline(resolve, reject) {
                timer = clock.setTimeout(function expire() { reject(new Error('前台连接核实超时')); }, 6000);
            })]);
            if (sequence !== lifecycleSequence || connectionId !== state.connectionId || state.status !== 'checking') {
                return;
            }
            if (!result?.ready) {
                throw new Error('原连接或接收准备已失效');
            }
            state.status = 'ready';
            state.message = '连接和接收准备已核实；后台数据可能不完整';
            publish();
        } catch (error) {
            if (sequence === lifecycleSequence && connectionId === state.connectionId && state.status === 'checking') {
                await endConnection(error.message + '，请手动重连');
            }
        } finally {
            clock.clearTimeout(timer);
        }
    }
    /******************************************************************************
     * Function Name   : onBack
     * Description     : Navigate from control first, then revoke all communication before native exit.
     * Input Parameters: None
     * Return Value    : Promise resolved after requesting activity exit.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function onBack() { //20261110-6 add
        if (exiting) {
            return;
        }
        if (state.page === 'control') {
            backToDevices();
            return;
        }
        exiting = true;
        lifecycleSequence++;
        finishPreparation();
        abandonWrite();
        scanSequence++;
        clock.clearTimeout(scanTimer);
        state.connectionId = ++connectionSequence;
        state.scanning = false;
        state.target = null;
        state.status = 'exiting';
        publish();
        try {
            await platform.exit(); // The host releases GATT and scanning even when page callbacks stop.
        } catch (error) {
            state.message = '退出未完成，请再次按返回键';
            exiting = false;
            state.status = 'disconnected';
            publish();
        }
    }

    /******************************************************************************
     * Function Name   : deliveryNotice
     * Description     : Preserve an uncertain-delivery warning across consecutive system loss events.
     * Input Parameters: message
     * Return Value    : Localized notice with the delivery limitation when needed.
     * Date            : 2026.11.10
     ******************************************************************************/
    function deliveryNotice(message) { //20261110-5 add
        return uncertainWrite && !message.includes('未自动重发') ? message + '；未完成写入结果未知，应用未自动重发' : message;
    }

    /******************************************************************************
     * Function Name   : finishPreparation
     * Description     : End the current readiness wait without waiting on its obsolete native callback.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function finishPreparation() { //20261110-5 add
        const preparation = activePreparation;

        if (preparation) {
            activePreparation = null;
            clock.clearTimeout(preparation.deadline);
            preparation.finish(preparation);
        }
    }

    /******************************************************************************
     * Function Name   : cancelConnection
     * Description     : End the currently preparing device only after an explicit user cancellation.
     * Input Parameters: None
     * Return Value    : Promise resolved after native release.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function cancelConnection() { //20261110-5 add
        if (state.status !== 'connecting') {
            return;
        }
        await endConnection('已取消连接');
    }

    /******************************************************************************
     * Function Name   : abandonWrite
     * Description     : End uncertain delivery once when its device session loses eligibility.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function abandonWrite() { //20261110-4 add
        if (activeWrite) {
            uncertainWrite = true;
            clock.clearTimeout(activeWrite.timer);
            activeWrite.record.status = 'unknown';
            activeWrite.settled = true;
            activeWrite.finish?.(); //20261110-5 add - A lost reply must not leave the public send promise pending.
            activeWrite = null;
        }
        state.sending = false;
    }

    /******************************************************************************
     * Function Name   : disconnect
     * Description     : Revoke eligibility before releasing the selected native connection.
     * Input Parameters: None
     * Return Value    : Promise resolved after the release outcome.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function disconnect() { //20261110-4 add
        await endConnection('已主动断开连接');
    }

    /******************************************************************************
     * Function Name   : endConnection
     * Description     : Share native release and ownership checks for disconnect, cancellation and expiry.
     * Input Parameters: message
     * Return Value    : Promise resolved after the release outcome.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function endConnection(message) { //20261110-5 add
        const lease = disconnectLease || { deviceId: state.currentDevice?.deviceId, connectionId: state.connectionId };
        let operation;

        if (!lease.deviceId || state.status === 'disconnecting') {
            return;
        }
        disconnectLease = lease;
        lifecycleSequence++; //20261110-6 add - A foreground check cannot restore a deliberately ended session.
        finishPreparation();
        scanSequence++;
        clock.clearTimeout(scanTimer);
        state.scanning = false;
        abandonWrite();
        pendingNotifications = [];
        operation = ++connectionSequence;
        state.connectionId = operation;
        state.status = 'disconnecting';
        state.target = null;
        state.message = '正在断开设备…';
        publish();
        try {
            await platform.disconnect(lease);
            if (state.connectionId !== operation) {
                return;
            }
            disconnectLease = null;
            state.status = state.available ? 'disconnected' : 'unavailable';
            state.message = deliveryNotice(message);
        } catch (error) {
            if (state.connectionId !== operation) { //20261110-4 add - Ignore a cleanup failure after ownership has moved on.
                return;
            }
            state.status = 'disconnect-error';
            state.message = '断开未确认，请重试断开；' + error.message;
        }
        publish();
    }

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
        let operation;
        let stopped;

        if (!state.foreground || state.status !== 'ready' || !state.target || !state.currentDevice) {
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

        operation = { record, connectionId: state.connectionId, settled: false, timer: null, finish: null };
        uncertainWrite = false;
        stopped = new Promise(function stop(resolve) { operation.finish = resolve; });
        activeWrite = operation;
        operation.timer = clock.setTimeout(function expireWrite() { //20261110-5 add - Retire the uncertain native client before another manual operation.
            if (activeWrite === operation && !operation.settled) {
                void endConnection('写入结果未知，应用未自动重发，请手动重连');
            }
        }, 5000);
        appendRecord('send', record); //20261110-7 change
        state.sending = true;
        publish();
        try {
            await Promise.race([platform.write({
                deviceId: state.currentDevice.deviceId, connectionId: state.connectionId,
                serviceId: state.target.serviceId, characteristicId: state.target.sendId,
                writeNoResponse: state.target.writeNoResponse, value: bytes,
            }), stopped]);
            if (activeWrite === operation && !operation.settled) { //20261110-4 change - Ignore results from an ended device session.
                record.status = 'success';
                state.message = '写入成功；写入结果不代表设备已执行';
            }
        } catch (error) {
            if (activeWrite === operation && !operation.settled) {
                record.status = ['timeout', 'unknown', 'connection'].includes(error.code) ? 'unknown' : 'failed';
                uncertainWrite = record.status === 'unknown';
                state.message = record.status === 'unknown' ? '结果未知，应用未自动重发；' + error.message : error.message || '写入失败';
                if (uncertainWrite) { //20261110-5 add - Never reuse a native client whose outstanding delivery is uncertain.
                    await endConnection(state.message + '；请手动重连');
                }
            }
        }
        if (activeWrite === operation) {
            clock.clearTimeout(operation.timer);
            operation.settled = true;
            activeWrite = null;
            state.sending = false;
            publish();
        }
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
        abandonWrite();
        pendingNotifications = [];
        finishPreparation();
        state.status = state.available ? 'disconnected' : 'unavailable';
        state.target = null;
        state.message = deliveryNotice(event.message || '设备连接已断开，请手动重连');
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
        let record;

        if (!state.target || event.connectionId !== state.connectionId
                || String(event.deviceId).toUpperCase() !== state.currentDevice?.deviceId
                || !matchesUuid(event.serviceId, state.target.serviceId)
                || !matchesUuid(event.characteristicId, state.target.receiveId)) {
            return;
        }
        record = {
            id: ++recordSequence, type: 'data', time, length: bytes.length,
            text: bytes.map(function hex(value) { return value.toString(16).padStart(2, '0').toUpperCase(); }).join(' '),
        };
        if (state.status === 'connecting') {
            pendingNotifications.push(record);
            if (pendingNotifications.length > state.recordLimit) { //20261110-7 add - Preparation cannot bypass the display memory budget.
                pendingNotifications.shift();
                state.receivedDropped++;
            }
            return;
        }
        appendRecord('receive', record); //20261110-7 change
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
        let reconnecting;
        let deadline;
        let preparation;
        let stopped;

        if (exiting || !state.foreground || !device || !state.available || disconnectLease || ['connecting', 'ready', 'checking', 'suspended', 'disconnecting', 'disconnect-error'].includes(state.status)) {
            return;
        }
        reconnecting = state.currentDevice?.deviceId === deviceId && state.wasReady;
        uncertainWrite = false;
        if (state.currentDevice?.deviceId !== deviceId) { //20261110-4 add - Never present another device's bytes or pending input as this target.
            state.received = [];
            state.sent = [];
            state.receivedDropped = 0; //20261110-7 add - Eviction belongs to the selected device history.
            state.sentDropped = 0;
            state.input = '';
            state.wasReady = false;
        }
        connectionId = ++connectionSequence;
        pendingNotifications = [];
        state.connectionId = connectionId;
        state.currentDevice = { ...device };
        state.status = 'connecting';
        preparation = { connectionId, deadline: null, finish: null };
        stopped = new Promise(function stop(resolve) { preparation.finish = resolve; });
        activePreparation = preparation;
        deadline = clock.setTimeout(function expirePreparation() { //20261110-5 change - One release path preserves the ending reason and identity.
            if (state.connectionId !== connectionId || state.status !== 'connecting') {
                return;
            }
            void endConnection('连接准备超时，请重试');
        }, 20000);
        preparation.deadline = deadline;
        try {
            result = await Promise.race([stopScan(), stopped]);
            if (result === preparation || state.connectionId !== connectionId || state.status !== 'connecting') {
                return;
            }
            state.message = '正在连接并准备接收…';
            publish();
            result = await Promise.race([platform.connect({ deviceId, connectionId }), stopped]);
            if (result === preparation || state.connectionId !== connectionId || state.status !== 'connecting') {
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
            result = await Promise.race([platform.subscribe({ deviceId, connectionId, serviceId: service.uuid, characteristicId: receive.uuid }), stopped]);
            if (result === preparation || state.connectionId !== connectionId || state.status !== 'connecting') {
                return;
            }
            state.status = 'ready';
            if (reconnecting) {
                appendReconnectMarker();
            }
            for (const record of pendingNotifications) { //20261110-7 change - Flush without an unbounded spread argument list.
                appendRecord('receive', record);
            }
            pendingNotifications = [];
            state.wasReady = true;
            state.message = '设备已就绪，点击设备卡片进入控制页面';
        } catch (error) {
            if (state.connectionId !== connectionId || state.status !== 'connecting') { //20261110-5 change - An ended readiness wait cannot re-enter cleanup.
                return;
            }
            await endConnection(error.message || '连接准备失败，请重试'); //20261110-5 change - Failed preparation retains the same release protection as cancellation.
        } finally {
            clock.clearTimeout(deadline);
            if (activePreparation === preparation) {
                activePreparation = null;
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

    /******************************************************************************
     * Function Name   : appendReconnectMarker
     * Description     : Mark a resumed same-device session without inventing received bytes.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function appendReconnectMarker() { //20261110-4 add
        const time = new Date(clock.now ? clock.now() : Date.now()).toLocaleTimeString('zh-CN', { hour12: false });

        appendRecord('receive', { id: ++recordSequence, type: 'marker', time, text: '设备已重新连接' }); //20261110-7 change
        appendRecord('send', { id: ++recordSequence, type: 'marker', time, text: '设备已重新连接' });
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
            finishPreparation();
            abandonWrite();
            pendingNotifications = [];
            state.available = false;
            state.target = null; //20261110-2 add - No notification remains eligible after adapter loss.
            scanSequence++;
            clock.clearTimeout(scanTimer);
            state.scanning = false;
            state.status = 'unavailable';
            state.message = deliveryNotice(event.message || '系统蓝牙已关闭，请开启后重新检查');
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

        if (exiting || !state.foreground || !state.available || disconnectLease || ['connecting', 'ready', 'checking', 'suspended', 'disconnecting', 'disconnect-error'].includes(state.status)) {
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

        if (exiting || !state.foreground || disconnectLease || ['initializing', 'connecting', 'ready', 'checking', 'suspended', 'disconnecting', 'disconnect-error'].includes(state.status)) { //20261110-6 change - A terminating activity cannot restart communication.
            return;
        }
        state.page = 'devices';
        state.status = 'initializing';
        publish();
        try {
            result = await platform.initialize();
            if (exiting) { //20261110-6 add - Permission dialogs may complete after explicit activity exit.
                return;
            }
            state.available = Boolean(result.available);
            state.status = result.available ? 'idle' : 'unavailable';
            state.message = result.message || (result.available ? '蓝牙已开启' : '蓝牙不可用');
            if (result.available) { //20261110-1 add - Discover automatically only after initialization permits scanning.
                await scan();
            }
        } catch (error) {
            if (exiting) {
                return;
            }
            state.status = 'unavailable';
            state.available = false;
            state.scanning = false;
            state.message = error.message || '蓝牙初始化失败';
        }
        publish();
    }

    return app;
}
