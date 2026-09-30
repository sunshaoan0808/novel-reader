package com.ling.novelreader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends Activity {
    private WebView web;

    /** JS 桥: 分享 PNG 角色卡。base64 解码后写 cache/shared, 经 SharedFileProvider
     *  以 content:// URI 调起系统分享面板。文件名做白名单过滤, 防路径穿越。 */
    public class JsBridge {
        @JavascriptInterface
        public void sharePng(final String base64Png, final String fileName) {
            try {
                byte[] data = Base64.decode(base64Png, Base64.DEFAULT);
                File dir = new File(getCacheDir(), "shared");
                dir.mkdirs();
                String safe = fileName == null ? "card.png"
                        : fileName.replaceAll("[^A-Za-z0-9._-]", "_");
                if (safe.isEmpty()) safe = "card.png";
                if (!safe.toLowerCase().endsWith(".png")) safe += ".png";
                File f = new File(dir, safe);
                FileOutputStream os = new FileOutputStream(f);
                os.write(data);
                os.close();
                final Uri uri = Uri.parse("content://com.ling.novelreader.shared/" + safe);
                final Intent it = new Intent(Intent.ACTION_SEND);
                it.setType("image/png");
                it.putExtra(Intent.EXTRA_STREAM, uri);
                it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(it, "分享角色卡")));
            } catch (Exception e) {
                android.util.Log.e("novelreader", "sharePng failed", e);
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new JsBridge(), "Android");
        // JS 弹窗桥: alert/confirm/prompt 在 WebView 里默认被静默吞掉,
        // 这里用原生对话框实现, 否则大量按钮点了没反应
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("确定", (d, w) -> result.confirm())
                    .setOnCancelListener(d -> result.confirm())
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("确定", (d, w) -> result.confirm())
                    .setNegativeButton("取消", (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue == null ? "" : defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton("确定", (d, w) -> result.confirm(input.getText().toString()))
                    .setNegativeButton("取消", (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
                return true;
            }
        });
        setContentView(web);
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl("file:///android_asset/www/index.html");
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // 先问 JS: 当前页面有没有自己的"返回"动作(子页面回退 / 抽屉关闭);
        // JS 返回 true 表示已消费, 否则按系统默认行为(退出 App)
        web.evaluateJavascript(
            "(function(){try{return window.__onBackPressed?!!window.__onBackPressed():false;}catch(e){return false;}})()",
            v -> { if (!"true".equals(v)) MainActivity.super.onBackPressed(); });
    }
}
