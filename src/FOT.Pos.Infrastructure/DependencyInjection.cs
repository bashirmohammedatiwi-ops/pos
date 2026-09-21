using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace FOT.Pos.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        services.AddMemoryCache();
        var cs = EnsureSqlRetry(config.GetConnectionString("Default")
            ?? "Server=localhost\\FOTSQLSERVER;Database=FOT_POS_V2;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True;");
        services.AddSingleton<Data.ISqlConnectionFactory>(_ => new Data.SqlConnectionFactory(cs));
        services.AddScoped<Data.SchemaVersionService>();
        services.AddScoped<Data.SchemaMigrationRunner>();
        services.AddScoped<PosStartupService>();

        services.AddScoped<EdariSettingsService>();
        services.AddScoped<EdariSettingsRepository>();
        services.AddScoped<EdariConnectionFactory>();
        services.AddScoped<EdariNexusClient>();
        services.AddSingleton<EdariDashboardCache>();
        services.AddSingleton<EdariSyncGate>();
        services.TryAddSingleton<IEdariRealtimeNotifier, NullEdariRealtimeNotifier>();
        services.AddScoped<EdariReceiptSyncService>();
        services.AddScoped<EdariCatalogSyncService>();
        services.AddScoped<EdariLegacyOfferCleanupService>();
        services.AddScoped<EdariSalesmenSyncService>();
        services.AddScoped<EdariArticlesSyncService>();
        services.AddScoped<EdariBranchesSyncService>();
        services.AddScoped<EdariArabicNamesBackfillService>();
        services.AddScoped<EdariAccountsSyncService>();
        services.AddSingleton<HayatLegacyNameService>();
        // Arabic text arrives intact only over the nxServer admin channel, so it needs HttpClient.
        services.AddHttpClient("edari-text");
        services.AddScoped<EdariTextQueryService>();
        services.AddScoped<EdariDataPullService>();

        services.AddScoped<ProductRepository>();
        services.AddScoped<ArticleTreeRepository>();
        services.AddScoped<OfferRepository>();
        services.AddSingleton<ReceiptSchemaService>();
        services.AddSingleton<ReceiptSideEffectsDispatcher>();
        services.AddScoped<ReceiptNumberAllocator>();
        services.AddScoped<ReceiptRepository>();
        services.AddScoped<DiscountQrRepository>();
        services.AddScoped<AuthRepository>();
        services.AddScoped<DashboardRepository>();
        services.AddScoped<CashierRepository>();
        services.AddScoped<CommissionRepository>();
        services.AddScoped<WeeklySettlementRepository>();
        services.AddScoped<CommissionGroupRepository>();
        services.AddScoped<SellerPortalRepository>();
        services.AddScoped<PortalAccountRepository>();
        services.AddScoped<SalePostProcessor>();
        services.AddScoped<ProductAttributionRepository>();
        services.AddScoped<TargetRepository>();
        services.AddScoped<PermissionsRepository>();
        services.AddScoped<TerminalRepository>();
        services.AddScoped<SectionRepository>();
        services.AddScoped<ReportRepository>();
        services.AddScoped<ProductInquiryRepository>();
        services.AddScoped<PrintRepository>();
        services.AddScoped<PosCashBoxSettingsRepository>();
        services.AddScoped<BusinessPeriodSettingsRepository>();
        services.AddScoped<EdariSyncRepository>();
        services.AddScoped<ArticleGroupRepository>();
        services.AddScoped<CreditAccountRepository>();
        services.AddScoped<CashBoxAccountRepository>();
        services.AddScoped<PosLogRepository>();
        services.AddScoped<EdariSectionPushService>();
        services.AddScoped<ClientErrorRepository>();
        services.AddScoped<CatalogVersionRepository>();
        services.AddScoped<TreeMembershipRefresher>();
        return services;
    }

    private static string EnsureSqlRetry(string connectionString)
    {
        var builder = new SqlConnectionStringBuilder(connectionString)
        {
            MultipleActiveResultSets = true,
            TrustServerCertificate = true
        };
        if (builder.ConnectRetryCount < 3) builder.ConnectRetryCount = 3;
        if (builder.ConnectRetryInterval < 5) builder.ConnectRetryInterval = 5;
        if (builder.ConnectTimeout < 15) builder.ConnectTimeout = 15;
        return builder.ConnectionString;
    }
}
