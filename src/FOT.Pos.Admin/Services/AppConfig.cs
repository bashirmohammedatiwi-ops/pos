namespace FOT.Pos.Admin.Services;

public static class AppConfig
{
    public const string RoleServer = "Server";
    public const string RoleRemote = "Remote";

    public static string DeploymentRole { get; private set; } = RoleServer;
    public static bool IsServer => DeploymentRole == RoleServer;
    public static bool IsRemote => DeploymentRole == RoleRemote;
    public static int ApiPort { get; private set; } = 5000;

    public static void Initialize(string role, int apiPort = 5000)
    {
        DeploymentRole = string.Equals(role, RoleRemote, StringComparison.OrdinalIgnoreCase)
            ? RoleRemote
            : RoleServer;
        ApiPort = apiPort;
    }
}
