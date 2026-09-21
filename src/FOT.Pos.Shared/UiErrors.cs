using System.Net.Http;

namespace FOT.Pos.Shared;

public static class UiErrors
{
    public static string ToArabic(Exception ex)
    {
        for (var cur = ex; cur is not null; cur = cur.InnerException)
        {
            var msg = cur.Message ?? "";
            if (msg.Contains("already started one or more requests", StringComparison.OrdinalIgnoreCase))
                return "تعذر تحديث إعدادات الاتصال بعد بدء الطلب. أعد تشغيل التطبيق ثم أعد المحاولة.";
            if (cur is HttpRequestException)
                return "تعذر الاتصال بالخادم. تحقق من كابل الشبكة وعنوان IP وأن الخادم يعمل.";
            if (cur is TaskCanceledException or TimeoutException or OperationCanceledException)
                return "انتهت مهلة الاتصال بالخادم. تحقق من الشبكة وعنوان السيرفر.";
            if (cur is UnauthorizedAccessException)
                return "لا توجد صلاحية كافية لتنفيذ العملية.";
        }

        return string.IsNullOrWhiteSpace(ex.Message) ? "حدث خطأ غير متوقع." : ex.Message;
    }
}

public readonly record struct ConnectionProbeResult(bool Ok, string Message);
