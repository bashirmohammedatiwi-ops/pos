using System.Security.Claims;
using System.Text;
using FOT.Pos.Api;
using FOT.Pos.Api.Auth;
using FOT.Pos.Api.Endpoints;
using FOT.Pos.Api.Health;
using FOT.Pos.Api.Hubs;
using FOT.Pos.Api.HostedServices;
using FOT.Pos.Api.Lan;
using FOT.Pos.Infrastructure;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared.Dtos;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Microsoft.OpenApi.Writers;
using Serilog;
using Swashbuckle.AspNetCore.Swagger;

var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FOT.Pos", "logs");
Directory.CreateDirectory(logDir);

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.File(Path.Combine(logDir, "api-.log"), rollingInterval: RollingInterval.Day, retainedFileCountLimit: 14)
    .WriteTo.Console()
    .CreateLogger();

var exportOpenApi = args.Contains("--export-openapi");
var builder = WebApplication.CreateBuilder(args);

if (!exportOpenApi)
{
    builder.Host.UseWindowsService(options => options.ServiceName = "FOTPOSServer");
    // FOT_API_URL allows side-by-side/secondary instances (staging, canary) without
    // touching the default LAN listener.
    builder.WebHost.UseUrls(Environment.GetEnvironmentVariable("FOT_API_URL") ?? "http://0.0.0.0:5000");
    builder.WebHost.ConfigureKestrel(o =>
    {
        o.Limits.MaxRequestBodySize = 8 * 1024 * 1024;
        o.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(2);
        o.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(30);
        o.Limits.MaxConcurrentConnections = 256;
        o.Limits.MaxConcurrentUpgradedConnections = 128;
    });
}
else
{
    builder.WebHost.UseUrls("http://127.0.0.1:0");
}

builder.Host.UseSerilog();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddHttpClient(SellerWebPublisher.ClientName, c =>
{
    c.Timeout = TimeSpan.FromSeconds(6);
});
builder.Services.AddSingleton<SellerWebPublisher>();
builder.Services.AddHttpClient(SellerHubSyncService.ClientName, c =>
{
    c.Timeout = TimeSpan.FromSeconds(180);
});
builder.Services.AddSingleton<SellerHubSyncService>();
builder.Services.AddSingleton<ISellerHubSync>(sp => sp.GetRequiredService<SellerHubSyncService>());
builder.Services.AddSingleton<FOT.Pos.Infrastructure.Edari.IEdariRealtimeNotifier, PosHubEdariRealtimeNotifier>();
if (!exportOpenApi)
{
    builder.Services.AddHostedService(sp => sp.GetRequiredService<SellerHubSyncService>());
    builder.Services.AddHostedService<EdariSyncBackgroundService>();
    builder.Services.AddHostedService<EdariDataFolderWatcher>();
    builder.Services.AddHostedService<LanDiscoveryHostedService>();
    builder.Services.Configure<PriceCheckerLanOptions>(builder.Configuration.GetSection("PriceCheckerLan"));
    builder.Services.AddHostedService<LanDhcpHostedService>();
    builder.Services.AddHostedService<ClientTelemetryFlushService>();
}
builder.Services.AddSignalR();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "FOT POS API", Version = "v2" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Bearer token",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer"
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } },
            Array.Empty<string>()
        }
    });
});

var jwtKey = JwtKeyStore.Resolve(builder.Configuration);
builder.Configuration["Jwt:Key"] = jwtKey;
if (jwtKey.Contains("CHANGE-THIS", StringComparison.OrdinalIgnoreCase))
    Log.Warning("Jwt:Key is still the default placeholder — set a unique secret before exposing the API on the LAN");
