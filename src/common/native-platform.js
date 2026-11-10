//20261110-0 add - Adapt the local Android JSON transport to a small public platform interface.
/******************************************************************************
 * Function Name   : createNativePlatform
 * Description     : Match native replies exactly once and report missing transport honestly.
 * Input Parameters: transport, host, clock
 * Return Value    : Native platform facade.
 * Date            : 2026.11.10
 ******************************************************************************/
export function createNativePlatform(transport, host = globalThis, clock = globalThis) {
    const pending = new Map();
    let sequence = 0;

    /******************************************************************************
     * Function Name   : receiveReply
     * Description     : Settle only the request identified by the Android reply.
     * Input Parameters: id, success, value
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function receiveReply(id, success, value) {
        const entry = pending.get(id);
        const error = new Error(value?.message || '蓝牙操作失败');

        if (!entry) {
            return;
        }
        pending.delete(id);
        clock.clearTimeout(entry.timer);
        if (success) {
            entry.resolve(value);
        } else {
            error.code = value?.code || 'native';
            entry.reject(error);
        }
    }

    /******************************************************************************
     * Function Name   : call
     * Description     : Send one native operation without exposing browser Bluetooth.
     * Input Parameters: method, options
     * Return Value    : Promise for the corresponding native result.
     * Date            : 2026.11.10
     ******************************************************************************/
    function call(method, options = {}) {
        return new Promise(function dispatch(resolve, reject) {
            const id = ++sequence;
            let timer;

            if (!transport) {
                reject(new Error('当前环境不支持蓝牙，请在安卓应用中使用'));
                return;
            }
            timer = clock.setTimeout(function expire() {
                receiveReply(id, false, { code: 'timeout', message: '蓝牙操作等待超时' });
            }, 15000);
            pending.set(id, { resolve, reject, timer });
            try {
                transport.postMessage(JSON.stringify({ id, method, options }));
            } catch (error) {
                receiveReply(id, false, { message: error.message });
            }
        });
    }

    host.__suquReply = receiveReply;
    return { initialize: function initialize() { return call('initialize'); } };
}
