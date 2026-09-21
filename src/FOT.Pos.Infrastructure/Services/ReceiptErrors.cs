using Microsoft.Data.SqlClient;

namespace FOT.Pos.Infrastructure.Services;

public static class ReceiptErrors
{
    public static string ToUserMessage(Exception ex)
    {
        if (ex is InvalidOperationException ioe)
            return ioe.Message;

        if (ex is SqlException sql)
            return ToUserMessage(sql);

        var msg = ex.Message;
        if (msg.Contains("pending local transaction", StringComparison.OrdinalIgnoreCase))
            return "الخادم يحتاج التحديث — ثبّت FOT-POS-Server-Setup.exe ثم أعد تشغيل الخدمة";
        if (msg.Contains("parameterless default constructor", StringComparison.OrdinalIgnoreCase))
            return "خطأ في قراءة بيانات الفاتورة — حدّث برنامج الخادم";
        if (msg.Contains("Invalid column name", StringComparison.OrdinalIgnoreCase))
            return "قاعدة البيانات تحتاج ترحيلاً — شغّل تحديث الخادم أو migrations";
        return "تعذر حفظ الفاتورة — راجع الخادم أو اتصل بالدعم";
    }

    private static string ToUserMessage(SqlException ex)
    {
        if (ex.Message.Contains("pending local transaction", StringComparison.OrdinalIgnoreCase))
            return "الخادم يحتاج التحديث — ثبّت FOT-POS-Server-Setup.exe ثم أعد تشغيل الخدمة";
        if (ex.Number is 2627 or 2601)
            return "الفاتورة مسجّلة مسبقاً";
        if (ex.Number == 207)
            return "قاعدة البيانات غير محدّثة — شغّل migrations على FOT_POS_V2";
        return ToUserMessage((Exception)ex);
    }
}