else
    Log.Information("JWT signing key loaded for LAN clients");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = true;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(15),
            RoleClaimType = ClaimTypes.Role,
            NameClaimType = ClaimTypes.Name,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    ctx.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization(o =>
{
    o.AddPolicy("SellerOnly", p => p.RequireRole("seller"));
    o.AddPolicy("ManagerOnly", p => p.RequireRole("manager"));
});
builder.Services.AddResponseCompression(o => o.EnableForHttps = true);
builder.Services.AddHealthChecks()
    .AddCheck<SqlDbHealthCheck>("sql", failureStatus: HealthStatus.Unhealthy)
    .AddCheck<EdariHealthCheck>("edari", failureStatus: HealthStatus.Degraded);

var configuredOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
var allowedOrigins = configuredOrigins
    .Concat([
        "http://127.0.0.1:5000", "http://localhost:5000",
        "http://127.0.0.1:5173", "http://localhost:5173",
        "http://127.0.0.1:5174", "http://localhost:5174",
        "http://127.0.0.1:5175", "http://localhost:5175",
        "http://127.0.0.1:5176", "http://localhost:5176",
        "http://127.0.0.1:4700", "http://localhost:4700",
        "http://127.0.0.1:4701", "http://localhost:4701",
        "http://127.0.0.1:4702", "http://localhost:4702",
        "http://127.0.0.1:4703", "http://localhost:4703",
        "https://appassets.androidplatform.net"
    ])
    .Where(o => !string.IsNullOrWhiteSpace(o))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToHashSet(StringComparer.OrdinalIgnoreCase);

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.SetIsOriginAllowed(origin => LanOrigin.IsAllowed(origin, allowedOrigins))
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials()));

var app = builder.Build();
var bundledSchema = SchemaVersionService.ResolveBundledVersion(app.Environment.ContentRootPath);

if (!exportOpenApi && Environment.GetEnvironmentVariable("FOT_SKIP_STARTUP_DB") != "1")
{
    try
    {
        using var scope = app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<PosStartupService>().RunAsync(default);
        await scope.ServiceProvider.GetRequiredService<AuthRepository>().EnsureAdminSeededAsync(default);

        // Seed the durable catalog version so pushes survive restarts without resetting to zero.
        var catalogVersionRepo = scope.ServiceProvider.GetRequiredService<CatalogVersionRepository>();
        var latestVersion = await catalogVersionRepo.GetLatestAsync(default);
        FOT.Pos.Api.Hubs.CatalogVersionHolder.State.Seed(latestVersion);
        FOT.Pos.Api.Hubs.CatalogVersionPersistence.Init(catalogVersionRepo);
        Log.Information("Catalog version seeded to {Version}", latestVersion);

        var schema = await scope.ServiceProvider.GetRequiredService<SchemaVersionService>().GetAsync(bundledSchema);
        Log.Information("Schema version: {Version} ({Name})", schema.Version, schema.Name ?? "none");
        if (schema.PendingCount > 0)
            Log.Warning("Pending migrations remain: {Count} (db={Version}, bundled={Bundled})", schema.PendingCount, schema.Version, schema.BundledLatest);
    }
    catch (Exception ex)
    {
        Log.Warning(ex, "Startup database init skipped — API will keep serving /health and /healthz");
    }
}

