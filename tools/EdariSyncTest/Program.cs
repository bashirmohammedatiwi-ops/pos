// أداة تشخيص: تشغّل خدمات الإداري الحقيقية عبر حاوية DI كاملة بعيداً عن FOT.Pos.Api.
// الوضع الافتراضي accounts: مزامنة شجرة الحسابات ثم فحص بحث الصناديق كما تراه لوحة التحكم.
using FOT.Pos.Infrastructure;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Repositories;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Text;

Console.OutputEncoding = Encoding.UTF8;
var mode = args.Length > 0 ? args[0].Trim().ToLowerInvariant() : "accounts";

var config = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["ConnectionStrings:Default"] = "Server=localhost\\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True;",
        ["ConnectionStrings:HayatLegacy"] = "Server=localhost\\FOTSQLSERVER;Database=HAYAT2025.mdf;Trusted_Connection=True;TrustServerCertificate=True;",
    })
    .Build();

var services = new ServiceCollection();
services.AddSingleton<IConfiguration>(config);
services.AddLogging(b => b.AddConsole().SetMinimumLevel(LogLevel.Warning));
services.AddInfrastructure(config);
var provider = services.BuildServiceProvider();

if (mode is "accounts" or "all")
{
    using var scope = provider.CreateScope();

    var migrations = scope.ServiceProvider.GetRequiredService<SchemaMigrationRunner>();
    var applied = await migrations.ApplyPendingAsync(default);
    Console.WriteLine($"ترحيلات مطبَّقة: {applied}");

    var text = scope.ServiceProvider.GetRequiredService<EdariTextQueryService>();
    var probe = await text.QueryAsync("SELECT Seq, Num, Name1 FROM File11n WHERE Num = '141'", default);
    Console.WriteLine($"قناة الأسماء العربية: {(text.LastCallSucceeded ? "تعمل" : "غير متاحة")} — صفوف {probe.Count}");
    foreach (var row in probe)
        Console.WriteLine($"  {string.Join(" | ", row)}");

    var sync = scope.ServiceProvider.GetRequiredService<EdariAccountsSyncService>();
    var result = await sync.SyncAsync(default);
    Console.WriteLine($"\nمزامنة الحسابات: Success={result.Success}");
    Console.WriteLine($"  {result.Message}");
    Console.WriteLine($"  Total={result.Total} CashBoxes={result.CashBoxes} Added={result.Added} Removed={result.Removed}");

    var repo = scope.ServiceProvider.GetRequiredService<CashBoxAccountRepository>();
    foreach (var term in new string?[] { null, "141", "صندوق", "تجريبي" })
    {
        var rows = await repo.SearchAsync(term, default);
        Console.WriteLine($"\nبحث «{term ?? "(القائمة الكاملة)"}» → {rows.Count} نتيجة");
        foreach (var r in rows.Take(term is null ? 20 : 6))
            Console.WriteLine($"  Seq={r.Id} Num={r.Num} Name={r.Name}");
    }

    var lookup = await repo.LookupBySeqsAsync([2280, 2342, 170], default);
    Console.WriteLine("\nأسماء الصناديق المرتبطة بالأقسام:");
    foreach (var r in lookup)
        Console.WriteLine($"  Seq={r.Seq} Num={r.Num} Name={r.Name}");
}

if (mode is "pull" or "all")
{
    Console.WriteLine("\n===== EdariDataPullService.PullAsync (نفس مسار الخدمة الخلفية) =====");
    try
    {
        using var scope = provider.CreateScope();
        var pull = scope.ServiceProvider.GetRequiredService<EdariDataPullService>();
        var pullResult = await pull.PullAsync(includeCatalog: false, default);
        Console.WriteLine($"Ok={pullResult.Ok}");
        Console.WriteLine($"Message={pullResult.Message}");
    }
    catch (Exception ex)
    {
        Console.WriteLine("!!! استثناء في PullAsync !!!");
        Console.WriteLine(ex);
    }
}

if (mode is "migrate")
{
    using var scope = provider.CreateScope();
    var migrations = scope.ServiceProvider.GetRequiredService<SchemaMigrationRunner>();
    Console.WriteLine($"ترحيلات مطبَّقة: {await migrations.ApplyPendingAsync(default)}");
}

if (mode is "receipts")
{
    using var scope = provider.CreateScope();
    var repo = scope.ServiceProvider.GetRequiredService<ReceiptRepository>();
    var page = await repo.ListAsync(1, 20, null, default);
    Console.WriteLine($"فواتير: {page.Total}");
    foreach (var r in page.Items)
    {
        Console.WriteLine($"  #{r.Number} بائع={r.SalesmanId} اسم={r.SalesmanName ?? "—"} عدد الباعة={r.SalesmanCount} صندوق={r.CashBoxNum ?? "—"}");
    }
}

if (mode is "catalog")
{
    using var scope = provider.CreateScope();
    var products = scope.ServiceProvider.GetRequiredService<ProductRepository>();
    var info = await products.GetCatalogInfoAsync(default);
    var ids = await products.GetLiveProductIdsAsync(default);
    Console.WriteLine($"catalog/info: TotalProducts={info.TotalProducts} MaxSeq={info.MaxSeq}");
    Console.WriteLine($"catalog/ids: {ids.Count} معرّف  |  فريدة={ids.Distinct().Count()}");
    Console.WriteLine(ids.Count == info.TotalProducts
        ? "متوافق: قائمة المعرّفات تطابق العدد المعلن — المطابقة في نقطة البيع ستحذف الزائد فقط"
        : $"تحذير: فرق {Math.Abs(ids.Count - info.TotalProducts)} بين القائمة والعدد");

    var delta = await products.SyncBatchAsync(0, 500, default);
    Console.WriteLine($"دفعة delta أولى: {delta.Count} صنف");

    var offers = scope.ServiceProvider.GetRequiredService<OfferRepository>();
    var offerList = await offers.ListAsync(1, 5, default);
    Console.WriteLine($"عروض: {offerList.Total}");
    var offerIds = offerList.Items.Select(o => o.Id).DefaultIfEmpty(0).ToList();
    foreach (var id in offerIds)
    {
        var touched = await offers.TouchOfferArticlesAsync(id, default);
        Console.WriteLine($"  عرض {id} → أُعيد نشر {touched} صنف لنقاط البيع");
    }
    Console.WriteLine($"سند فحص المعرّف: {await offers.GetDetailOfferIdAsync(1, default)}");
}

if (mode is "articles")
{
    using var scope = provider.CreateScope();
    var sync = scope.ServiceProvider.GetRequiredService<EdariArticlesSyncService>();
    var result = await sync.SyncAsync(default);
    Console.WriteLine($"Success={result.Success} {result.Message}");
    Console.WriteLine($"Added={result.Added} Updated={result.Updated} Deleted={result.Deleted} Total={result.Total}");
}
