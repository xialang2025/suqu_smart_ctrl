//20261110-0 add - Host only local application assets and the independent native bridge.
package cn.suqu.smartcontrol;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
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
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Locale;
import java.util.ArrayList;
import java.util.List;

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
        if (!permissionsGranted()) {
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
                emit("adapterState", object("available", false, "message", "系统蓝牙已关闭，请开启后重新检查"));
            }
        }
    };

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
        unregisterReceiver(adapterReceiver);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
