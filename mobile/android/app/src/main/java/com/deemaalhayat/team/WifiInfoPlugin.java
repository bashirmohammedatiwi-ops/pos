package com.deemaalhayat.team;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import java.util.List;

import androidx.core.location.LocationManagerCompat;

import com.getcapacitor.JSArray;
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

    /**
     * البحث عن شبكات الواي فاي المحيطة (للمدير: إضافة شبكة المحل بكل نقاط بثها).
     * أندرويد يحدّ startScan (4 مرات كل دقيقتين) — إن رُفض نعيد آخر نتائج محفوظة.
     */
    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "scanCallback");
            return;
        }
        doScan(call);
    }

    @PermissionCallback
    private void scanCallback(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("permission", "denied");
            r.put("networks", new JSArray());
            call.resolve(r);
            return;
        }
        doScan(call);
    }

    @SuppressWarnings("deprecation")
    private void doScan(PluginCall call) {
        Context ctx = getContext();
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        boolean locationOn = lm != null && LocationManagerCompat.isLocationEnabled(lm);
        WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm == null) {
            JSObject r = new JSObject();
            r.put("permission", "granted");
            r.put("locationEnabled", locationOn);
            r.put("wifiEnabled", false);
            r.put("networks", new JSArray());
            call.resolve(r);
            return;
        }
        boolean started = false;
        try {
            started = wm.startScan();
        } catch (Exception ignored) {
            // الحدّ أو منع النظام: نكتفي بالنتائج المحفوظة
        }
        final boolean fresh = started;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            JSObject r = new JSObject();
            r.put("permission", "granted");
            r.put("locationEnabled", locationOn);
            r.put("wifiEnabled", wm.isWifiEnabled());
            r.put("fresh", fresh);
            JSArray list = new JSArray();
            try {
                List<ScanResult> results = wm.getScanResults();
                if (results != null) {
                    for (ScanResult s : results) {
                        if (s.BSSID == null) continue;
                        JSObject o = new JSObject();
                        o.put("ssid", s.SSID == null ? "" : s.SSID);
                        o.put("bssid", s.BSSID.toLowerCase());
                        o.put("level", s.level);
                        o.put("frequency", s.frequency);
                        list.put(o);
                    }
                }
            } catch (SecurityException ignored) {
                // بلا إذن الموقع لا تعيد أندرويد نتائج
            }
            r.put("networks", list);
            call.resolve(r);
        }, started ? 3500 : 300);
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** صفحة أذونات التطبيق — حين لا تظهر نافذة طلب الإذن (بعض هواتف شاومي) أو رُفض نهائياً */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", getContext().getPackageName(), null));
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

    /** فتح رابط خارج التطبيق (تنزيل تحديث APK في المتصفح/مدير التنزيلات) */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("invalid url");
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
