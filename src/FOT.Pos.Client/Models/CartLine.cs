using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace FOT.Pos.Client.Models;

public sealed class CartLine : INotifyPropertyChanged
{
    private decimal _quantity;
    private decimal _price;
    private long _salesmanId;
    private string? _salesmanName;
    private int? _groupKey;
    private string? _groupLabel;

    public long ArticleId { get; init; }
    public string? Name { get; init; }
    public string? Barcode { get; init; }
    public decimal OriginalPrice { get; init; }

    public decimal Price
    {
        get => _price;
        set { if (_price == value) return; _price = value; NotifyLineChanged(); }
    }

    public decimal Quantity
    {
        get => _quantity;
        set { if (_quantity == value) return; _quantity = value; NotifyLineChanged(); }
    }

    public long SalesmanId
    {
        get => _salesmanId;
        set { if (_salesmanId == value) return; _salesmanId = value; NotifyAttributionChanged(); }
    }

    public string? SalesmanName
    {
        get => _salesmanName;
        set { if (_salesmanName == value) return; _salesmanName = value; NotifyAttributionChanged(); }
    }

    public int? GroupKey
    {
        get => _groupKey;
        set { if (_groupKey == value) return; _groupKey = value; NotifyAttributionChanged(); }
    }

    public string? GroupLabel
    {
        get => _groupLabel;
        set { if (_groupLabel == value) return; _groupLabel = value; NotifyAttributionChanged(); }
    }

    public decimal LineTotal => Quantity * Price;
    public bool HasLineDiscount => OriginalPrice > 0 && Price < OriginalPrice;
    public bool HasSalesman => SalesmanId > 0;
    public bool HasGroup => GroupKey is > 0;
    public string QuantityDisplay => Quantity.ToString("N0");
    public string PriceDisplay => Price.ToString("N0");
    public string LineTotalDisplay => LineTotal.ToString("N0");
    public string SalesmanDisplay => HasSalesman ? SalesmanName ?? $"#{SalesmanId}" : "—";
    public string GroupDisplay => HasGroup ? (GroupLabel ?? $"م{GroupKey}") : "";
    public string NameInitial => string.IsNullOrWhiteSpace(Name) ? "•" : Name.Trim()[0].ToString();

    public event PropertyChangedEventHandler? PropertyChanged;

    public void SetAttribution(long salesmanId, string? salesmanName, int? groupKey, string? groupLabel)
    {
        _salesmanId = salesmanId;
        _salesmanName = salesmanName;
        _groupKey = groupKey;
        _groupLabel = groupLabel;
        NotifyAttributionChanged();
    }

    private void NotifyLineChanged()
    {
        OnChanged();
        OnChanged(nameof(LineTotal));
        OnChanged(nameof(QuantityDisplay));
        OnChanged(nameof(LineTotalDisplay));
        OnChanged(nameof(PriceDisplay));
        OnChanged(nameof(HasLineDiscount));
    }

    private void NotifyAttributionChanged()
    {
        OnChanged(nameof(SalesmanId));
        OnChanged(nameof(SalesmanName));
        OnChanged(nameof(GroupKey));
        OnChanged(nameof(GroupLabel));
        OnChanged(nameof(HasSalesman));
        OnChanged(nameof(HasGroup));
        OnChanged(nameof(SalesmanDisplay));
        OnChanged(nameof(GroupDisplay));
    }

    private void OnChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
