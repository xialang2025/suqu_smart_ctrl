//20261110-1 add - Substitute only Android operations, native events and time.
/******************************************************************************
 * Function Name   : createSystem
 * Description     : Provide a controllable operating-system boundary for real application paths.
 * Input Parameters: options
 * Return Value    : Platform, clock, event delivery and recorded native requests.
 * Date            : 2026.11.10
 ******************************************************************************/
export function createSystem(options = {}) {
    const listeners = new Map();
    const timers = new Map();
    const calls = [];
    let time = 0;
    let sequence = 0;
    const clock = {
        now: function now() { return time; },
        setTimeout: function setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { at: time + delay, callback }); return id; },
        clearTimeout: function clearTimeout(id) { timers.delete(id); },
    };
    const platform = {
        initialize: async function initialize() { calls.push({ method: 'initialize' }); return options.initialization || { available: true }; },
        startScan: async function startScan(value) { calls.push({ method: 'startScan', ...value }); return {}; },
        stopScan: async function stopScan(value) { calls.push({ method: 'stopScan', ...value }); return {}; },
        //20261110-2 add - Model only the Android GATT boundary, never application internals.
        connect: async function connect(value) {
            calls.push({ method: 'connect', ...value });
            return { mtu: 23, services: options.services || [{ uuid: 'FFE0', characteristics: [
                { uuid: 'FFE1', properties: { write: true } },
                { uuid: 'FFE2', properties: { notify: true } },
            ] }] };
        },
        subscribe: async function subscribe(value) { calls.push({ method: 'subscribe', ...value }); return {}; },
        disconnect: async function disconnect(value) { calls.push({ method: 'disconnect', ...value }); return {}; },
        on: function on(name, callback) { listeners.set(name, [...(listeners.get(name) || []), callback]); },
    };

    /******************************************************************************
     * Function Name   : emit
     * Description     : Deliver an operating-system event through registered public listeners.
     * Input Parameters: name, value
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    function emit(name, value) {
        for (const callback of listeners.get(name) || []) {
            callback(value);
        }
    }

    /******************************************************************************
     * Function Name   : advance
     * Description     : Advance external time while allowing application promises to settle.
     * Input Parameters: duration
     * Return Value    : Promise resolved after due callbacks.
     * Date            : 2026.11.10
     ******************************************************************************/
    async function advance(duration) {
        const end = time + duration;
        let next;

        while (true) {
            next = [...timers.entries()].filter(function due(entry) { return entry[1].at <= end; }).sort(function byTime(a, b) { return a[1].at - b[1].at; })[0];
            if (!next) {
                break;
            }
            time = next[1].at;
            timers.delete(next[0]);
            next[1].callback();
            await new Promise(setImmediate);
        }
        time = end;
        await new Promise(setImmediate);
    }

    return { platform, clock, calls, emit, advance };
}
