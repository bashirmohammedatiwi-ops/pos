package com.deemaalhayat.team;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // أقصى تكبير لخط النظام داخل التطبيق: يبقى مقروءاً لمن كبّر الخط دون أن يتكسر التصميم
    private static final int MAX_TEXT_ZOOM = 115;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // إضافة شبكة الواي فاي (الحضور من شبكة المحل) — تُسجَّل قبل تشغيل الجسر
        registerPlugin(WifiInfoPlugin.class);
        super.onCreate(savedInstanceState);
        applyTextZoom();
    }

    @Override
    public void onResume() {
        super.onResume();
        // قد يغيّر المستخدم حجم الخط من الإعدادات والتطبيق في الخلفية
        applyTextZoom();
    }

    private void applyTextZoom() {
        if (bridge == null) return;
        WebView web = bridge.getWebView();
        if (web == null) return;
        int system = Math.round(getResources().getConfiguration().fontScale * 100);
        web.getSettings().setTextZoom(Math.max(100, Math.min(MAX_TEXT_ZOOM, system)));
    }
}
