package com.fot.pricechecker

import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.ConnectivityManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.File

class MainActivity : Activity() {
    private var web: WebView? = null
    private var listening = false
    private var networkMonitor: NetworkMonitor? = null
    @Volatile private var finding = false
    @Volatile private var watchdogOn = true
    @Volatile private var lastServerOk: Boolean? = null
    @Volatile private var lastProbeAt = 0L
    @Volatile var allowWebTyping = false
    private val scanBuf = StringBuilder()
    private var lastScanKeyAt = 0L
    private var scanStartedAt = 0L
    private val scanHandler = Handler(Looper.getMainLooper())
    private val flushScan = Runnable {
        if (scanBuf.length >= 6) {
            val text = scanBuf.toString()
            scanBuf.setLength(0)
            deliverScan(text)
        } else {
            scanBuf.setLength(0)
        }
    }

    private val netRx = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            probeServer(debounceMs = 2000)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Prefs.ensureDeviceStorage(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val storageContext = if (Build.VERSION.SDK_INT >= 24) {
            createDeviceProtectedStorageContext()
        } else {
            this
        }

        val view = WebView(this)
        web = view
        view.setBackgroundColor(Color.parseColor("#F7F1E8"))
        val settings = view.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        val webDir = storageContext.getDir("webview", MODE_PRIVATE)
        settings.databasePath = File(webDir, "db").absolutePath
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.allowFileAccess = true
        settings.allowFileAccessFromFileURLs = true
        settings.allowUniversalAccessFromFileURLs = true
        settings.blockNetworkImage = false
        settings.blockNetworkLoads = false
        if (Build.VERSION.SDK_INT >= 21) {
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView, url: String?) {
                injectAndResume()
            }
        }
        view.addJavascriptInterface(PriceBridge(this), "fotPriceNative")
        view.setOnLongClickListener { true }
        view.isHapticFeedbackEnabled = false
        setContentView(view)
        view.loadUrl("file:///android_asset/www/index.html")

