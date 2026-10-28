using System.Security.Cryptography;
using System.Text;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Caching.Memory;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed record ValidatedApiKey(
    long Id,
    string Name,
    string RoleName,
    HashSet<string> Scopes);

public sealed record ActiveWebhookTarget(
    long Id,
    string Name,
    string TargetUrl,
    string? Secret,
    HashSet<string> Events);

public sealed class ApiPlatformRepository(ISqlConnectionFactory db, IMemoryCache cache)
{
    public static readonly IReadOnlyList<string> AllScopes =
    [
        "*",
        "catalog:read",
        "catalog:write",
        "sales:read",
        "sales:write",
        "inventory:read",
        "team:read",
        "customers:read",
        "edari:read",
        "events:publish"
    ];

    private const string CachePrefix = "fot_api_key_hash:";
    private const string WebhooksCacheKey = "fot_active_webhooks";
    private static volatile bool _schemaEnsured;
    private static readonly SemaphoreSlim SchemaGate = new(1, 1);

    private sealed class KeyRow
    {
        public long Id { get; set; }
        public string Name { get; set; } = "";
        public string KeyPrefix { get; set; } = "";
        public string KeyHash { get; set; } = "";
        public string Scopes { get; set; } = "*";
        public string RoleName { get; set; } = "admin";
        public string? Notes { get; set; }
        public bool IsActive { get; set; }
        public long RequestCount { get; set; }
        public DateTime? LastUsedAt { get; set; }
        public string? LastUsedIp { get; set; }
        public DateTime? ExpiresAt { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    private sealed class WebhookRow
    {
        public long Id { get; set; }
        public string Name { get; set; } = "";
        public string TargetUrl { get; set; } = "";
        public string? Secret { get; set; }
        public string Events { get; set; } = "*";
        public bool IsActive { get; set; }
        public long DeliveryCount { get; set; }
        public long FailureCount { get; set; }
        public int? LastStatusCode { get; set; }
        public string? LastError { get; set; }
        public DateTime? LastTriggeredAt { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public async Task EnsureSchemaAsync(CancellationToken ct = default)
    {
        if (_schemaEnsured) return;
        await SchemaGate.WaitAsync(ct);
        try
        {
            if (_schemaEnsured) return;
            const string sql = """
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_api_keys')
                BEGIN
                    CREATE TABLE dbo.ext_api_keys (
                        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_api_keys PRIMARY KEY,
                        name            NVARCHAR(200) NOT NULL,
                        key_prefix      NVARCHAR(32) NOT NULL,
                        key_hash        NVARCHAR(128) NOT NULL,
                        scopes          NVARCHAR(1000) NOT NULL CONSTRAINT DF_ext_api_keys_scopes DEFAULT N'*',
                        role_name       NVARCHAR(50) NOT NULL CONSTRAINT DF_ext_api_keys_role DEFAULT N'admin',
                        notes           NVARCHAR(500) NULL,
                        is_active       BIT NOT NULL CONSTRAINT DF_ext_api_keys_active DEFAULT 1,
                        request_count   BIGINT NOT NULL CONSTRAINT DF_ext_api_keys_req_count DEFAULT 0,
                        last_used_at    DATETIME2 NULL,
                        last_used_ip    NVARCHAR(64) NULL,
                        expires_at      DATETIME2 NULL,
                        created_at      DATETIME2 NOT NULL CONSTRAINT DF_ext_api_keys_created DEFAULT GETDATE()
                    );
                    CREATE UNIQUE INDEX IX_ext_api_keys_hash ON dbo.ext_api_keys(key_hash);
                END

                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_api_webhooks')
                BEGIN
                    CREATE TABLE dbo.ext_api_webhooks (
                        id                  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_api_webhooks PRIMARY KEY,
                        name                NVARCHAR(200) NOT NULL,
                        target_url          NVARCHAR(1000) NOT NULL,
                        secret              NVARCHAR(128) NULL,
                        events              NVARCHAR(500) NOT NULL CONSTRAINT DF_ext_api_webhooks_events DEFAULT N'*',
                        is_active           BIT NOT NULL CONSTRAINT DF_ext_api_webhooks_active DEFAULT 1,
                        delivery_count      BIGINT NOT NULL CONSTRAINT DF_ext_api_webhooks_deliveries DEFAULT 0,
                        failure_count       BIGINT NOT NULL CONSTRAINT DF_ext_api_webhooks_failures DEFAULT 0,
                        last_status_code    INT NULL,
                        last_error          NVARCHAR(500) NULL,
                        last_triggered_at   DATETIME2 NULL,
                        created_at          DATETIME2 NOT NULL CONSTRAINT DF_ext_api_webhooks_created DEFAULT GETDATE()
                    );
                END
                """;
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            await conn.ExecuteAsync(new CommandDefinition(sql, cancellationToken: ct));
            _schemaEnsured = true;
        }
        finally
        {
            SchemaGate.Release();
        }
    }

    public async Task<IReadOnlyList<ApiKeyDto>> ListKeysAsync(CancellationToken ct = default)
    {
        await EnsureSchemaAsync(ct);
        const string sql = """
            SELECT id AS Id, name AS Name, key_prefix AS KeyPrefix, key_hash AS KeyHash,
                   scopes AS Scopes, role_name AS RoleName, notes AS Notes, is_active AS IsActive,
                   request_count AS RequestCount, last_used_at AS LastUsedAt, last_used_ip AS LastUsedIp,
                   expires_at AS ExpiresAt, created_at AS CreatedAt
            FROM dbo.ext_api_keys
            ORDER BY id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<KeyRow>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.Select(MapKey).ToList();
    }

    public async Task<CreateApiKeyResponse> CreateKeyAsync(CreateApiKeyRequest req, CancellationToken ct = default)
    {
        await EnsureSchemaAsync(ct);
        var name = (req.Name ?? "").Trim();
        if (name.Length == 0)
            throw new InvalidOperationException("أدخل اسماً لمفتاح الـ API");

        var rawBytes = RandomNumberGenerator.GetBytes(20);
        var hex = Convert.ToHexString(rawBytes).ToLowerInvariant();
        var plainKey = $"fot_k_{hex}";
        var prefix = plainKey[..14];
        var hash = HashKey(plainKey);

        var scopesList = NormalizeScopes(req.Scopes);
        var scopesCsv = string.Join(",", scopesList);
        var roleName = string.IsNullOrWhiteSpace(req.RoleName) ? "admin" : req.RoleName.Trim().ToLowerInvariant();
        DateTime? expiresAt = req.ExpiresInDays is > 0 ? DateTime.UtcNow.AddDays(req.ExpiresInDays.Value) : null;

        const string sql = """
            INSERT INTO dbo.ext_api_keys (name, key_prefix, key_hash, scopes, role_name, notes, is_active, expires_at)
            OUTPUT INSERTED.id AS Id, INSERTED.name AS Name, INSERTED.key_prefix AS KeyPrefix, INSERTED.key_hash AS KeyHash,
                   INSERTED.scopes AS Scopes, INSERTED.role_name AS RoleName, INSERTED.notes AS Notes, INSERTED.is_active AS IsActive,
                   INSERTED.request_count AS RequestCount, INSERTED.last_used_at AS LastUsedAt, INSERTED.last_used_ip AS LastUsedIp,
                   INSERTED.expires_at AS ExpiresAt, INSERTED.created_at AS CreatedAt
            VALUES (@name, @prefix, @hash, @scopesCsv, @roleName, @notes, 1, @expiresAt)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleAsync<KeyRow>(new CommandDefinition(
            sql,
            new { name, prefix, hash, scopesCsv, roleName, notes = string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim(), expiresAt },
            cancellationToken: ct));

        cache.Remove(CachePrefix + hash);
        return new CreateApiKeyResponse(plainKey, MapKey(row));
    }

    public async Task<ApiKeyDto?> UpdateKeyAsync(long id, UpdateApiKeyRequest req, CancellationToken ct = default)
    {
        await EnsureSchemaAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var current = await conn.QueryFirstOrDefaultAsync<KeyRow>(new CommandDefinition(
            """
            SELECT id AS Id, name AS Name, key_prefix AS KeyPrefix, key_hash AS KeyHash,
                   scopes AS Scopes, role_name AS RoleName, notes AS Notes, is_active AS IsActive,
                   request_count AS RequestCount, last_used_at AS LastUsedAt, last_used_ip AS LastUsedIp,
                   expires_at AS ExpiresAt, created_at AS CreatedAt
            FROM dbo.ext_api_keys WHERE id = @id
            """,
            new { id }, cancellationToken: ct));
        if (current is null) return null;

        var name = !string.IsNullOrWhiteSpace(req.Name) ? req.Name.Trim() : current.Name;
        var scopesCsv = req.Scopes is not null ? string.Join(",", NormalizeScopes(req.Scopes)) : current.Scopes;
        var notes = req.Notes is not null ? (string.IsNullOrWhiteSpace(req.Notes) ? null : req.Notes.Trim()) : current.Notes;
        var isActive = req.IsActive ?? current.IsActive;

        await conn.ExecuteAsync(new CommandDefinition(
            """
            UPDATE dbo.ext_api_keys
            SET name = @name, scopes = @scopesCsv, notes = @notes, is_active = @isActive
            WHERE id = @id
            """,
            new { id, name, scopesCsv, notes, isActive }, cancellationToken: ct));

        cache.Remove(CachePrefix + current.KeyHash);
        current.Name = name;
        current.Scopes = scopesCsv;
        current.Notes = notes;
        current.IsActive = isActive;
        return MapKey(current);
    }

    public async Task<bool> DeleteKeyAsync(long id, CancellationToken ct = default)
    {
        await EnsureSchemaAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var hash = await conn.QueryFirstOrDefaultAsync<string>(new CommandDefinition(
            "SELECT key_hash FROM dbo.ext_api_keys WHERE id = @id", new { id }, cancellationToken: ct));
        if (hash is null) return false;
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM dbo.ext_api_keys WHERE id = @id", new { id }, cancellationToken: ct));
        cache.Remove(CachePrefix + hash);
        return true;
    }

    public async Task<ValidatedApiKey?> ValidateKeyAsync(string rawKey, string? remoteIp, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(rawKey)) return null;
        var trimmed = rawKey.Trim();
        var hash = HashKey(trimmed);
        var cacheKey = CachePrefix + hash;

        if (!cache.TryGetValue(cacheKey, out ValidatedApiKey? validated))
        {
            await EnsureSchemaAsync(ct);
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            var row = await conn.QueryFirstOrDefaultAsync<KeyRow>(new CommandDefinition(
                """
                SELECT id AS Id, name AS Name, key_prefix AS KeyPrefix, key_hash AS KeyHash,
                       scopes AS Scopes, role_name AS RoleName, is_active AS IsActive, expires_at AS ExpiresAt
                FROM dbo.ext_api_keys
                WHERE key_hash = @hash
                """,
                new { hash }, cancellationToken: ct));

            if (row is null || !row.IsActive || (row.ExpiresAt.HasValue && row.ExpiresAt.Value < DateTime.UtcNow))
            {
                cache.Set<ValidatedApiKey?>(cacheKey, null, TimeSpan.FromSeconds(30));
                return null;
            }

            var scopes = SplitCsv(row.Scopes).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (scopes.Count == 0) scopes.Add("*");
            validated = new ValidatedApiKey(row.Id, row.Name, row.RoleName, scopes);
            cache.Set(cacheKey, validated, TimeSpan.FromMinutes(5));
        }

        if (validated is not null)
        {
            var keyId = validated.Id;
            var ip = remoteIp;
            _ = Task.Run(async () =>
            {
                try
                {
                    await using var c = await db.CreateOpenConnectionAsync(CancellationToken.None);
                    await c.ExecuteAsync(
                        """
                        UPDATE dbo.ext_api_keys
                        SET request_count = request_count + 1,
                            last_used_at = GETDATE(),
                            last_used_ip = COALESCE(@ip, last_used_ip)
                        WHERE id = @keyId
                        """,
                        new { keyId, ip });
                }
                catch
                {
                    /* non-blocking telemetry */
                }
            });
        }

        return validated;
    }

    // ── Webhooks ─────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<ApiWebhookDto>> ListWebhooksAsync(CancellationToken ct = default)
    {
        await EnsureSchemaAsync(ct);
        const string sql = """
            SELECT id AS Id, name AS Name, target_url AS TargetUrl, secret AS Secret,
                   events AS Events, is_active AS IsActive, delivery_count AS DeliveryCount,
                   failure_count AS FailureCount, last_status_code AS LastStatusCode,
                   last_error AS LastError, last_triggered_at AS LastTriggeredAt, created_at AS CreatedAt
            FROM dbo.ext_api_webhooks
            ORDER BY id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<WebhookRow>(new CommandDefinition(sql, cancellationToken: ct));
        return rows.Select(MapWebhook).ToList();
    }

    public async Task<IReadOnlyList<ActiveWebhookTarget>> GetActiveWebhookTargetsAsync(CancellationToken ct = default)
    {
        if (cache.TryGetValue(WebhooksCacheKey, out IReadOnlyList<ActiveWebhookTarget>? cached) && cached is not null)
            return cached;

        await EnsureSchemaAsync(ct);
        const string sql = """
            SELECT id AS Id, name AS Name, target_url AS TargetUrl, secret AS Secret, events AS Events
            FROM dbo.ext_api_webhooks
            WHERE is_active = 1
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<WebhookRow>(new CommandDefinition(sql, cancellationToken: ct));
        var list = rows.Select(r => new ActiveWebhookTarget(
            r.Id,
            r.Name,
            r.TargetUrl,
            r.Secret,
            SplitCsv(r.Events).ToHashSet(StringComparer.OrdinalIgnoreCase))).ToList();
        cache.Set<IReadOnlyList<ActiveWebhookTarget>>(WebhooksCacheKey, list, TimeSpan.FromMinutes(2));
        return list;
    }

    public async Task<ActiveWebhookTarget?> GetWebhookTargetByIdAsync(long id, CancellationToken ct = default)
    {
        await EnsureSchemaAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var r = await conn.QueryFirstOrDefaultAsync<WebhookRow>(new CommandDefinition(
            "SELECT id AS Id, name AS Name, target_url AS TargetUrl, secret AS Secret, events AS Events FROM dbo.ext_api_webhooks WHERE id = @id",
            new { id }, cancellationToken: ct));
        return r is null
            ? null
            : new ActiveWebhookTarget(r.Id, r.Name, r.TargetUrl, r.Secret, SplitCsv(r.Events).ToHashSet(StringComparer.OrdinalIgnoreCase));
    }

    public async Task<ApiWebhookDto> CreateWebhookAsync(CreateApiWebhookRequest req, CancellationToken ct = default)
    {
        await EnsureSchemaAsync(ct);
        var name = (req.Name ?? "").Trim();
        var url = (req.TargetUrl ?? "").Trim();
        if (name.Length == 0) throw new InvalidOperationException("أدخل اسماً للويب هوك");
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new InvalidOperationException("أدخل رابط HTTP أو HTTPS صالحاً");

        var eventsCsv = req.Events is { Count: > 0 }
            ? string.Join(",", req.Events.Select(e => e.Trim()).Where(e => e.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
            : "*";
        var secret = string.IsNullOrWhiteSpace(req.Secret) ? null : req.Secret.Trim();

        const string sql = """
            INSERT INTO dbo.ext_api_webhooks (name, target_url, secret, events, is_active)
            OUTPUT INSERTED.id AS Id, INSERTED.name AS Name, INSERTED.target_url AS TargetUrl, INSERTED.secret AS Secret,
                   INSERTED.events AS Events, INSERTED.is_active AS IsActive, INSERTED.delivery_count AS DeliveryCount,
                   INSERTED.failure_count AS FailureCount, INSERTED.last_status_code AS LastStatusCode,
                   INSERTED.last_error AS LastError, INSERTED.last_triggered_at AS LastTriggeredAt, INSERTED.created_at AS CreatedAt
            VALUES (@name, @url, @secret, @eventsCsv, 1)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleAsync<WebhookRow>(new CommandDefinition(
            sql, new { name, url, secret, eventsCsv }, cancellationToken: ct));
        cache.Remove(WebhooksCacheKey);
        return MapWebhook(row);
    }

    public async Task<ApiWebhookDto?> UpdateWebhookAsync(long id, UpdateApiWebhookRequest req, CancellationToken ct = default)
    {
        await EnsureSchemaAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var current = await conn.QueryFirstOrDefaultAsync<WebhookRow>(new CommandDefinition(
            """
            SELECT id AS Id, name AS Name, target_url AS TargetUrl, secret AS Secret,
                   events AS Events, is_active AS IsActive, delivery_count AS DeliveryCount,
                   failure_count AS FailureCount, last_status_code AS LastStatusCode,
                   last_error AS LastError, last_triggered_at AS LastTriggeredAt, created_at AS CreatedAt
            FROM dbo.ext_api_webhooks WHERE id = @id
            """,
            new { id }, cancellationToken: ct));
        if (current is null) return null;

        var name = !string.IsNullOrWhiteSpace(req.Name) ? req.Name.Trim() : current.Name;
        var url = !string.IsNullOrWhiteSpace(req.TargetUrl) ? req.TargetUrl.Trim() : current.TargetUrl;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new InvalidOperationException("أدخل رابط HTTP أو HTTPS صالحاً");
        var eventsCsv = req.Events is not null
            ? string.Join(",", req.Events.Select(e => e.Trim()).Where(e => e.Length > 0).DefaultIfEmpty("*"))
            : current.Events;
        var secret = req.Secret is not null ? (string.IsNullOrWhiteSpace(req.Secret) ? null : req.Secret.Trim()) : current.Secret;
        var isActive = req.IsActive ?? current.IsActive;

        await conn.ExecuteAsync(new CommandDefinition(
            """
            UPDATE dbo.ext_api_webhooks
            SET name = @name, target_url = @url, secret = @secret, events = @eventsCsv, is_active = @isActive
            WHERE id = @id
            """,
            new { id, name, url, secret, eventsCsv, isActive }, cancellationToken: ct));
        cache.Remove(WebhooksCacheKey);
        current.Name = name;
        current.TargetUrl = url;
        current.Secret = secret;
        current.Events = eventsCsv;
        current.IsActive = isActive;
        return MapWebhook(current);
    }

    public async Task<bool> DeleteWebhookAsync(long id, CancellationToken ct = default)
    {
        await EnsureSchemaAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var affected = await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM dbo.ext_api_webhooks WHERE id = @id", new { id }, cancellationToken: ct));
        cache.Remove(WebhooksCacheKey);
        return affected > 0;
    }

    public async Task RecordWebhookDeliveryAsync(long id, bool ok, int? statusCode, string? error)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(CancellationToken.None);
            await conn.ExecuteAsync(
                """
                UPDATE dbo.ext_api_webhooks
                SET delivery_count = delivery_count + CASE WHEN @ok = 1 THEN 1 ELSE 0 END,
                    failure_count = failure_count + CASE WHEN @ok = 0 THEN 1 ELSE 0 END,
                    last_status_code = @statusCode,
                    last_error = @error,
                    last_triggered_at = GETDATE()
                WHERE id = @id
                """,
                new { id, ok = ok ? 1 : 0, statusCode, error = error is { Length: > 480 } ? error[..480] : error });
        }
        catch
        {
            /* non-blocking */
        }
    }

    // ── Smart Cart Pricing Engine ────────────────────────────────────────────

    public async Task<CartQuoteResponse> QuoteCartAsync(
        CartQuoteRequest req,
        StoreCatalogRepository catalog,
        DiscountQrRepository qrRepo,
        CancellationToken ct = default)
    {
        var items = req.Items ?? [];
        var lines = new List<CartQuoteLineDto>();
        var unresolved = new List<string>();

        foreach (var item in items.Take(100))
        {
            var qty = item.Quantity <= 0 ? 1m : item.Quantity;
            StoreProductDto? product = null;
            if (item.ProductId is > 0)
                product = await catalog.GetByIdAsync(item.ProductId.Value, ct);
            if (product is null && !string.IsNullOrWhiteSpace(item.Code))
                product = await catalog.GetByCodeAsync(item.Code.Trim(), ct);

            if (product is null)
            {
                var label = !string.IsNullOrWhiteSpace(item.Code) ? item.Code.Trim() : $"#{item.ProductId}";
                unresolved.Add(label);
                continue;
            }

            var origTotal = Math.Round(product.ListPrice * qty, 0, MidpointRounding.AwayFromZero);
            var finalTotal = Math.Round(product.SalePrice * qty, 0, MidpointRounding.AwayFromZero);
            lines.Add(new CartQuoteLineDto(
                product.Id,
                product.Sku,
                product.Barcode,
                product.Name,
                qty,
                product.Quantity,
                product.InStock,
                product.ListPrice,
                product.SalePrice,
                origTotal,
                finalTotal,
                Math.Max(0, origTotal - finalTotal),
                product.OfferName));
        }

        var subtotalOrig = lines.Sum(l => l.OriginalLineTotal);
        var subtotalAfterOffers = lines.Sum(l => l.FinalLineTotal);
        var offerSavings = Math.Max(0, subtotalOrig - subtotalAfterOffers);

        var qrValid = false;
        string? qrHolder = null;
        if (!string.IsNullOrWhiteSpace(req.DiscountQrCode))
        {
            var person = await qrRepo.FindByCodeAsync(req.DiscountQrCode.Trim(), ct);
            if (person is not null && person.Active)
            {
                qrValid = true;
                qrHolder = person.Name;
            }
        }

        var extraPct = Math.Clamp(req.ManualDiscountPercent ?? 0m, 0m, 100m);
        var extraDiscount = extraPct > 0
            ? Math.Round(subtotalAfterOffers * (extraPct / 100m), 0, MidpointRounding.AwayFromZero)
            : 0m;
        var grandTotal = Math.Max(0, subtotalAfterOffers - extraDiscount);

        return new CartQuoteResponse(
            "IQD",
            DateTime.UtcNow,
            lines,
            unresolved,
            subtotalOrig,
            subtotalAfterOffers,
            offerSavings,
            qrValid,
            qrHolder,
            extraPct,
            extraDiscount,
            grandTotal);
    }

    private static string HashKey(string plain)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(plain));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static IReadOnlyList<string> NormalizeScopes(IReadOnlyList<string>? scopes)
    {
        if (scopes is null || scopes.Count == 0) return ["*"];
        var cleaned = scopes
            .Select(s => s.Trim().ToLowerInvariant())
            .Where(s => s.Length > 0)
            .Distinct()
            .ToList();
        return cleaned.Count == 0 || cleaned.Contains("*") ? ["*"] : cleaned;
    }

    private static IReadOnlyList<string> SplitCsv(string? raw) =>
        string.IsNullOrWhiteSpace(raw)
            ? ["*"]
            : raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static ApiKeyDto MapKey(KeyRow r) => new(
        r.Id,
        r.Name,
        r.KeyPrefix,
        SplitCsv(r.Scopes),
        r.RoleName,
        r.Notes,
        r.IsActive,
        r.RequestCount,
        r.LastUsedAt,
        r.LastUsedIp,
        r.ExpiresAt,
        r.CreatedAt);

    private static ApiWebhookDto MapWebhook(WebhookRow r) => new(
        r.Id,
        r.Name,
        r.TargetUrl,
        !string.IsNullOrWhiteSpace(r.Secret),
        SplitCsv(r.Events),
        r.IsActive,
        r.DeliveryCount,
        r.FailureCount,
        r.LastStatusCode,
        r.LastError,
        r.LastTriggeredAt,
        r.CreatedAt);
}
