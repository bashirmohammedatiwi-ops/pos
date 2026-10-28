using System.Security.Claims;
using FOT.Pos.Api.HostedServices;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.Endpoints;

/// <summary>
/// تطبيق الفريق — من لوحة التحكم:
///  · /api/team/staff …  إدارة الموظفين محلياً (المصدر في SQL Server) ثم رفع فوري لخادم الفريق.
///  · /api/team/hub/**   وكيل عام لكل ما يُدار على خادم الفريق (الإجازات، الحضور، الإعلانات، المحادثات…)
///                       بمفتاح المزامنة — لوحة التحكم لا تتصل بالإنترنت مباشرة ولا تحمل المفتاح.
/// </summary>
public static class TeamEndpoints
{
    public const string HubClientName = "TeamHub";

    public static void MapTeamEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/team");

        g.MapGet("/staff", async (HttpContext http, StaffRepository repo, CancellationToken ct) =>
            !IsAdmin(http) ? Results.Forbid() : Results.Ok(await repo.ListAsync(ct)));

        g.MapPost("/staff", async (HttpContext http, StaffSaveRequest req, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var (row, error) = await repo.SaveAsync(null, req, ct);
            if (row is null) return Results.BadRequest(new { error });
            Push(sync);
            return Results.Ok(row);
        });

        g.MapPut("/staff/{id:long}", async (HttpContext http, long id, StaffSaveRequest req, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var (row, error) = await repo.SaveAsync(id, req, ct);
            if (row is null) return Results.BadRequest(new { error });
            Push(sync);
            return Results.Ok(row);
        });

        g.MapPost("/staff/{id:long}/pin", async (HttpContext http, long id, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var row = await repo.IssuePinAsync(id, ct);
            if (row is null) return Results.NotFound(new { error = "الموظف غير موجود" });
            Push(sync);
            return Results.Ok(row);
        });

        g.MapPost("/staff/{id:long}/active", async (HttpContext http, long id, bool active, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var row = await repo.SetActiveAsync(id, active, ct);
            if (row is null) return Results.NotFound(new { error = "الموظف غير موجود" });
            Push(sync);
            return Results.Ok(row);
        });

        g.MapPost("/staff/import-cashiers", async (HttpContext http, StaffRepository repo, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var added = await repo.ImportCashiersAsync(ct);
            if (added > 0) Push(sync);
            return Results.Ok(new { added, staff = await repo.ListAsync(ct) });
        });

