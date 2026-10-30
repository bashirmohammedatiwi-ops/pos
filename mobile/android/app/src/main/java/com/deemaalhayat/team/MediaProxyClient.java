package com.deemaalhayat.team;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * الصفحة تعمل على https://localhost والخادم http، فيحظر WebView الصور والصوت (Mixed Content)
 * مهما كان الإعداد، بينما تمر طلبات fetch. لذلك تُطلب الوسائط من نفس أصل الصفحة
 * (https://localhost/_media/api/team/...) وتُجلب هنا من الخادم.
 * يقبل مسارات /api/team/ فقط وعلى عنوان الخادم المضبوط وقت البناء.
 */
public class MediaProxyClient extends BridgeWebViewClient {
    private static final String PREFIX = "/_media";
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private final String apiBase;

    public MediaProxyClient(Bridge bridge, String apiBase) {
        super(bridge);
        this.apiBase = apiBase.replaceAll("/+$", "");
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getEncodedPath();
        if (path != null && "localhost".equals(url.getHost()) && "GET".equals(request.getMethod())
                && path.startsWith(PREFIX + "/api/team/") && !path.contains("..")) {
            String query = url.getEncodedQuery();
            return fetch(path.substring(PREFIX.length()) + (query == null ? "" : "?" + query));
        }
        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse fetch(String target) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(apiBase + target).openConnection();
            con.setConnectTimeout(CONNECT_TIMEOUT_MS);
            con.setReadTimeout(READ_TIMEOUT_MS);
            int status = con.getResponseCode();
            if (status != 200) {
                con.disconnect();
                return failure(status >= 400 && status < 600 ? status : 502, "Upstream error");
            }
            String type = con.getContentType();
            String mime = type == null ? "application/octet-stream" : type.split(";")[0].trim();
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store"); // التخزين يتم في HttpResponseCache
            return new WebResourceResponse(mime, null, 200, "OK", headers, con.getInputStream());
        } catch (Exception e) {
            if (con != null) con.disconnect();
            return failure(502, "Bad Gateway");
        }
    }

    private static WebResourceResponse failure(int status, String reason) {
        return new WebResourceResponse("text/plain", null, status, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
}
