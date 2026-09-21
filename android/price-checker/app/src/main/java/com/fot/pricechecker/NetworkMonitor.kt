package com.fot.pricechecker

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build

class NetworkMonitor(
    context: Context,
    private val onLanReady: () -> Unit
) {
    private val app = context.applicationContext
    private val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private var registered = false
    private var lastPing = 0L

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            pingReady()
        }

        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            if (isLan(caps)) pingReady()
        }

        override fun onLost(network: Network) {
            /* watchdog retries when the link returns */
        }
    }

    fun start() {
        if (registered) return
        registered = true
        try {
            if (Build.VERSION.SDK_INT >= 21) {
                cm.registerNetworkCallback(NetworkRequest.Builder().build(), callback)
            }
        } catch (_: Exception) {
        }
        pingReady()
    }

    fun stop() {
        if (!registered) return
        registered = false
        try {
            cm.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
    }

    private fun pingReady() {
        val now = System.currentTimeMillis()
        if (now - lastPing < 1200) return
        lastPing = now
        if (ServerFinder.hasLan(app)) onLanReady()
    }

    private fun isLan(caps: NetworkCapabilities): Boolean {
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
            || caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }
}