app.UseExceptionHandler(err => err.Run(async ctx =>
{
    var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    Log.Error(ex, "Unhandled API exception {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
    ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
    ctx.Response.ContentType = "application/json; charset=utf-8";
    // رسائل InvalidOperationException نصدرها عمداً من المستودعات — تظهر للمستخدم كما هي
    var error = ex is InvalidOperationException ? ex.Message : "تعذر تنفيذ الطلب. أعد المحاولة أو راجع سجل الخادم.";
    await ctx.Response.WriteAsJsonAsync(new { error });
}));

app.UseSwagger();
if (app.Environment.IsDevelopment())
{
    app.UseSwaggerUI();
}

app.UseResponseCompression();
// Request timing/duration log — the diagnostics backbone: every API call is traceable
// with its status and duration; slow calls (>1s) escalate to Warning.
app.UseSerilogRequestLogging(o =>
{
    o.MessageTemplate = "{RequestMethod} {RequestPath} responded {StatusCode} in {Elapsed:0.0} ms";
    o.GetLevel = (httpContext, elapsed, ex) =>
        ex is not null ? Serilog.Events.LogEventLevel.Error
        : elapsed > 1000 ? Serilog.Events.LogEventLevel.Warning
        : Serilog.Events.LogEventLevel.Information;
    o.EnrichDiagnosticContext = (diag, httpContext) =>
    {
        diag.Set("User", httpContext.User.Identity?.Name ?? "-");
        diag.Set("Terminal", httpContext.Request.Headers.TryGetValue("X-POS-HWId", out var hw) ? hw.ToString() : "-");
    };
});
app.UseMiddleware<PrivateNetworkAccessMiddleware>();
app.Use(async (ctx, next) =>
{
    var origin = ctx.Request.Headers.Origin.ToString();
    var path = ctx.Request.Path.Value ?? "";
    var priceOrHealth = path.StartsWith("/api/price-checker", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/api/v1/catalog", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/health", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/healthz", StringComparison.OrdinalIgnoreCase);
    if (priceOrHealth && (string.IsNullOrEmpty(origin) || origin == "null" || origin.StartsWith("file:", StringComparison.OrdinalIgnoreCase)))
    {
        ctx.Response.OnStarting(() =>
        {
            ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
            ctx.Response.Headers.Remove("Access-Control-Allow-Credentials");
            return Task.CompletedTask;
        });
    }
    await next();
});
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapHub<PosHub>("/hubs/pos");
app.MapHealthChecks("/healthz", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions
{
    ResponseWriter = async (ctx, report) =>
    {
        ctx.Response.ContentType = "application/json";
        var schema = ctx.RequestServices.GetRequiredService<SchemaVersionService>();
        var schemaInfo = await schema.GetAsync(bundledSchema);
        var body = new
        {
            status = report.Status.ToString().ToLowerInvariant(),
            schemaVersion = schemaInfo.Version,
            bundledSchemaVersion = schemaInfo.BundledLatest,
            pendingMigrations = schemaInfo.PendingCount,
            checks = report.Entries.ToDictionary(
                e => e.Key,
                e => new { status = e.Value.Status.ToString().ToLowerInvariant(), description = e.Value.Description })
        };
        await ctx.Response.WriteAsJsonAsync(body);
    }
});

app.MapGet("/health", async (ISqlConnectionFactory db, SchemaVersionService schema) =>
{
    var schemaInfo = await schema.GetAsync(bundledSchema);
    try
    {
        await using var conn = await db.CreateOpenConnectionAsync();
        return Results.Ok(new
        {
            status = "ok",
            database = "FOT_POS_V2",
            timestamp = DateTime.UtcNow,
            schemaVersion = schemaInfo.Version,
            schemaName = schemaInfo.Name,
            schemaTableExists = schemaInfo.TableExists,
            bundledSchemaVersion = schemaInfo.BundledLatest,
            pendingMigrations = schemaInfo.PendingCount
        });
    }
    catch (Exception ex)
    {
        return Results.Json(new
        {
            status = "degraded",
            error = ex.Message,
            bundledSchemaVersion = schemaInfo.BundledLatest,
            pendingMigrations = schemaInfo.PendingCount,
            schemaVersion = schemaInfo.Version,
            schemaTableExists = schemaInfo.TableExists
        }, statusCode: 503);
    }
}).WithName("Health").Produces(200).Produces(503).AllowAnonymous();

app.MapGet("/api/server/info", (IWebHostEnvironment env) =>
{
    var lanIps = LanNetwork.ListIpv4Addresses();
    var adminDist = LanUi.ResolveAdminDist(env.ContentRootPath);
    return Results.Ok(new ServerInfoDto(
        Environment.MachineName,
        lanIps,
        LanNetwork.ApiPort,
        adminDist != null,
        DateTime.UtcNow));
}).AllowAnonymous();

app.MapAuthEndpoints();
app.MapSellerAuthEndpoints();
app.MapManagerAuthEndpoints();
app.MapPriceCheckerEndpoints();
app.MapStoreCatalogEndpoints();

var api = app.MapGroup("/api").RequireAuthorization();
api.MapCatalogEndpoints();
api.MapReceiptEndpoints();
api.MapSettingsEndpoints();
api.MapAdminEndpoints();
api.MapPortalAccountEndpoints();
api.MapTelemetryEndpoints();
api.MapSellerPortalEndpoints();
api.MapManagerPortalEndpoints();

var uploadsPath = FotDataPaths.Uploads;
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadsPath),
    RequestPath = "/uploads"
});

