//20261110-0 add - Host only local application assets and the independent native bridge.
package cn.suqu.smartcontrol;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.LocationManager;
import android.provider.Settings;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Locale;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.Arrays;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private BluetoothAdapter adapter;
    //20261110-1 add - Keep scanner and permission ownership in the activity.
    private final List<Integer> opening = new ArrayList<>();
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private int activeScanId;
    private boolean requestingPermissions;
    private boolean requestingEnable;
    //20261110-2 add - Keep the GATT identity distinct from scan and page state.
    private BluetoothGatt gatt;
    private int activeConnectionId;
    private String activeDeviceId = "";
    private int negotiatedMtu = 23;
    private int pendingConnect;
    private int pendingSubscribe;
    private Runnable connectDeadline;
    private Runnable subscribeDeadline;
    //20261110-3 add - One native write owns its callback and deadline.
    private int pendingWrite;
    private UUID pendingWriteUuid;
    private Runnable writeDeadline;
    //20261110-6 add - Native gates cover queued page commands while lifecycle events cross the bridge.
    private boolean foreground;
    private boolean receiveReady;

    /******************************************************************************
     * Function Name   : onCreate
     * Description     : Load the local interface without a remote network dependency.
     * Input Parameters: state
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    @Override
    protected void onCreate(Bundle state) {
        BluetoothManager manager;
        WebSettings settings;

        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(243, 246, 250));
        getWindow().setNavigationBarColor(Color.rgb(243, 246, 250));
        manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        adapter = manager == null ? null : manager.getAdapter();
        web = new WebView(this);
        settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new NativeBridge(), "NativeBle");
        web.setWebViewClient(new LocalContent());
        if (Build.VERSION.SDK_INT >= 33) {
            //20261110-1 change - Bluetooth broadcasts may originate from a privileged UID outside the system UID.
            registerReceiver(adapterReceiver, new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(adapterReceiver, new IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED));
        }
        setContentView(web);
        if (Build.VERSION.SDK_INT >= 33) { //20261110-6 add - Handle gesture back on current Android versions.
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::requestBack);
        }
        web.loadUrl(ORIGIN + "/index.html");
    }

    /******************************************************************************
     * Function Name   : object
     * Description     : Build a bridge result without exposing Java implementation types.
     * Input Parameters: alternating keys and values
     * Return Value    : JSON result.
     * Date            : 2026.11.10
     ******************************************************************************/
    private JSONObject object(Object... values) {
        JSONObject result = new JSONObject();
        int index;

        try {
            for (index = 0; index < values.length; index += 2) {
                result.put(String.valueOf(values[index]), values[index + 1]);
            }
        } catch (Exception error) {
            throw new IllegalArgumentException("Invalid native result", error);
        }
        return result;
    }

    /******************************************************************************
     * Function Name   : reply
     * Description     : Return exactly the native request identity to the local page.
     * Input Parameters: id, success, value
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void reply(int id, boolean success, JSONObject value) {
        String script = "window.__suquReply && window.__suquReply(" + id + "," + success + "," + value + ")";

        handler.post(() -> {
            if (web != null) {
                web.evaluateJavascript(script, null);
            }
        });
    }

    /******************************************************************************
     * Function Name   : dispatch
     * Description     : Handle only supported local application operations.
     * Input Parameters: packet
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void dispatch(JSONObject packet) {
        int id = packet.optInt("id");
        String method = packet.optString("method");
        JSONObject options = packet.optJSONObject("options") == null ? new JSONObject() : packet.optJSONObject("options");

        try {
            if ("initialize".equals(method)) { //20261110-1 change - Finish initialization after system decisions.
                initialize(id);
            } else if ("startScan".equals(method)) {
                startDiscovery(id, options.optInt("scanId"));
            } else if ("stopScan".equals(method)) {
                if (options.optInt("scanId") == activeScanId) {
                    stopDiscovery();
                }
                reply(id, true, object());
            } else if ("connect".equals(method)) {
                connectDevice(id, options);
            } else if ("subscribe".equals(method)) {
                subscribeDevice(id, options);
            } else if ("write".equals(method)) {
                writeDevice(id, options);
            } else if ("verify".equals(method)) { //20261110-6 add
                verifyConnection(id, options);
            } else if ("exit".equals(method)) {
                stopDiscovery();
                closeConnection("应用已退出", false);
                reply(id, true, object());
                finishAndRemoveTask();
            } else if ("disconnect".equals(method)) {
                if (options.optInt("connectionId") == activeConnectionId) {
                    closeConnection("连接已结束", false);
                }
                reply(id, true, object());
            } else if ("openSettings".equals(method)) {
                if (Build.VERSION.SDK_INT < 31 && !locationEnabled()) {
                    startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
                } else {
                    startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                }
                reply(id, true, object());
            } else {
                reply(id, false, object("message", "当前操作尚不可用", "code", "unsupported"));
            }
        } catch (Exception error) {
            reply(id, false, object("message", error instanceof SecurityException ? "蓝牙权限不足，请重新检查权限" : "蓝牙平台操作失败，请重新检查", "code", "native"));
        }
    }

    /******************************************************************************
     * Function Name   : permissionsGranted
     * Description     : Check foreground BLE permissions for this Android version.
     * Input Parameters: None
     * Return Value    : True when system permissions permit scanning.
     * Date            : 2026.11.10
     ******************************************************************************/
    private boolean permissionsGranted() { //20261110-1 add
        if (Build.VERSION.SDK_INT >= 31) {
            return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /******************************************************************************
     * Function Name   : locationEnabled
     * Description     : Check the location-service prerequisite on legacy scan APIs.
     * Input Parameters: None
     * Return Value    : True when a legacy location provider is enabled.
     * Date            : 2026.11.10
     ******************************************************************************/
    private boolean locationEnabled() { //20261110-1 add
        LocationManager location = (LocationManager) getSystemService(Context.LOCATION_SERVICE);

        return location != null && (location.isProviderEnabled(LocationManager.GPS_PROVIDER) || location.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
    }

    /******************************************************************************
     * Function Name   : initialize
     * Description     : Resolve initialization only after system permission and Bluetooth decisions.
     * Input Parameters: id
     * Return Value    : None; replies after system prerequisites settle.
     * Date            : 2026.11.10
     ******************************************************************************/
    private void initialize(int id) { //20261110-1 add
        String[] permissions;

        opening.add(id);
        if (adapter == null) {
            finishOpening(false, "此手机不支持蓝牙");
            return;
        }
        if (!permissionsGranted()) {
            if (!requestingPermissions) {
                requestingPermissions = true;
                permissions = Build.VERSION.SDK_INT >= 31
                        ? new String[] { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }
                        : new String[] { Manifest.permission.ACCESS_FINE_LOCATION };
                requestPermissions(permissions, 41);
            }
            return;
        }
        try {
            if (!adapter.isEnabled()) {
                if (!requestingEnable) {
                    requestingEnable = true;
                    startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), 42);
                }
                return;
            }
            if (Build.VERSION.SDK_INT < 31 && !locationEnabled()) {
                finishOpening(false, "请开启系统定位服务后重新检查蓝牙");
                return;
            }
            finishOpening(true, "蓝牙已开启");
        } catch (SecurityException error) {
            finishOpening(false, "蓝牙权限不足，请重新检查权限");
        }
    }

    /******************************************************************************
     * Function Name   : finishOpening
     * Description     : Complete each pending initialization once with the actual system result.
     * Input Parameters: available, message
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void finishOpening(boolean available, String message) { //20261110-1 add
        int index;

        for (index = 0; index < opening.size(); index++) {
            reply(opening.get(index), true, object("available", available, "message", message));
        }
        opening.clear();
    }

    /******************************************************************************
     * Function Name   : onRequestPermissionsResult
     * Description     : Resume initialization after permission grant without repeating a declined prompt.
     * Input Parameters: requestCode, permissions, results
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) { //20261110-1 add
        int id;

        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 41) {
            requestingPermissions = false;
            if (!permissionsGranted()) {
                finishOpening(false, "未授予蓝牙所需权限，请在系统设置中开启后重新检查");
            } else if (!opening.isEmpty()) {
                id = opening.remove(0);
                initialize(id);
            }
        }
    }

    /******************************************************************************
     * Function Name   : onActivityResult
     * Description     : Report Bluetooth enablement without reopening a declined system dialog.
     * Input Parameters: requestCode, resultCode, data
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) { //20261110-1 add
        int id;

        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 42) {
            requestingEnable = false;
            if (resultCode != RESULT_OK) {
                finishOpening(false, "系统蓝牙未开启，请开启后重新检查");
            } else if (!opening.isEmpty()) {
                id = opening.remove(0);
                initialize(id);
            }
        }
    }

    /******************************************************************************
     * Function Name   : emit
     * Description     : Deliver a system event to the single application owner.
     * Input Parameters: name, value
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void emit(String name, JSONObject value) { //20261110-1 add
        String script = "window.__suquEvent && window.__suquEvent(" + JSONObject.quote(name) + "," + value + ")";

        if (web != null) {
            web.evaluateJavascript(script, null);
        }
    }

    /******************************************************************************
     * Function Name   : startDiscovery
     * Description     : Start a foreground scan with an explicit operation identity.
     * Input Parameters: id, scanId
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void startDiscovery(int id, int scanId) { //20261110-1 add
        if (!foreground || !permissionsGranted()) { //20261110-6 change - Delayed page requests cannot start background scanning.
            reply(id, false, object("message", "蓝牙权限不足，请重新检查权限"));
            return;
        }
        if (adapter == null || !adapter.isEnabled()) {
            reply(id, false, object("message", "系统蓝牙未开启"));
            return;
        }
        stopDiscovery();
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            reply(id, false, object("message", "无法启动蓝牙扫描，请重新检查"));
            return;
        }
        activeScanId = scanId;
        scanCallback = new ScanCallback() {
                    /******************************************************************************
                     * Function Name   : onScanResult
                     * Description     : Forward advertisements only while this scan callback is still current.
                     * Input Parameters: callbackType, result
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onScanResult(int callbackType, ScanResult result) { //20261110-1 add
                        handler.post(() -> {
                            String name;

                            if (scanCallback != this) {
                                return;
                            }
                            try {
                                name = result.getScanRecord() == null ? null : result.getScanRecord().getDeviceName();
                                emit("deviceFound", object("scanId", scanId, "deviceId", result.getDevice().getAddress(),
                                        "name", name == null ? "" : name, "rssi", result.getRssi()));
                            } catch (SecurityException error) {
                                stopDiscovery();
                                emit("scanFailed", object("scanId", scanId, "message", "蓝牙权限已失效，请重新检查"));
                            }
                        });
                    }
                    /******************************************************************************
                     * Function Name   : onBatchScanResults
                     * Description     : Preserve every advertisement in a batched system callback.
                     * Input Parameters: results
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onBatchScanResults(List<ScanResult> results) { //20261110-1 add
                        int index;

                        for (index = 0; index < results.size(); index++) {
                            onScanResult(0, results.get(index));
                        }
                    }
                    /******************************************************************************
                     * Function Name   : onScanFailed
                     * Description     : End the matching scan and surface rate limits or native errors.
                     * Input Parameters: code
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onScanFailed(int code) { //20261110-1 add
                        handler.post(() -> {
                            if (scanCallback == this) {
                                stopDiscovery();
                                emit("scanFailed", object("scanId", scanId, "message",
                                        code == 6 ? "扫描过于频繁，请稍后重试" : "扫描失败，请重新扫描", "code", code));
                            }
                        });
                    }

        };
        scanner.startScan(null, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
        reply(id, true, object("scanId", scanId));
    }

    /******************************************************************************
     * Function Name   : stopDiscovery
     * Description     : Invalidate callbacks before stopping the operating-system scanner.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void stopDiscovery() { //20261110-1 add
        ScanCallback previous = scanCallback;

        scanCallback = null;
        activeScanId = 0;
        if (scanner != null && previous != null) {
            try {
                scanner.stopScan(previous);
            } catch (Exception error) {
                android.util.Log.w("SUQU", "Scanner already unavailable");
            }
        }
        scanner = null;
    }
    private final BroadcastReceiver adapterReceiver = new BroadcastReceiver() {
        /******************************************************************************
         * Function Name   : onReceive
         * Description     : Revoke discovery eligibility when the system turns Bluetooth off.
         * Input Parameters: context, intent
         * Return Value    : None
         * Date            : 2026.11.10
         ******************************************************************************/
        @Override
        public void onReceive(Context context, Intent intent) { //20261110-1 add
            int value = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);

            if (!BluetoothAdapter.ACTION_STATE_CHANGED.equals(intent.getAction())) {
                return;
            }
            if (value == BluetoothAdapter.STATE_OFF || value == BluetoothAdapter.STATE_TURNING_OFF) {
                stopDiscovery();
                closeConnection("系统蓝牙已关闭", true);
                emit("adapterState", object("available", false, "message", "系统蓝牙已关闭，请开启后重新检查"));
            }
        }
    };

    /******************************************************************************
     * Function Name   : connectDevice
     * Description     : Open one explicitly identified GATT client and prepare its service capabilities.
     * Input Parameters: id, options
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void connectDevice(int id, JSONObject options) { //20261110-2 add
        String deviceId = options.optString("deviceId");
        int connectionId = options.optInt("connectionId");

        if (!foreground || gatt != null || !permissionsGranted() || adapter == null || !adapter.isEnabled()) { //20261110-6 change
            reply(id, false, object("message", gatt != null ? "请先断开当前设备" : "蓝牙条件不足，请重新检查"));
            return;
        }
        stopDiscovery();
        activeConnectionId = connectionId;
        activeDeviceId = deviceId;
        negotiatedMtu = 23;
        pendingConnect = id;
        connectDeadline = () -> {
            if (activeConnectionId == connectionId && pendingConnect == id) {
                closeConnection("连接准备超时，请重试", true);
            }
        };
        gatt = adapter.getRemoteDevice(deviceId).connectGatt(this, false, new BluetoothGattCallback() {
                    /******************************************************************************
                     * Function Name   : onConnectionStateChange
                     * Description     : Advance only the current GATT client into MTU and service preparation.
                     * Input Parameters: source, status, newState
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onConnectionStateChange(BluetoothGatt source, int status, int newState) { //20261110-2 add
                        handler.post(() -> {
                            if (source != gatt || connectionId != activeConnectionId) {
                            try {
                                source.close();
                            } catch (SecurityException error) {
                                android.util.Log.w("SUQU", "Stale GATT already unavailable");
                            }
                                return;
                            }
                            if (status != BluetoothGatt.GATT_SUCCESS || newState == BluetoothProfile.STATE_DISCONNECTED) {
                                closeConnection("设备连接已断开，请手动重连", true);
                            } else if (newState == BluetoothProfile.STATE_CONNECTED) {
                                try {
                                    if (!source.requestMtu(247) && !source.discoverServices()) {
                                        closeConnection("无法准备设备服务", true);
                                    }
                                } catch (SecurityException error) {
                                    closeConnection("蓝牙权限已失效", true);
                                }
                            }
                        });
                    }

                    /******************************************************************************
                     * Function Name   : onMtuChanged
                     * Description     : Use the actual negotiated MTU rather than the requested value.
                     * Input Parameters: source, mtu, status
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onMtuChanged(BluetoothGatt source, int mtu, int status) { //20261110-2 add
                        handler.post(() -> {
                            if (source != gatt || connectionId != activeConnectionId) {
                                return;
                            }
                            negotiatedMtu = status == BluetoothGatt.GATT_SUCCESS ? Math.max(23, mtu) : 23;
                        try {
                            if (pendingConnect != 0 && !source.discoverServices()) {
                                closeConnection("无法发现设备服务", true);
                            }
                        } catch (SecurityException error) {
                            closeConnection("蓝牙权限已失效", true);
                            }
                        });
                    }

                    /******************************************************************************
                     * Function Name   : onServicesDiscovered
                     * Description     : Return discovered capabilities without marking notification readiness.
                     * Input Parameters: source, status
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onServicesDiscovered(BluetoothGatt source, int status) { //20261110-2 add
                        handler.post(() -> {
                            int request;

                            if (source != gatt || connectionId != activeConnectionId || pendingConnect == 0) {
                                return;
                            }
                            if (status != BluetoothGatt.GATT_SUCCESS) {
                                closeConnection("设备服务发现失败", true);
                                return;
                            }
                            request = pendingConnect;
                            pendingConnect = 0;
                            handler.removeCallbacks(connectDeadline);
                            reply(request, true, object("mtu", negotiatedMtu, "services", describeServices(source)));
                        });
                    }

                    /******************************************************************************
                     * Function Name   : onDescriptorWrite
                     * Description     : Complete receive preparation only after the CCCD write result.
                     * Input Parameters: source, descriptor, status
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onDescriptorWrite(BluetoothGatt source, BluetoothGattDescriptor descriptor, int status) { //20261110-2 add
                        handler.post(() -> {
                            int request;

                            if (source != gatt || connectionId != activeConnectionId || pendingSubscribe == 0) {
                                return;
                            }
                            request = pendingSubscribe;
                            pendingSubscribe = 0;
                            handler.removeCallbacks(subscribeDeadline);
                            receiveReady = foreground && status == BluetoothGatt.GATT_SUCCESS; //20261110-6 change - A background descriptor reply cannot authorize a write.
                            reply(request, receiveReady, object("ready", receiveReady, "message", receiveReady ? "接收已准备" : "接收通知开启失败"));
                        });
                    }
                    /******************************************************************************
                     * Function Name   : onCharacteristicWrite
                     * Description     : Settle the current write independently of incoming receive notifications.
                     * Input Parameters: source, characteristic, status
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onCharacteristicWrite(BluetoothGatt source, BluetoothGattCharacteristic characteristic, int status) { //20261110-3 add
                        handler.post(() -> {
                            int request;

                            if (source != gatt || connectionId != activeConnectionId || pendingWrite == 0
                                    || !characteristic.getUuid().equals(pendingWriteUuid)) {
                                return;
                            }
                            request = pendingWrite;
                            pendingWrite = 0;
                            pendingWriteUuid = null;
                            handler.removeCallbacks(writeDeadline);
                            reply(request, status == BluetoothGatt.GATT_SUCCESS, object("code", "rejected",
                                    "message", status == BluetoothGatt.GATT_SUCCESS ? "写入成功" : "写入失败"));
                        });
                    }


                    /******************************************************************************
                     * Function Name   : onCharacteristicChanged
                     * Description     : Snapshot notifications on older Android callback APIs.
                     * Input Parameters: source, characteristic
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onCharacteristicChanged(BluetoothGatt source, BluetoothGattCharacteristic characteristic) { //20261110-2 add
                        deliverNotification(source, connectionId, characteristic, characteristic.getValue());
                    }

                    /******************************************************************************
                     * Function Name   : onCharacteristicChanged
                     * Description     : Use the immutable notification value provided by modern Android.
                     * Input Parameters: source, characteristic, value
                     * Return Value    : None
                     * Date            : 2026.11.10
                     ******************************************************************************/
                    @Override
                    public void onCharacteristicChanged(BluetoothGatt source, BluetoothGattCharacteristic characteristic, byte[] value) { //20261110-2 add
                        deliverNotification(source, connectionId, characteristic, value);
                    }

        }, BluetoothDevice.TRANSPORT_LE);
        if (gatt == null) {
            closeConnection("无法创建蓝牙连接", true);
            return;
        }
        handler.postDelayed(connectDeadline, 20000);
    }

    /******************************************************************************
     * Function Name   : describeServices
     * Description     : Describe real GATT service and characteristic properties for profile validation.
     * Input Parameters: source
     * Return Value    : JSON array of discovered capabilities.
     * Date            : 2026.11.10
     ******************************************************************************/
    private JSONArray describeServices(BluetoothGatt source) { //20261110-2 add
        JSONArray result = new JSONArray();
        JSONArray characteristics;
        List<BluetoothGattService> services = source.getServices();
        List<BluetoothGattCharacteristic> values;
        BluetoothGattService service;
        BluetoothGattCharacteristic characteristic;
        int serviceIndex;
        int valueIndex;
        int properties;

        for (serviceIndex = 0; serviceIndex < services.size(); serviceIndex++) {
            service = services.get(serviceIndex);
            characteristics = new JSONArray();
            values = service.getCharacteristics();
            for (valueIndex = 0; valueIndex < values.size(); valueIndex++) {
                characteristic = values.get(valueIndex);
                properties = characteristic.getProperties();
                characteristics.put(object("uuid", characteristic.getUuid().toString(),
                        "properties", object("write", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0,
                        "writeNoResponse", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0,
                        "notify", (properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0,
                        "indicate", (properties & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0)));
            }
            result.put(object("uuid", service.getUuid().toString(), "characteristics", characteristics));
        }
        return result;
    }

    /******************************************************************************
     * Function Name   : profileUuid
     * Description     : Expand short profile UUIDs while preserving exact full UUIDs.
     * Input Parameters: value
     * Return Value    : Parsed UUID.
     * Date            : 2026.11.10
     ******************************************************************************/
    private UUID profileUuid(String value) { //20261110-2 add
        return UUID.fromString(value.length() == 4 ? "0000" + value + "-0000-1000-8000-00805f9b34fb" : value);
    }

    /******************************************************************************
     * Function Name   : receiveCharacteristic
     * Description     : Find only the requested characteristic in the current GATT service.
     * Input Parameters: options
     * Return Value    : Matching characteristic or null.
     * Date            : 2026.11.10
     ******************************************************************************/
    private BluetoothGattCharacteristic receiveCharacteristic(JSONObject options) { //20261110-2 add
        BluetoothGattService service;

        if (gatt == null || options.optInt("connectionId") != activeConnectionId
                || !options.optString("deviceId").equalsIgnoreCase(activeDeviceId)) {
            return null;
        }
        service = gatt.getService(profileUuid(options.optString("serviceId")));
        return service == null ? null : service.getCharacteristic(profileUuid(options.optString("characteristicId")));
    }

    /******************************************************************************
     * Function Name   : subscribeDevice
     * Description     : Enable only the requested receive notification and wait for its descriptor result.
     * Input Parameters: id, options
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void subscribeDevice(int id, JSONObject options) { //20261110-2 add
        BluetoothGattCharacteristic characteristic = receiveCharacteristic(options);
        BluetoothGattDescriptor descriptor;
        byte[] value;
        BluetoothGatt source = gatt;

        if (!foreground || characteristic == null || pendingSubscribe != 0) { //20261110-6 change
            reply(id, false, object("message", "接收通道不可用"));
            return;
        }
        descriptor = characteristic.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"));
        if (descriptor == null || !source.setCharacteristicNotification(characteristic, true)) {
            reply(id, false, object("message", "接收通知开启失败"));
            return;
        }
        value = (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
                ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE : BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
        pendingSubscribe = id;
        receiveReady = false;
        subscribeDeadline = () -> {
            if (gatt == source && pendingSubscribe == id) {
                closeConnection("接收通知准备超时", true);
            }
        };
        descriptor.setValue(value);
        if (!source.writeDescriptor(descriptor)) {
            pendingSubscribe = 0;
            reply(id, false, object("message", "接收通知准备被系统拒绝"));
            return;
        }
        handler.postDelayed(subscribeDeadline, 5000);
    }

    /******************************************************************************
     * Function Name   : deliverNotification
     * Description     : Snapshot each native byte fragment before dispatching on the UI thread.
     * Input Parameters: source, connectionId, characteristic, value
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void deliverNotification(BluetoothGatt source, int connectionId, BluetoothGattCharacteristic characteristic, byte[] value) { //20261110-2 add
        byte[] snapshot = value == null ? new byte[0] : Arrays.copyOf(value, value.length);
        String serviceId = characteristic.getService().getUuid().toString();
        String characteristicId = characteristic.getUuid().toString();

        handler.post(() -> {
            JSONArray bytes = new JSONArray();
            int index;

            if (source != gatt || connectionId != activeConnectionId) {
                return;
            }
            for (index = 0; index < snapshot.length; index++) {
                bytes.put(snapshot[index] & 255);
            }
            emit("notification", object("deviceId", activeDeviceId, "connectionId", connectionId,
                    "serviceId", serviceId, "characteristicId", characteristicId, "value", bytes));
        });
    }

    /******************************************************************************
     * Function Name   : closeConnection
     * Description     : Detach ownership before releasing GATT and settling pending preparation requests.
     * Input Parameters: message, notify
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void closeConnection(String message, boolean notify) { //20261110-2 add
        BluetoothGatt previous = gatt;
        int connectionId = activeConnectionId;
        String deviceId = activeDeviceId;
        int connecting = pendingConnect;
        int subscribing = pendingSubscribe;
        int writing = pendingWrite;

        gatt = null;
        receiveReady = false; //20261110-6 add
        activeConnectionId = 0;
        pendingConnect = 0;
        pendingSubscribe = 0;
        pendingWrite = 0;
        pendingWriteUuid = null;
        if (connectDeadline != null) {
            handler.removeCallbacks(connectDeadline);
        }
        if (subscribeDeadline != null) {
            handler.removeCallbacks(subscribeDeadline);
        }
        if (writeDeadline != null) {
            handler.removeCallbacks(writeDeadline);
        }
        if (previous != null) {
            try {
                previous.disconnect();
            } catch (Exception error) {
                android.util.Log.w("SUQU", "GATT disconnect already unavailable");
            }
            try {
                previous.close();
            } catch (SecurityException error) {
                android.util.Log.w("SUQU", "GATT close already unavailable");
            }
        }
        if (connecting != 0) {
            reply(connecting, false, object("message", message, "code", "connection"));
        }
        if (subscribing != 0) {
            reply(subscribing, false, object("message", message, "code", "connection"));
        }
        if (writing != 0) {
            reply(writing, false, object("message", message, "code", "unknown"));
        }
        if (notify && connectionId != 0) {
            emit("connectionChanged", object("deviceId", deviceId, "connectionId", connectionId, "connected", false, "message", message));
        }
    }

    /******************************************************************************
     * Function Name   : writeDevice
     * Description     : Write one payload according to actual characteristic and MTU capabilities.
     * Input Parameters: id, options
     * Return Value    : None; resolves after the native write outcome.
     * Date            : 2026.11.10
     ******************************************************************************/
    private void writeDevice(int id, JSONObject options) { //20261110-3 add
        BluetoothGattCharacteristic characteristic = receiveCharacteristic(options);
        BluetoothGatt source = gatt;
        JSONArray values = options.optJSONArray("value");
        byte[] payload;
        Object raw;
        int index;
        int value;
        int mode;
        boolean accepted;

        if (!foreground || !receiveReady || characteristic == null || pendingConnect != 0 || pendingSubscribe != 0 || pendingWrite != 0) { //20261110-6 change
            reply(id, false, object("code", "rejected", "message", "设备未就绪或正在处理写入"));
            return;
        }
        if (values == null || values.length() == 0 || values.length() > Math.min(512, negotiatedMtu - 3)) {
            reply(id, false, object("code", "rejected", "message", "数据长度超出当前单次写入能力"));
            return;
        }
        payload = new byte[values.length()];
        for (index = 0; index < values.length(); index++) {
            raw = values.opt(index);
            if (!(raw instanceof Number)) {
                reply(id, false, object("code", "rejected", "message", "发送数据不是完整字节"));
                return;
            }
            value = ((Number) raw).intValue();
            if (value < 0 || value > 255 || ((Number) raw).doubleValue() != value) {
                reply(id, false, object("code", "rejected", "message", "发送字节超出范围"));
                return;
            }
            payload[index] = (byte) value;
        }
        if ((characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) {
            mode = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
        } else if ((characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
            mode = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
        } else {
            reply(id, false, object("code", "rejected", "message", "目标特征不支持写入"));
            return;
        }
        pendingWrite = id;
        pendingWriteUuid = characteristic.getUuid();
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                accepted = source.writeCharacteristic(characteristic, payload, mode) == 0;
            } else {
                characteristic.setWriteType(mode);
                characteristic.setValue(payload);
                accepted = source.writeCharacteristic(characteristic);
            }
        } catch (SecurityException error) {
            pendingWrite = 0;
            pendingWriteUuid = null;
            reply(id, false, object("code", "rejected", "message", "蓝牙权限不足，无法写入"));
            return;
        } catch (RuntimeException error) {
            closeConnection("写入结果无法确认，请手动重连", true);
            return;
        }
        if (!accepted) {
            pendingWrite = 0;
            pendingWriteUuid = null;
            reply(id, false, object("code", "rejected", "message", "系统明确拒绝本次写入"));
            return;
        }
        writeDeadline = () -> {
            if (gatt == source && pendingWrite == id) {
                closeConnection("等待写入结果超时，请手动重连", true);
            }
        };
        handler.postDelayed(writeDeadline, 5000);
    }

    /******************************************************************************
     * Function Name   : verifyConnection
     * Description     : Check the operating-system link and renew the receive subscription before enabling writes.
     * Input Parameters: id, options
     * Return Value    : None; completes with the descriptor callback.
     * Date            : 2026.11.10
     ******************************************************************************/
    private void verifyConnection(int id, JSONObject options) { //20261110-6 add
        BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothGattCharacteristic receive = receiveCharacteristic(options);
        BluetoothGattService service;
        BluetoothGattCharacteristic send;

        if (!foreground || !permissionsGranted() || adapter == null || !adapter.isEnabled()
                || gatt == null || manager == null || receive == null || pendingConnect != 0 || pendingWrite != 0
                || manager.getConnectionState(gatt.getDevice(), BluetoothProfile.GATT) != BluetoothProfile.STATE_CONNECTED) {
            reply(id, false, object("message", "原连接已失效"));
            return;
        }
        service = receive.getService();
        send = service.getCharacteristic(profileUuid(options.optString("sendId")));
        if (send == null || (send.getProperties() & (BluetoothGattCharacteristic.PROPERTY_WRITE
                | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) == 0
                || (receive.getProperties() & (BluetoothGattCharacteristic.PROPERTY_NOTIFY
                | BluetoothGattCharacteristic.PROPERTY_INDICATE)) == 0) {
            reply(id, false, object("message", "收发通道已失效"));
            return;
        }
        subscribeDevice(id, options);
    }

    /******************************************************************************
     * Function Name   : requestBack
     * Description     : Ask the application to navigate or exit, with cleanup if the page is not loaded.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    private void requestBack() { //20261110-6 add
        if (web == null) {
            finishAndRemoveTask();
            return;
        }
        web.evaluateJavascript("window.__suquEvent ? (window.__suquEvent('back', {}), true) : false", value -> {
            if (!"true".equals(value)) {
                stopDiscovery();
                closeConnection("应用已退出", false);
                finishAndRemoveTask();
            }
        });
    }

    /******************************************************************************
     * Function Name   : onBackPressed
     * Description     : Route legacy hardware back through the same application navigation.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    @Override
    public void onBackPressed() { //20261110-6 add
        requestBack();
    }

    /******************************************************************************
     * Function Name   : onPause
     * Description     : Block native writes before notifying the page of background entry.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    @Override
    protected void onPause() { //20261110-6 add
        foreground = false;
        receiveReady = false;
        stopDiscovery();
        emit("lifecycle", object("foreground", false));
        super.onPause();
    }

    /******************************************************************************
     * Function Name   : onResume
     * Description     : Reenter foreground without automatically trusting the previous receive subscription.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    @Override
    protected void onResume() { //20261110-6 add
        super.onResume();
        foreground = true;
        emit("lifecycle", object("foreground", true));
    }

    private final class NativeBridge {
        /******************************************************************************
         * Function Name   : postMessage
         * Description     : Marshal page commands to the Android main thread.
         * Input Parameters: packet
         * Return Value    : None
         * Date            : 2026.11.10
         ******************************************************************************/
        @JavascriptInterface
        public void postMessage(String packet) {
            handler.post(() -> {
                try {
                    dispatch(new JSONObject(packet));
                } catch (Exception error) {
                    android.util.Log.e("SUQU", "Invalid local bridge packet", error);
                }
            });
        }
    }

    private final class LocalContent extends WebViewClient {
        /******************************************************************************
         * Function Name   : shouldInterceptRequest
         * Description     : Serve bundled assets and reject all remote content.
         * Input Parameters: view, request
         * Return Value    : Local asset or an empty response.
         * Date            : 2026.11.10
         ******************************************************************************/
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String path = uri.getPath();
            String mime;
            InputStream stream;

            try {
                if (!"https".equals(uri.getScheme()) || !"appassets.androidplatform.net".equals(uri.getHost()) || path == null || path.contains("..")) {
                    throw new IllegalArgumentException("External asset rejected");
                }
                path = path.equals("/") ? "index.html" : path.substring(1);
                mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "text/html";
                stream = getAssets().open(path);
                return new WebResourceResponse(mime, "UTF-8", stream);
            } catch (Exception error) {
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
        }
    }

    /******************************************************************************
     * Function Name   : onDestroy
     * Description     : Release the local WebView after activity termination.
     * Input Parameters: None
     * Return Value    : None
     * Date            : 2026.11.10
     ******************************************************************************/
    @Override
    protected void onDestroy() {
        stopDiscovery(); //20261110-1 add - Release discovery when the activity ends.
        closeConnection("应用已退出", false); //20261110-2 add - Never retain a GATT client after activity destruction.
        unregisterReceiver(adapterReceiver);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
