package com.fot.pricechecker

import android.content.Context
import android.content.SharedPreferences
import android.os.Build

object Prefs {
    private const val FILE = "fot_price"
    private const val API = "api_base"
    private const val LOCK = "api_locked"
    const val DEFAULT_HOST = "192.168.75.1"
    const val DEFAULT_PORT = 5000
    const val DEFAULT_API = "http://$DEFAULT_HOST:$DEFAULT_PORT"

    fun ensureDeviceStorage(context: Context) {
        if (Build.VERSION.SDK_INT < 24) return
        try {
            val device = context.createDeviceProtectedStorageContext()
            device.moveSharedPreferencesFrom(context, FILE)
            val files = arrayOf("webview", "app_webview")
            for (name in files) {
                try { device.moveDatabaseFrom(context, name) } catch (_: Exception) {}
            }
        } catch (_: Exception) {
        }
    }

    private fun devicePrefs(context: Context): SharedPreferences {
        val ctx = if (Build.VERSION.SDK_INT >= 24) {
            context.createDeviceProtectedStorageContext()
        } else {
            context
        }
        return ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    private fun credentialPrefs(context: Context): SharedPreferences =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun isValidApi(url: String): Boolean {
        val host = url.trim()
            .removePrefix("http://")
            .removePrefix("https://")
            .substringBefore('/')
            .substringBefore(':')
        val parts = host.split('.')
        if (parts.size != 4) return false
        return parts.all { p ->
            val n = p.toIntOrNull()
            n != null && n in 0..255
        }
    }

    fun apiBase(context: Context): String {
        val device = devicePrefs(context).getString(API, "") ?: ""
        if (isValidApi(device)) return device.trim()
        val cred = credentialPrefs(context).getString(API, "") ?: ""
        if (isValidApi(cred)) {
            setApiBase(context, cred, isLocked(context))
            return cred.trim()
        }
        return DEFAULT_API
    }

    fun hasCustomBase(context: Context): Boolean {
        val device = devicePrefs(context).getString(API, "") ?: ""
        if (isValidApi(device)) return true
        return isValidApi(credentialPrefs(context).getString(API, "") ?: "")
    }

    fun isLocked(context: Context): Boolean {
        if (devicePrefs(context).getBoolean(LOCK, false)) return true
        return credentialPrefs(context).getBoolean(LOCK, false)
    }

    fun setApiBase(context: Context, url: String, lock: Boolean = false) {
        val clean = url.trim().trimEnd('/')
        if (clean.isBlank() || !isValidApi(clean)) return
        val device = devicePrefs(context).edit().putString(API, clean)
        val cred = credentialPrefs(context).edit().putString(API, clean)
        if (lock) {
            device.putBoolean(LOCK, true)
            cred.putBoolean(LOCK, true)
        }
        device.commit()
        cred.commit()
    }
}
