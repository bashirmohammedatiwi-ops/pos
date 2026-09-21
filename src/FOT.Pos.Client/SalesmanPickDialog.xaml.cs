using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client;

public partial class SalesmanPickDialog : Window
{
    private readonly ObservableCollection<SalesmanDto> _all = [];
    public SalesmanDto? SelectedSalesman { get; private set; }

    public SalesmanPickDialog(IEnumerable<SalesmanDto> salesmen, string? productName, string? reason)
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        foreach (var s in salesmen) _all.Add(s);
        SalesmanList.ItemsSource = _all;
        ProductLabel.Text = string.IsNullOrWhiteSpace(productName) ? "المنتج" : productName;
        ReasonLabel.Text = string.IsNullOrWhiteSpace(reason) ? "حدد المندوب المسؤول عن هذا الصنف" : reason;
        Loaded += (_, _) =>
        {
            SearchBox.Focus();
            SearchBox.SelectAll();
        };
    }

    private void SearchBox_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        var term = SearchBox.Text.Trim();
        SalesmanList.ItemsSource = string.IsNullOrEmpty(term)
            ? _all
            : _all.Where(s =>
                s.Id.ToString().StartsWith(term, StringComparison.Ordinal) ||
                s.Name.Contains(term, StringComparison.OrdinalIgnoreCase)).ToList();
    }

    private void SearchBox_OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        TryConfirmByNumber();
    }

    private void TryConfirmByNumber()
    {
        var term = SearchBox.Text.Trim();
        if (string.IsNullOrEmpty(term)) return;

        if (!long.TryParse(term, out var id))
        {
            ClearQuickEntry();
            return;
        }

        var match = _all.FirstOrDefault(s => s.Id == id);
        if (match is null)
        {
            ClearQuickEntry();
            return;
        }

        Confirm(match);
    }

    private void ClearQuickEntry()
    {
        SearchBox.Text = "";
        SalesmanList.ItemsSource = _all;
        SalesmanList.SelectedItem = null;
        SelectedSalesman = null;
        SearchBox.Focus();
        SearchBox.SelectAll();
    }

    private void SalesmanList_OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (SalesmanList.SelectedItem is SalesmanDto s)
            SelectedSalesman = s;
    }

    private void SalesmanList_OnMouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (SalesmanList.SelectedItem is SalesmanDto s)
            Confirm(s);
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedSalesman is null)
        {
            MessageBox.Show("اختر مندوباً أو اكتب رقمه ثم Enter", "نقطة البيع", MessageBoxButton.OK, MessageBoxImage.Warning);
            SearchBox.Focus();
            return;
        }
        Confirm(SelectedSalesman);
    }

    private void Confirm(SalesmanDto? salesman)
    {
        if (salesman is null) return;
        SelectedSalesman = salesman;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);
}
