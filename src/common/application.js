//20261110-0 add - Own the application state independently of page lifetime.
/******************************************************************************
 * Function Name   : createApplication
 * Description     : Expose device-page operations and observable application state.
 * Input Parameters: platform
 * Return Value    : Application facade.
 * Date            : 2026.11.10
 ******************************************************************************/
export function createApplication(platform) {
    const listeners = new Set();
    const state = { page: 'devices', status: 'idle', message: '', devices: [] };
    const app = { state, start, subscribe };

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
            state.status = result.available ? 'idle' : 'unavailable';
            state.message = result.message || (result.available ? '蓝牙已开启' : '蓝牙不可用');
        } catch (error) {
            state.status = 'unavailable';
            state.message = error.message || '蓝牙初始化失败';
        }
        publish();
    }

    return app;
}
