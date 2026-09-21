namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// Edari chart folders whose leaf accounts (Cod=1) can be linked to a POS section.
/// 100 = صناديق المحل, 221/121xx = دلفري وحسابات الترحيل.
/// </summary>
internal static class SectionPostingAccountRoots
{
    /// <summary>The shop's own cash boxes — what a section normally posts to.</summary>
    public const string CashBoxRootNum = "100";

    public static readonly string[] RootNums =
    [
        "100",    // صناديق المحل
        "221",    // دلفري
        "12101",  // دلفري بغداد
        "12103",  // حسابات توصيل
        "12104",  // دلفري خارجي
        "12106",  // دلفري داخل بغداد
    ];
}