        networkMonitor = NetworkMonitor(this) { probeServer(debounceMs = 1500) }
        networkMonitor?.start()
        startWatchdog()
    }

    override fun onResume() {
        super.onResume()
        listenNet(true)
        injectAndResume()
        probeServer(debounceMs = 0)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            val now = System.currentTimeMillis()
            val code = event.keyCode
            val ch = event.unicodeChar
            if (code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_TAB) {
                if (scanBuf.length >= 3 && now - scanStartedAt < 1200) {
                    val text = scanBuf.toString()
                    scanBuf.setLength(0)
                    deliverScan(text)
                    return true
                }
                scanBuf.setLength(0)
                if (!allowWebTyping) return true
            } else if (ch in 32..126) {
                val burst = scanBuf.isNotEmpty() && now - lastScanKeyAt <= 90
                if (scanBuf.isEmpty() || now - lastScanKeyAt > 90) {
                    scanBuf.setLength(0)
                    scanStartedAt = now
                }
                scanBuf.append(ch.toChar())
                lastScanKeyAt = now
                scanHandler.removeCallbacks(flushScan)
                if (scanBuf.length >= 6) scanHandler.postDelayed(flushScan, 140)
                if (!allowWebTyping) return true
                if (burst || (scanBuf.length >= 2 && now - scanStartedAt < 250)) return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onPause() {
        listenNet(false)
        super.onPause()
    }

    override fun onDestroy() {
        watchdogOn = false
        networkMonitor?.stop()
        super.onDestroy()
    }

    override fun onBackPressed() {
        /* stay on the checker */
    }

    @Suppress("UnspecifiedRegisterReceiverFlag", "DEPRECATION")
    private fun listenNet(on: Boolean) {
        if (on && !listening) {
            try {
                registerReceiver(netRx, IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION))
                listening = true
            } catch (_: Exception) {
            }
        } else if (!on && listening) {
            try {
                unregisterReceiver(netRx)
            } catch (_: Exception) {
            }
            listening = false
        }
    }

    fun httpGetRaw(base: String, path: String, timeoutMs: Int): String =
        ServerFinder.httpGet(this, base, path, timeoutMs)

    fun startFind(force: Boolean) {
        if (finding) return
        finding = true
        Thread {
            val url = try {
                ServerFinder.find(this, force)
            } catch (_: Exception) {
                Prefs.apiBase(this)
            }
            finding = false
            if (force) deliverFound(url)
            else probeAndNotify(url)
        }.start()
    }

    private fun startWatchdog() {
        Thread {
            ServerFinder.waitForLan(this, 2500)
            while (watchdogOn) {
                probeAndNotify(Prefs.apiBase(this))
                try {
                    Thread.sleep(30000)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }.start()
    }

    private fun probeServer(debounceMs: Long) {
        val now = System.currentTimeMillis()
        if (now - lastProbeAt < debounceMs) return
        lastProbeAt = now
        Thread {
            probeAndNotify(Prefs.apiBase(this))
        }.start()
    }

    private fun probeAndNotify(base: String) {
        val ok = ServerFinder.isFot(this, base, 1500)
        runOnUiThread {
            if (lastServerOk != ok) {
                lastServerOk = ok
                notifyNetReady(ok)
            }
        }
    }

    fun deliverHttp(reqId: String, raw: String) {
        val view = web ?: return
        val nl = raw.indexOf('\n')
        val status = if (nl < 0) 0 else raw.substring(0, nl).toIntOrNull() ?: 0
        val body = if (nl < 0) raw else raw.substring(nl + 1)
        val payload = JSONObject().apply {
            put("id", reqId)
            put("status", status)
            put("body", body)
        }.toString()
        val js = "(function(){try{if(window.fotPriceHttpDone)window.fotPriceHttpDone($payload)}catch(e){}})()"
        runOnUiThread {
            if (Build.VERSION.SDK_INT >= 19) view.evaluateJavascript(js, null)
            else view.loadUrl("javascript:$js")
        }
    }

    fun deliverScan(code: String) {
        val view = web ?: return
        val clean = code.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "").replace("\r", "")
        val js = "(function(){try{if(typeof window.fotPriceScan==='function')window.fotPriceScan('$clean');}catch(e){}})()"
        runOnUiThread {
            if (Build.VERSION.SDK_INT >= 19) view.evaluateJavascript(js, null)
            else view.loadUrl("javascript:$js")
        }
    }

    fun deliverFound(url: String) {
        val view = web ?: return
        val clean = url.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "").replace("\r", "")
        val js = "(function(){try{window.__FOT_NATIVE_BASE='$clean';if(typeof window.fotPriceFound==='function')window.fotPriceFound('$clean');}catch(e){}})()"
        runOnUiThread {
            if (Build.VERSION.SDK_INT >= 19) view.evaluateJavascript(js, null)
            else view.loadUrl("javascript:$js")
        }
    }

    private fun injectAndResume() {
        val view = web ?: return
        val raw = Prefs.apiBase(this)
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "")
            .replace("\r", "")
        val js = "(function(){try{window.__FOT_NATIVE_BASE='$raw';if(typeof window.fotPriceReady==='function')window.fotPriceReady();if(typeof window.fotPriceFocus==='function')window.fotPriceFocus();}catch(e){}})();"
        if (Build.VERSION.SDK_INT >= 19) view.evaluateJavascript(js, null)
        else view.loadUrl("javascript:$js")
    }

    private fun notifyNetReady(serverOk: Boolean) {
        val view = web ?: return
        val flag = if (serverOk) "true" else "false"
        val js = "(function(){try{if(typeof window.fotPriceNetReady==='function')window.fotPriceNetReady($flag);}catch(e){}})();"
        if (Build.VERSION.SDK_INT >= 19) view.evaluateJavascript(js, null)
        else view.loadUrl("javascript:$js")
    }
}

class PriceBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun getApiBase(): String = Prefs.apiBase(activity)

    @JavascriptInterface
    fun setApiBase(url: String) {
        Prefs.setApiBase(activity, url, lock = true)
    }

    @JavascriptInterface
    fun setAllowTyping(on: Boolean) {
        activity.allowWebTyping = on
    }

    @JavascriptInterface
    fun findServer() {
        activity.startFind(true)
    }

    @JavascriptInterface
    fun getNetworkDiag(serverHost: String): String =
        ServerFinder.networkDiag(serverHost).toString()

    @JavascriptInterface
    fun httpCall(spec: String) {
        Thread {
            try {
                val o = JSONObject(spec)
                val raw = activity.httpGetRaw(
                    o.optString("base"),
                    o.optString("path"),
                    o.optInt("timeout", 2500)
                )
                activity.deliverHttp(o.optString("id"), raw)
            } catch (e: Exception) {
                activity.deliverHttp("0", "0\n" + (e.message ?: "net"))
            }
        }.start()
    }

    @JavascriptInterface
    fun httpGet(base: String, path: String, timeoutMs: String): String {
        val t = timeoutMs.toIntOrNull() ?: 2500
        return activity.httpGetRaw(base, path, t)
    }

    @JavascriptInterface
    fun httpGetAsync(reqId: String, base: String, path: String, timeoutMs: String) {
        val t = timeoutMs.toIntOrNull() ?: 2500
        Thread {
            val raw = activity.httpGetRaw(base, path, t)
            activity.deliverHttp(reqId, raw)
        }.start()
    }
}
