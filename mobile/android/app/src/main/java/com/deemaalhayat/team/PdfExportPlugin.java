package com.deemaalhayat.team;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.print.PdfFileWriter;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * يحوّل صفحة HTML إلى PDF بنص حقيقي وتشكيل عربي صحيح عبر WebView خارج الشاشة.
 * fromHtml يكتب ملفاً في الذاكرة المؤقتة ويعيد مساره لتتم مشاركته؛ وإن تعذّر على جهاز ما
 * تستدعي الواجهة printDialog: نافذة الطباعة العادية وفيها «حفظ PDF».
 */
@CapacitorPlugin(name = "PdfExport")
public class PdfExportPlugin extends Plugin {

    /** يبقى مرجع الصفحة حتى تنتهي الكتابة حتى لا يُجمع أثناءها */
    private WebView rendering;

    private interface Ready {
        void run(WebView web);
    }

    private void render(String html, Ready ready) {
        getActivity().runOnUiThread(() -> {
            WebView web = new WebView(getContext());
            rendering = web;
            web.getSettings().setJavaScriptEnabled(false);
            web.getSettings().setBlockNetworkLoads(true);
            web.getSettings().setAllowFileAccess(false);
            web.setWebViewClient(new WebViewClient() {
                private boolean fired;

                @Override
                public void onPageFinished(WebView view, String url) {
                    if (fired) return;
                    fired = true;
                    // مهلة قصيرة حتى يُحمَّل الخط ويكتمل التخطيط. لا view.postDelayed: صفحة خارج الشاشة لا تنفّذه
                    new Handler(Looper.getMainLooper()).postDelayed(() -> ready.run(view), 250);
                }
            });
            web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }

    /** الصفحة خارج الشاشة لا تُستعمل بعد الكتابة */
    private void release(WebView web) {
        rendering = null;
        getActivity().runOnUiThread(web::destroy);
    }

    private static PrintAttributes a4() {
        return new PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
            .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
            .setMinMargins(new PrintAttributes.Margins(500, 500, 500, 500))
            .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
            .build();
    }

    @PluginMethod
    public void fromHtml(PluginCall call) {
        String html = call.getString("html");
        String name = call.getString("fileName", "document");
        if (html == null || html.isEmpty()) {
            call.reject("empty");
            return;
        }
        File dir = new File(getContext().getCacheDir(), "exports");
        dir.mkdirs();
        File out = new File(dir, name.replaceAll("[^\\w.-]", "_") + ".pdf");
        render(html, web -> {
            PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(name);
            try {
                PdfFileWriter.write(adapter, a4(), out, new PdfFileWriter.Result() {
                    @Override
                    public void done() {
                        release(web);
                        JSObject res = new JSObject();
                        res.put("uri", Uri.fromFile(out).toString());
                        call.resolve(res);
                    }

                    @Override
                    public void failed(String why) {
                        release(web);
                        call.reject(why);
                    }
                });
            } catch (LinkageError e) {
                release(web);
                call.reject("unsupported");
            }
        });
    }

    @PluginMethod
    public void printDialog(PluginCall call) {
        String html = call.getString("html");
        String name = call.getString("fileName", "document");
        if (html == null || html.isEmpty()) {
            call.reject("empty");
            return;
        }
        render(html, web -> {
            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            pm.print(name, web.createPrintDocumentAdapter(name), a4());
            call.resolve();
        });
    }
}
