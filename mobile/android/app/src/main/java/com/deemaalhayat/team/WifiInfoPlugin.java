package com.deemaalhayat.team;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.provider.Settings;

import androidx.core.location.LocationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * قراءة شبكة الواي فاي الحالية (BSSID و SSID) لتسجيل الحضور من شبكة المحل.
 * أندرويد يُخفي BSSID دون إذن الموقع وتشغيل خدمة الموقع — نطلب الإذن ونبلّغ الواجهة بالحالة.
 */
@CapacitorPlugin(
    name = "WifiInfo",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class WifiInfoPlugin extends Plugin {

    @PluginMethod
    public void getInfo(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationCallback");
            return;
        }
        read(call);
    }

    @PermissionCallback
    private void locationCallback(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("permission", "denied");
            call.resolve(r);
            return;
        }
        read(call);
    }

    @SuppressWarnings("deprecation")
    private void read(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("permission", "granted");
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        r.put("locationEnabled", lm != null && LocationManagerCompat.isLocationEnabled(lm));
        WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm == null) {
            r.put("wifiEnabled", false);
            call.resolve(r);
            return;
        }
        r.put("wifiEnabled", wm.isWifiEnabled());
        WifiInfo info = wm.getConnectionInfo();
        String bssid = info != null ? info.getBSSID() : null;
        String ssid = info != null ? info.getSSID() : null;
        if (bssid != null && (bssid.equals("02:00:00:00:00:00") || bssid.equals("00:00:00:00:00:00"))) bssid = null;
        if (ssid != null) {
            ssid = ssid.replace("\"", "");
            if (ssid.equals("<unknown ssid>")) ssid = null;
        }
        r.put("bssid", bssid);
        r.put("ssid", ssid);
        call.resolve(r);
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void openWifiSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_WIFI_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
