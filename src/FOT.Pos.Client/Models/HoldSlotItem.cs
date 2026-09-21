using System.ComponentModel;
using System.Runtime.CompilerServices;
using FOT.Pos.Shared;

namespace FOT.Pos.Client.Models;

public sealed class HoldSlotItem : INotifyPropertyChanged
{
    private bool _isActive;
    private bool _hasItems;
    private string _amountDisplay = "—";
    private string _subtitle = "فارغ";
    private string _statusLabel = "فارغ";
    private string _tooltip = "";

    public int SlotNumber { get; private set; }
    public string Title => SlotNumber.ToString();

    public bool IsActive
    {
        get => _isActive;
        private set { _isActive = value; OnChanged(); OnChanged(nameof(IsParked)); }
    }

    public bool HasItems
    {
        get => _hasItems;
        private set { _hasItems = value; OnChanged(); OnChanged(nameof(IsEmpty)); OnChanged(nameof(IsParked)); }
    }

    public bool IsEmpty => !HasItems;
    public bool IsParked => HasItems && !IsActive;

    public string AmountDisplay
    {
        get => _amountDisplay;
        private set { _amountDisplay = value; OnChanged(); }
    }

    public string Subtitle
    {
        get => _subtitle;
        private set { _subtitle = value; OnChanged(); }
    }

    public string StatusLabel
    {
        get => _statusLabel;
        private set { _statusLabel = value; OnChanged(); }
    }

    public string Tooltip
    {
        get => _tooltip;
        private set { _tooltip = value; OnChanged(); }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public void Update(InvoiceSlotState state, bool isActive, int slotNumber, decimal discountAmount)
    {
        SlotNumber = slotNumber;
        IsActive = isActive;
        HasItems = state.HasItems;

        if (!state.HasItems)
        {
            AmountDisplay = "—";
            Subtitle = "فارغ";
            StatusLabel = isActive ? "نشطة" : "فارغ";
            Tooltip = isActive
                ? $"فاتورة {slotNumber} — نشطة وفارغة"
                : $"فاتورة {slotNumber} — فارغة · اضغط للتبديل";
            return;
        }

        var total = Math.Max(0, state.Subtotal - discountAmount);
        AmountDisplay = MoneyFormat.FormatCurrency(total);
        Subtitle = $"{state.ItemCount} صنف";

        if (isActive)
        {
            StatusLabel = "نشطة";
            Tooltip = $"فاتورة {slotNumber} — تعمل عليها الآن · {state.ItemCount} صنف";
        }
        else
        {
            StatusLabel = "معلّقة";
            Tooltip = $"فاتورة {slotNumber} — معلّقة · اضغط للعودة";
        }
    }

    private void OnChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
