//20261110-0 add - Host only local application assets and the independent native bridge.
package cn.suqu.smartcontrol;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
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

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private BluetoothAdapter adapter;

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
        boolean permission;
        boolean enabled;

        try {
            if ("initialize".equals(method)) {
                permission = Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
                enabled = adapter != null && permission && adapter.isEnabled();
                reply(id, true, object("available", enabled, "message", adapter == null ? "此手机不支持蓝牙" : !permission ? "需要蓝牙权限" : enabled ? "蓝牙已开启" : "系统蓝牙未开启"));
            } else {
                reply(id, false, object("message", "当前操作尚不可用", "code", "unsupported"));
            }
        } catch (Exception error) {
            reply(id, false, object("message", "蓝牙平台操作失败", "code", "native"));
        }
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
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
