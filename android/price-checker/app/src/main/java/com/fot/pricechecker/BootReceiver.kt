package com.fot.pricechecker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED
            && action != "android.intent.action.QUICKBOOT_POWERON"
            && action != "com.htc.intent.action.QUICKBOOT_POWERON"
        ) return

        val pending = goAsync()
        Thread {
            try {
                Prefs.ensureDeviceStorage(context)
                // Ethernet/DHCP often needs time after power-on.
                ServerFinder.waitForLan(context, 90000)
                val launch = Intent(context, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
                context.startActivity(launch)
            } catch (_: Exception) {
            } finally {
                pending.finish()
            }
        }.start()
    }
}