var priceDistPath = LanUi.ResolvePriceDist(app.Environment.ContentRootPath);
if (priceDistPath != null)
{
    var priceFiles = new PhysicalFileProvider(priceDistPath);
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = priceFiles,
        RequestPath = "/price",
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = priceFiles,
        RequestPath = "/price",
        OnPrepareResponse = ctx =>
        {
            var path = ctx.Context.Request.Path.Value ?? "";
            if (path.Contains("/assets/", StringComparison.OrdinalIgnoreCase))
            {
                ctx.Context.Response.Headers.CacheControl = "public,max-age=31536000,immutable";
                return;
            }
            ctx.Context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
            ctx.Context.Response.Headers.Pragma = "no-cache";
        }
    });
    app.MapFallback("/price/{**path}", async context =>
    {
        context.Response.ContentType = "text/html; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        await context.Response.SendFileAsync(Path.Combine(priceDistPath, "index.html"));
    });
}

var adminDistPath = LanUi.ResolveAdminDist(app.Environment.ContentRootPath);
if (adminDistPath != null)
{
    var adminFiles = new PhysicalFileProvider(adminDistPath);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = adminFiles });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = adminFiles,
        OnPrepareResponse = ctx =>
        {
            var path = ctx.Context.Request.Path.Value ?? "";
            if (path.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase))
            {
                ctx.Context.Response.Headers.CacheControl = "public,max-age=31536000,immutable";
                return;
            }
            ctx.Context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
            ctx.Context.Response.Headers.Pragma = "no-cache";
        }
    });
    app.MapFallbackToFile("index.html", new StaticFileOptions
    {
        FileProvider = adminFiles,
        OnPrepareResponse = ctx =>
        {
            ctx.Context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
            ctx.Context.Response.Headers.Pragma = "no-cache";
        }
    });
}

if (exportOpenApi)
{
    var exportFlag = Array.IndexOf(args, "--export-openapi");
    var outPath = exportFlag + 1 < args.Length && !args[exportFlag + 1].StartsWith('-')
        ? args[exportFlag + 1]
        : Path.Combine(AppContext.BaseDirectory, "openapi.json");
    Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath))!);
    await app.StartAsync();
    try
    {
        var doc = app.Services.GetRequiredService<ISwaggerProvider>().GetSwagger("v1");
        await using var stream = File.Create(outPath);
        await using var text = new StreamWriter(stream);
        doc.SerializeAsV3(new OpenApiJsonWriter(text));
        await text.FlushAsync();
        Log.Information("Wrote OpenAPI document ({Paths} paths) to {Path}", doc.Paths.Count, Path.GetFullPath(outPath));
    }
    finally
    {
        await app.StopAsync();
    }
    return;
}

try
{
    app.Run();
}
catch (IOException ex) when (ex.InnerException is Microsoft.AspNetCore.Connections.AddressInUseException
    || ex.Message.Contains("address already in use", StringComparison.OrdinalIgnoreCase))
{
    Log.Warning(ex, "Port 5000 is already in use — another FOT POS API instance is running");
}