        // مفتاح الربط مع خادم الفريق: حالته، وحفظه من لوحة التحكم (يبقى بعد تحديث المثبّت)
        g.MapGet("/sync-key", (HttpContext http, IConfiguration config) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var key = HubSyncKeyStore.ReadConfigured(config);
            return Results.Ok(new { configured = key is not null, source = HubSyncKeyStore.Source(config), masked = HubSyncKeyStore.Mask(key) });
        });
        g.MapPut("/sync-key", async (HttpContext http, SyncKeyRequest req, IConfiguration config, IHttpClientFactory factory, ISellerHubSync sync, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var key = (req.Key ?? "").Trim();
            if (key.Length < 24) return Results.BadRequest(new { error = "المفتاح قصير — انسخه كاملاً من رسالة تحديث الـ VPS" });
            if (HubSyncKeyStore.Source(config) == "settings")
                return Results.BadRequest(new { error = "المفتاح مضبوط في appsettings.json على سيرفر المحل — عدّله هناك أو احذفه منه أولاً" });
            // تجربة المفتاح قبل حفظه
            var baseUrl = (config["SellerWeb:SyncUrl"] ?? "http://187.124.23.65:4705").TrimEnd('/');
            try
            {
                using var test = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/api/admin/team/whoami");
                test.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", key);
                using var res = await factory.CreateClient(HubClientName).SendAsync(test, ct);
                if (res.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
                    return Results.BadRequest(new { error = "خادم الفريق رفض المفتاح — تأكد أنه نفس FOT_HUB_SYNC_KEY في ملف .env على الـ VPS" });
            }
            catch
            {
                return Results.Json(new { error = "تعذر الوصول لخادم الفريق لتجربة المفتاح — تحقق من الإنترنت" }, statusCode: 502);
            }
            HubSyncKeyStore.Save(key);
            Push(sync);
            return Results.Ok(new { configured = true, source = "file", masked = HubSyncKeyStore.Mask(key) });
        });

        // شبكات الواي فاي المرئية من جهاز السيرفر (في المحل) — لاختيار شبكات المحل وملء BSSID تلقائياً
        g.MapGet("/wifi-scan", async (HttpContext http, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            if (!OperatingSystem.IsWindows())
                return Results.Json(new { error = "البحث عن الشبكات متاح على سيرفر ويندوز فقط" }, statusCode: 501);
            var (networksOut, code1) = await RunNetshAsync("wlan show networks mode=bssid", ct);
            var (ifaceOut, _) = await RunNetshAsync("wlan show interfaces", ct);
            var networks = WifiScan.ParseNetworks(networksOut);
            var current = WifiScan.ParseInterface(ifaceOut);
            if (networks.Count == 0)
            {
                var lower = networksOut.ToLowerInvariant();
                string error =
                    lower.Contains("location") || lower.Contains("الموقع")
                        ? "ويندوز يمنع قراءة شبكات الواي فاي — فعّل «الموقع» من الإعدادات ← الخصوصية والأمان ← الموقع، واسمح للتطبيقات المكتبية بالوصول إليه"
                    : lower.Contains("wlansvc") || lower.Contains("wireless autoconfig") || lower.Contains("no wireless interface") || lower.Contains("لا توجد واجهة") || code1 != 0
                        ? "جهاز السيرفر لا يحتوي بطاقة واي فاي (أو أنها متوقفة) — استخدم «التقاط من التطبيق» من هاتف داخل المحل"
                    : "لم تُعثر على شبكات — تأكد أن الواي فاي مفعّل على جهاز السيرفر";
                return Results.Ok(new { networks, current, error, raw = networksOut.Length > 600 ? networksOut[..600] : networksOut });
            }
            return Results.Ok(new { networks, current, error = (string?)null, raw = (string?)null });
        });

        // وكيل خادم الفريق: GET/POST/PUT/DELETE /api/team/hub/<path> → {hub}/api/admin/team/<path>
        g.Map("/hub/{**path}", async (HttpContext http, string? path, IHttpClientFactory factory, IConfiguration config, CancellationToken ct) =>
        {
            if (!IsAdmin(http)) return Results.Forbid();
            var baseUrl = (config["SellerWeb:SyncUrl"] ?? "http://187.124.23.65:4705").TrimEnd('/');
            // المفتاح سري في إعدادات سيرفر المحل فقط (لا قيمة افتراضية في الكود)
            if (SellerHubSyncService.ReadSyncKey(config) is not { } key)
                return Results.Json(new { error = "مفتاح المزامنة مع خادم الفريق غير مضبوط — أضف SellerWeb:SyncKey في appsettings.json على سيرفر المحل" }, statusCode: 503);
            var target = $"{baseUrl}/api/admin/team/{path}{http.Request.QueryString}";
            using var req = new HttpRequestMessage(new HttpMethod(http.Request.Method), target);
            req.Headers.TryAddWithoutValidation("X-Fot-Sync-Key", key);
            // اسم المستخدم الإداري لسجل التدقيق على خادم الفريق
            var actor = http.User.FindFirstValue(ClaimTypes.Name) ?? http.User.FindFirstValue("name") ?? "admin";
            req.Headers.TryAddWithoutValidation("X-Fot-Actor", Uri.EscapeDataString(actor));
            if (http.Request.ContentLength > 0 || http.Request.Headers.ContainsKey("Transfer-Encoding"))
            {
                req.Content = new StreamContent(http.Request.Body);
                if (http.Request.ContentType is { } ctype)
                    req.Content.Headers.TryAddWithoutValidation("Content-Type", ctype);
            }
            try
            {
                using var res = await factory.CreateClient(HubClientName).SendAsync(req, ct);
                var bytes = await res.Content.ReadAsByteArrayAsync(ct);
                var type = res.Content.Headers.ContentType?.ToString() ?? "application/json; charset=utf-8";
                if (res.StatusCode == System.Net.HttpStatusCode.NotFound && bytes.Length == 0)
                    return Results.Json(new { error = "خادم الفريق لا يدعم هذه الميزة بعد — حدّث الـ VPS" }, statusCode: 502);
                http.Response.StatusCode = (int)res.StatusCode;
                http.Response.ContentType = type;
                await http.Response.Body.WriteAsync(bytes, ct);
                return Results.Empty;
            }
            catch (TaskCanceledException)
            {
                return Results.Json(new { error = "انتهت مهلة الاتصال بخادم الفريق" }, statusCode: 504);
            }
            catch
            {
                return Results.Json(new { error = "تعذر الوصول لخادم الفريق — تحقق من الإنترنت" }, statusCode: 502);
            }
        }).DisableAntiforgery();
    }

    /// <summary>تشغيل netsh بترميز UTF-8 (chcp 65001) لقراءة أسماء الشبكات العربية بشكل صحيح.</summary>
    private static async Task<(string Output, int Code)> RunNetshAsync(string args, CancellationToken ct)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo("cmd.exe", $"/c chcp 65001 >nul & netsh {args}")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = System.Text.Encoding.UTF8,
                StandardErrorEncoding = System.Text.Encoding.UTF8,
            };
            using var p = System.Diagnostics.Process.Start(psi);
            if (p is null) return ("", -1);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            var outTask = p.StandardOutput.ReadToEndAsync(timeout.Token);
            var errTask = p.StandardError.ReadToEndAsync(timeout.Token);
            await p.WaitForExitAsync(timeout.Token);
            return ((await outTask) + (await errTask), p.ExitCode);
        }
        catch (Exception ex)
        {
            return (ex.Message, -1);
        }
    }

    private static void Push(ISellerHubSync sync) =>
        _ = sync.PushAccountsNowAsync(CancellationToken.None);

    private static bool IsAdmin(HttpContext http) =>
        http.User.IsInRole("admin") || http.User.HasClaim("role", "admin")
        || string.Equals(http.User.FindFirstValue(ClaimTypes.Role), "admin", StringComparison.OrdinalIgnoreCase);
}

public sealed record SyncKeyRequest(string? Key);
