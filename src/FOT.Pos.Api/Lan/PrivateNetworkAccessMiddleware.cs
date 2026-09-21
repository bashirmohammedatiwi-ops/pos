namespace FOT.Pos.Api.Lan;

/// <summary>
/// Chromium Private / Local Network Access preflight from Electron file:// to LAN HTTP.
/// </summary>
public sealed class PrivateNetworkAccessMiddleware(RequestDelegate next)
{
    public Task Invoke(HttpContext ctx)
    {
        if (ctx.Request.Headers.ContainsKey("Access-Control-Request-Private-Network")
            || ctx.Request.Headers.ContainsKey("Access-Control-Request-Local-Network"))
        {
            ctx.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
            ctx.Response.Headers["Access-Control-Allow-Local-Network"] = "true";
        }

        return next(ctx);
    }
}
