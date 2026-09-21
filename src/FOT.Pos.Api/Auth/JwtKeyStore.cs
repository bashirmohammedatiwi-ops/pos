using System.Security.Cryptography;

namespace FOT.Pos.Api.Auth;

public static class JwtKeyStore
{
    public static string Resolve(IConfiguration config)
    {
        var configured = config["Jwt:Key"] ?? "";
        var placeholder = string.IsNullOrWhiteSpace(configured)
            || configured.Contains("CHANGE-THIS", StringComparison.OrdinalIgnoreCase);

        foreach (var path in KeyPaths())
        {
            if (!placeholder || !File.Exists(path)) continue;
            try
            {
                var stored = File.ReadAllText(path).Trim();
                if (stored.Length >= 32)
                {
                    Persist(stored);
                    return stored;
                }
            }
            catch
            {
                /* try the next location */
            }
        }

        var key = placeholder ? Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)) : configured;
        Persist(key);
        return key;
    }

    private static IEnumerable<string> KeyPaths()
    {
        yield return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FOT.Pos", "jwt.key");
        yield return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FOT.Pos", "jwt.key");
    }

    private static void Persist(string key)
    {
        foreach (var path in KeyPaths())
        {
            try
            {
                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(path, key);
            }
            catch
            {
                /* one writable location is enough */
            }
        }
    }
}
