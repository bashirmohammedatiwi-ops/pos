using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.IdentityModel.Tokens;

namespace FOT.Pos.Api.Auth;

public static class JwtTokenIssuer
{
    public static string Issue(IConfiguration config, long id, string username, string displayName, string role)
    {
        var idText = id.ToString();
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, idText),
            new Claim(ClaimTypes.NameIdentifier, idText),
            new Claim(ClaimTypes.Name, username),
            new Claim(ClaimTypes.Role, role),
            new Claim("role", role),
            new Claim("display_name", displayName)
        };
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var hours = ExpiresHours(config, role);
        var now = DateTime.UtcNow;
        var token = new JwtSecurityToken(
            issuer: config["Jwt:Issuer"],
            audience: config["Jwt:Audience"],
            claims: claims,
            notBefore: now.AddMinutes(-2),
            expires: now.AddHours(hours),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public static ClaimsPrincipal? Read(IConfiguration config, string? token, bool ignoreLifetime = false)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var key = config["Jwt:Key"];
        if (string.IsNullOrWhiteSpace(key)) return null;
        var handler = new JwtSecurityTokenHandler();
        try
        {
            return handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = config["Jwt:Issuer"],
                ValidateAudience = true,
                ValidAudience = config["Jwt:Audience"],
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                ValidateLifetime = !ignoreLifetime,
                ClockSkew = TimeSpan.FromMinutes(15),
                RoleClaimType = ClaimTypes.Role,
                NameClaimType = ClaimTypes.Name
            }, out _);
        }
        catch
        {
            return null;
        }
    }

    public static string? Bearer(HttpRequest request)
    {
        var header = request.Headers.Authorization.ToString();
        return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? header["Bearer ".Length..].Trim()
            : null;
    }

    private static int ExpiresHours(IConfiguration config, string role)
    {
        if (role is "manager" or "seller")
            return int.Parse(config["Jwt:PortalExpiresHours"] ?? "87600");
        return int.Parse(config["Jwt:ExpiresHours"] ?? "24");
    }
}
