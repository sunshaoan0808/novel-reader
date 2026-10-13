package com.ling.novelreader;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

public class MainActivity extends Activity {
    private WebView web;
    /** <input type=file> 回调: WebView 自身打不开系统文件选择器, 必须由原生端实现,
     *  否则 JS 点 input.click() 会被静默吞掉(导入角色卡没反应就是这个原因)。 */
    private ValueCallback<Uri[]> filePathCallback;
    private static final int REQ_FILE_CHOOSER = 1001;
    /** P1-6: 当前页面 URL（WebViewClient.onPageStarted 维护），供 JS 桥做来源白名单校验 */
    private volatile String lastPageUrl = null;

    /** JS 桥: 分享 PNG 角色卡。base64 解码后写 cache/shared, 经 SharedFileProvider
     *  以 content:// URI 调起系统分享面板。文件名做白名单过滤, 防路径穿越。 */
    public class JsBridge {
        /** P0-2: ndFileRead 异常哨兵（与 filestore.js 的 IO_ERR_SENTINEL 对应）。
         * 以 \u0000 开头，正常文本文件内容不可能以此开头。 */
        private static final String ND_IO_ERROR = "\u0000ND_IO_ERROR";
        /** P1-6: 桥调用来源白名单——只允许 file:///android_asset/ 下的页面调用。
         * lastPageUrl 由 WebViewClient.onPageStarted 维护。 */
        private boolean pageAllowed(){
            String u = MainActivity.this.lastPageUrl;
            return u != null && u.startsWith("file:///android_asset/");
        }
        /* P1#3: 单次桥调用大小上限（纵深防御）。sharePng/ndFileWrite 在解码/分配前
         * 先做廉价长度预检，避免恶意超大输入直接触发 OOM（2GB 配额检查在分配之后，拦不住）。 */
        private static final long ND_SINGLE_OP_MAX = 5L * 1024 * 1024;
        @JavascriptInterface
        public void sharePng(final String base64Png, final String fileName) {
            if(!pageAllowed()) return;
            /* base64 约膨胀 4/3，5MB 上限对应输入约 6.6M 字符 */
            if(base64Png == null || (long)base64Png.length() > ND_SINGLE_OP_MAX * 4 / 3) return;
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

        /** JS 桥: 大文件本地存储（2GB 配额）。localStorage 只有 5MB 硬上限且改不了，
         *  IndexedDB 配额由系统按磁盘余量算、保证不了；App 私有目录只受磁盘空间限制，
         *  在此自设 2GB 上限。文件名白名单过滤，防路径穿越。所有方法同步返回，
         *  跑在 JavaBridge 线程，可直接做文件 IO。 */
        private static final long ND_BLOB_QUOTA = 2L * 1024 * 1024 * 1024;
        private File ndBlobDir(){
            File d = new File(getFilesDir(), "ndblob");
            d.mkdirs();
            return d;
        }
        private String ndSafeName(String name){
            String s = name == null ? "" : name.replaceAll("[^A-Za-z0-9_.-]", "_");
            s = s.replaceAll("\\.+", ".");
            if(s.isEmpty() || s.equals(".") || s.equals("..")) s = "unnamed";
            if(s.length() > 100) s = s.substring(0, 100);
            /* v36: 文件名后缀改用 SHA-256(64bit) 防碰撞。hashCode 只有 32bit，
             * 中文键净化后易相同（如 nd_chat_r1_林黛玉 vs nd_chat_r1_王熙凤都变下划线），
             * 2GB 量级下不能赌碰撞。老文件由 ndResolveFile 迁移。 */
            s = s + "_" + ndNameHash(name);
            return s;
        }
        /* 老版本文件名（hashCode 后缀），仅用于读取迁移 */
        private String ndSafeNameLegacy(String name){
            String s = name == null ? "" : name.replaceAll("[^A-Za-z0-9_.-]", "_");
            s = s.replaceAll("\\.+", ".");
            if(s.isEmpty() || s.equals(".") || s.equals("..")) s = "unnamed";
            if(s.length() > 100) s = s.substring(0, 100);
            s = s + "_" + Integer.toHexString(name == null ? 0 : name.hashCode());
            return s;
        }
        private String ndNameHash(String name){
            try{
                java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
                byte[] d = md.digest(name == null ? new byte[0]
                        : name.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                for(int i = 0; i < 8; i++) sb.append(String.format("%02x", d[i]));
                return sb.toString();
            }catch(Exception e){
                return Integer.toHexString(name == null ? 0 : name.hashCode());
            }
        }
        /* 按新名找文件，找不到则试老名；命中老名时原地迁移为新名，之后只走新名 */
        private File ndResolveFile(String name){
            File dir = ndBlobDir();
            File f = new File(dir, ndSafeName(name));
            if(f.exists()) return f;
            File legacy = new File(dir, ndSafeNameLegacy(name));
            if(legacy.exists()){
                try{ legacy.renameTo(f); }catch(Exception e){ return legacy; }
                return f.exists() ? f : legacy;
            }
            return f;
        }
        @JavascriptInterface
        public String ndFileWrite(final String name, final String text){
            if(!pageAllowed()) return "err:forbidden";
            /* P1#3: 先做字符数预检（UTF-8 下 1 字符至多 4 字节，保守按 4 估），
             * 避免 getBytes() 直接分配超大数组；2GB 总配额检查保留在后。 */
            if(text != null && (long)text.length() * 4 > ND_SINGLE_OP_MAX) return "err:too_large";
            try{
                File dir = ndBlobDir();
                File f = ndResolveFile(name); /* 命中老名时先迁移为新名 */
                byte[] data = text == null ? new byte[0]
                        : text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                long total = 0;
                File[] fs = dir.listFiles();
                if(fs != null) for(File x : fs) total += x.length();
                long old = f.exists() ? f.length() : 0;
                if(total - old + data.length > ND_BLOB_QUOTA) return "err:quota";
                /* P1-11: 原子写——先写 tmp，fsync 落盘后再 rename，避免崩溃留下半截文件 */
                File tmp = new File(dir, f.getName() + ".tmp");
                FileOutputStream os = new FileOutputStream(tmp);
                os.write(data);
                os.getFD().sync();
                os.close();
                if(!tmp.renameTo(f)){
                    tmp.delete();
                    return "err:io";
                }
                return "ok";
            }catch(Exception e){
                android.util.Log.e("novelreader", "ndFileWrite failed", e);
                return "err:io";
            }
        }
        @JavascriptInterface
        public String ndFileRead(final String name){
            if(!pageAllowed()) return ND_IO_ERROR;
            try{
                File f = ndResolveFile(name);
                if(!f.exists()) return null;
                FileInputStream is = new FileInputStream(f);
                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                is.close();
                return bos.toString("UTF-8");
            }catch(Exception e){
                android.util.Log.e("novelreader", "ndFileRead failed", e);
                /* P0-2: 异常返回哨兵而非 null，让 JS 侧区分"IO 失败"与"文件不存在" */
                return ND_IO_ERROR;
            }
        }
        @JavascriptInterface
        public boolean ndFileDelete(final String name){
            if(!pageAllowed()) return false;
            try{
                File f = ndResolveFile(name);
                boolean ok = !f.exists() || f.delete();
                /* 保险：老名残留也清掉 */
                File legacy = new File(ndBlobDir(), ndSafeNameLegacy(name));
                if(legacy.exists() && !legacy.getAbsolutePath().equals(f.getAbsolutePath()))
                    ok = legacy.delete() && ok;
                return ok;
            }catch(Exception e){ return false; }
        }
        @JavascriptInterface
        public long ndFileSize(final String name){
            if(!pageAllowed()) return -1;
            try{
                File f = ndResolveFile(name);
                return f.exists() ? f.length() : -1;
            }catch(Exception e){ return -1; }
        }
        /* v36: 一键清空整个文件区。wipeAll 不再依赖 localStorage 标记反推，
         * 直接删目录，由 JS 侧 NDFILE.clearAll() 调用。 */
        @JavascriptInterface
        public boolean ndFileClear(){
            if(!pageAllowed()) return false;
            try{
                boolean ok = true;
                File[] fs = ndBlobDir().listFiles();
                if(fs != null) for(File x : fs){ if(!x.delete()) ok = false; }
                return ok;
            }catch(Exception e){ return false; }
        }
        @JavascriptInterface
        public long ndFileTotal(){
            if(!pageAllowed()) return -1;
            try{
                long total = 0;
                File[] fs = ndBlobDir().listFiles();
                if(fs != null) for(File x : fs) total += x.length();
                return total;
            }catch(Exception e){ return -1; }
        }
        @JavascriptInterface
        public String ndFileList(){
            if(!pageAllowed()) return "[]";
            try{
                StringBuilder sb = new StringBuilder("[");
                File[] fs = ndBlobDir().listFiles();
                boolean first = true;
                if(fs != null) for(File x : fs){
                    if(!first) sb.append(",");
                    first = false;
                    sb.append("\"").append(x.getName().replace("\"", "_")).append("\"");
                }
                sb.append("]");
                return sb.toString();
            }catch(Exception e){ return "[]"; }
        }

        /** JS 桥: 角色召回本地通知（Tier3-24）。纯本地通知，不走任何推送服务器。
         *  JS 只在"App 回到前台且距上次聊天超过 N 小时"时调用。
         *  Android 13+ 需要 POST_NOTIFICATIONS 运行时权限：首次调用时申请，本次先跳过。 */
        @JavascriptInterface
        public void notifyLocal(final String title, final String text) {
            if(!pageAllowed()) return;
            try {
                if (Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(
                        new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1002);
                    return;
                }
                final String t = (title == null || title.isEmpty()) ? "TA" : title;
                final String c = text == null ? "" : text;
                runOnUiThread(() -> {
                    try {
                        NotificationManager nm =
                            (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                        if (nm == null) return;
                        Notification.Builder b;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            b = new Notification.Builder(MainActivity.this, "recall");
                        } else {
                            b = new Notification.Builder(MainActivity.this);
                            b.setPriority(Notification.PRIORITY_DEFAULT);
                        }
                        int flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT;
                        if (Build.VERSION.SDK_INT >= 23) flags |= android.app.PendingIntent.FLAG_IMMUTABLE;
                        android.app.PendingIntent pi = android.app.PendingIntent.getActivity(
                            MainActivity.this, 0, getIntent(), flags);
                        b.setContentTitle(t)
                         .setContentText(c)
                         .setSmallIcon(getApplicationInfo().icon)
                         .setContentIntent(pi)
                         .setAutoCancel(true);
                        if (Build.VERSION.SDK_INT >= 16)
                            b.setStyle(new Notification.BigTextStyle().bigText(c));
                        nm.notify(2001, b.build());
                    } catch (Exception e) {
                        android.util.Log.e("novelreader", "notifyLocal ui failed", e);
                    }
                });
            } catch (Exception e) {
                android.util.Log.e("novelreader", "notifyLocal failed", e);
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
        /* P1-6: 硬化——App 只从 android_asset 加载本地页，不需要 file:// 跨源能力。
         * setAllowFileAccess(true) 保留（loadUrl("file:///android_asset/...") 依赖它）；
         * 下面两项关闭后，file:// 页内的 XHR/fetch 只能访问同源，阻断 XSS 经 file:// 读任意文件。 */
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient(){
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon){
                MainActivity.this.lastPageUrl = url; /* P1-6: 桥白名单用 */
                super.onPageStarted(view, url, favicon);
            }
        });
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

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                try {
                    startActivityForResult(fileChooserParams.createIntent(), REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    android.util.Log.e("novelreader", "open file chooser failed", e);
                    return false;
                }
                return true;
            }
        });
        setContentView(web);
        /* Tier3-24: 角色召回通知渠道（Android 8+ 需要先建 channel） */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                "recall", "角色召回", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("角色想你了时的本地召回提醒");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl("file:///android_asset/www/index.html");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && filePathCallback != null) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new Uri[n];
                    for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    results = new Uri[]{ data.getData() };
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        /* Tier3-24: App 从后台回到前台，让 JS 检查是否需要发角色召回本地通知 */
        if (web != null) web.evaluateJavascript(
            "(function(){try{if(window.__onAppResumed)window.__onAppResumed();}catch(e){}})()",
            null);
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
