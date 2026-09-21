using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace FOT.Pos.Client.Models;

public sealed class CartTabItem : INotifyPropertyChanged
{
    private string _label = "1";
    private int _itemCount;
    private bool _isActive;

    public int Id { get; init; }

    public string Label
    {
        get => _label;
        set { _label = value; OnChanged(); }
    }

    public int ItemCount
    {
        get => _itemCount;
        set { _itemCount = value; OnChanged(); OnChanged(nameof(BadgeText)); }
    }

    public bool IsActive
    {
        get => _isActive;
        set { _isActive = value; OnChanged(); }
    }

    public string BadgeText => ItemCount > 0 ? $"{ItemCount}" : "";

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
