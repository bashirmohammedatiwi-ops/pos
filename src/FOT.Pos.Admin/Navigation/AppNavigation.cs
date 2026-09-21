namespace FOT.Pos.Admin.Navigation;

public sealed record NavPage(string Key, string Title, string Subtitle, string Icon);

public sealed record NavGroup(string Key, string Title, string Icon, IReadOnlyList<NavPage> Pages);

public static class AppNavigation
{
    public static IReadOnlyList<NavGroup> Groups { get; } =
    [
        new("home", "الرئيسية", "\uE80F", [
            new("dashboard", "لوحة التحكم", "نظرة عامة على أداء المتجر", "\uE80F")
        ]),
        new("sales", "المبيعات", "\uE719", [
            new("products", "المنتجات", "إدارة المخزون والأسعار", "\uE719"),
            new("offers", "العروض", "خصم · شجرات · مجموعات", "\uE7C8"),
            new("groups", "مجموعات الأزرار", "أزرار المنتجات في POS", "\uE8A5"),
            new("accounts", "حسابات آجلة", "عملاء البيع بالآجل", "\uE825")
        ]),
        new("ops", "العمليات", "\uE916", [
            new("receipts", "الفواتير", "استعراض · فلاتر · تفاصيل", "\uE8A1"),
            new("activity", "حركات الكاشير", "سجل أحداث الكاشير", "\uE916"),
            new("reports", "التقارير", "مبيعات · مندوب · حركة مواد", "\uE9F9")
        ]),
        new("staff", "الموظفون", "\uE716", [
            new("salesmen", "البائعون", "مزامنة من Edari", "\uE716"),
            new("cashiers", "الكاشير", "ربط كل كاشير بقسم", "\uE8D7")
        ]),
        new("incentives", "الحوافز", "\uE9D9", [
            new("commissions", "العمولات", "قواعد حساب العمولات", "\uE8CB"),
            new("targets", "الأهداف", "تتبع التقدم", "\uE9D9")
        ]),
        new("system", "النظام", "\uE713", [
            new("sections", "الأقسام", "ربط الصناديق بكل قسم", "\uE8B7"),
            new("terminals", "الأجهزة", "أجهزة البيع المتصلة", "\uE977"),
            new("settings", "الطباعة", "إعدادات الفاتورة الحرارية", "\uE713"),
            new("edari", "Edari", "مزامنة الإداري", "\uE895")
        ])
    ];

    private static readonly Dictionary<string, (NavPage Page, NavGroup Group)> _index =
        Groups.SelectMany(g => g.Pages.Select(p => (p.Key, Page: p, Group: g)))
            .ToDictionary(x => x.Key, x => (x.Page, x.Group));

    public static (NavPage Page, NavGroup Group)? Find(string key) =>
        _index.TryGetValue(key, out var v) ? v : null;

    public static string Breadcrumb(string key)
    {
        var found = Find(key);
        return found is null ? "—" : $"{found.Value.Group.Title}  /  {found.Value.Page.Title}";
    }
}
