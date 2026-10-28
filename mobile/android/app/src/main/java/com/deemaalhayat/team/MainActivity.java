package com.deemaalhayat.team;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // إضافة شبكة الواي فاي (الحضور من شبكة المحل) — تُسجَّل قبل تشغيل الجسر
        registerPlugin(WifiInfoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
