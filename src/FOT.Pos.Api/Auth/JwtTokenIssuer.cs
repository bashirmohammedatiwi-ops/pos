using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
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
        var hours = int.Parse(config["Jwt:ExpiresHours"] ?? "24");
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
}
