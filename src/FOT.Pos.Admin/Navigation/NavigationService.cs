namespace FOT.Pos.Admin.Navigation;

public static class NavigationService
{
    public static event Action<string>? Navigate;

    public static void GoTo(string key) => Navigate?.Invoke(key);
}
