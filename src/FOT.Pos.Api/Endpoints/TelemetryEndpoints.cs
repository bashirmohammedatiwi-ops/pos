using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Api.Endpoints;

public static class TelemetryEndpoints
{
    public static void MapTelemetryEndpoints(this RouteGroupBuilder api)
    {
        // Batched client error intake — fire-and-forget into a bounded channel; never blocks the caller.
        api.MapPost("/telemetry/errors", (ClientErrorBatchDto batch, HttpContext http, ClientErrorRepository repo) =>
        {
            var source = DetectSource(http);
            var accepted = 0;
            foreach (var error in batch.Errors.Take(20))
            {
                if (string.IsNullOrWhiteSpace(error.Message)) continue;
                if (repo.Enqueue(error, source)) accepted++;
            }
            return Results.Ok(new { accepted });
        });

        api.MapGet("/telemetry/errors", async (ClientErrorRepository repo, int limit = 50, string? source = null) =>
            await repo.RecentAsync(Math.Clamp(limit, 1, 200), source, default));

        api.MapDelete("/telemetry/errors", async (ClientErrorRepository repo, int days = 14) =>
        {
            var purged = await repo.PurgeOlderThanAsync(Math.Clamp(days, 1, 365), default);
            return Results.Ok(new { purged });
        });
    }

    private static string DetectSource(HttpContext http)
    {
        // Clients tag themselves explicitly; the header is trusted because both apps share the JWT.
        if (http.Request.Headers.TryGetValue("X-FOT-Source", out var explicitSource))
        {
            var s = explicitSource.ToString();
            if (s is "admin" or "pos") return s;
        }
        return "admin";
    }
}
