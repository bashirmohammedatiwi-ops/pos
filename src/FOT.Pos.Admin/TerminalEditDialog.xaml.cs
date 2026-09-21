using System.Windows;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin;

public partial class TerminalEditDialog : Window
{
    private readonly long? _editId;

    public RegisterTerminalRequest? CreateResult { get; private set; }
    public UpdateTerminalRequest? UpdateResult { get; private set; }
    public UpdateTerminalRequest? CreateExtras { get; private set; }

    public TerminalEditDialog(PosTerminalDetailDto? existing = null)
    {
        InitializeComponent();

        if (existing is null)
        {
            Title = "إضافة جهاز";
            TitleLabel.Text = "إضافة جهاز";
            SubtitleLabel.Text = "تسجيل جهاز POS — القسم من الكاشير";
            HwIdBox.Text = $"POS-{Guid.NewGuid():N}"[..16].ToUpperInvariant();
            ActiveBox.IsChecked = true;
        }
        else
        {
            _editId = existing.Id;
            Title = $"تعديل — {existing.Name}";
            TitleLabel.Text = "تعديل الجهاز";
            SubtitleLabel.Text = existing.HwId ?? "—";
            NameBox.Text = existing.Name ?? "";
            HwIdBox.Text = existing.HwId ?? "";
            HwIdBox.IsReadOnly = true;
            RemarksBox.Text = existing.Remarks ?? "";
            VfdLine1Box.Text = existing.VfdFirstLine ?? "";
            VfdLine2Box.Text = existing.VfdSecondLine ?? "";
            ActiveBox.IsChecked = existing.Active;
            OfflineBox.IsChecked = existing.AllowOfflineMode;
            MposServiceBox.Text = existing.MposService ?? "";
            MposComPortBox.Text = existing.MposComPort ?? "";
        }
    }

    public bool IsEdit => _editId.HasValue;

    private UpdateTerminalRequest BuildUpdateRequest() =>
        new(
            NameBox.Text.Trim(),
            null,
            ActiveBox.IsChecked == true,
            OfflineBox.IsChecked == true,
            RemarksBox.Text.Trim(),
            VfdLine1Box.Text.Trim(),
            VfdLine2Box.Text.Trim(),
            null, null,
            MposServiceBox.Text.Trim(),
            MposComPortBox.Text.Trim());

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(NameBox.Text))
        {
            MessageBox.Show("أدخل اسم الجهاز");
            return;
        }

        if (string.IsNullOrWhiteSpace(HwIdBox.Text))
        {
            MessageBox.Show("أدخل معرف الجهاز");
            return;
        }

        if (!IsEdit)
        {
            CreateResult = new RegisterTerminalRequest(HwIdBox.Text.Trim(), NameBox.Text.Trim());
            CreateExtras = BuildUpdateRequest();
        }
        else
        {
            UpdateResult = BuildUpdateRequest();
        }

        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
