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
    const state = { page: 'devices', status: 'idle', message: '', devices: [], scanning: false, available: false };
    const app = { state, start, subscribe, scan, stopScan };
    let scanSequence = 0;
    let scanTimer = null;

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

        if (!state.available) {
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
