using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace FOT.Pos.Client.Models;

public sealed class CartGroup : INotifyPropertyChanged
{
    private bool _isActive;
    private long? _defaultSalesmanId;
    private string? _defaultSalesmanName;

    public int Key { get; init; }

    public bool IsActive
    {
        get => _isActive;
        set { if (_isActive == value) return; _isActive = value; OnChanged(); }
    }

    public long? DefaultSalesmanId
    {
        get => _defaultSalesmanId;
        set { if (_defaultSalesmanId == value) return; _defaultSalesmanId = value; OnChanged(nameof(DisplayLabel)); }
    }

    public string? DefaultSalesmanName
    {
        get => _defaultSalesmanName;
        set { if (_defaultSalesmanName == value) return; _defaultSalesmanName = value; OnChanged(nameof(DisplayLabel)); }
    }

    public string Label => $"مجموعة {Key}";
    public string DisplayLabel => DefaultSalesmanId is > 0 && !string.IsNullOrWhiteSpace(DefaultSalesmanName)
        ? $"{Label} · {DefaultSalesmanName}"
        : Label;

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
