using System.Collections;
using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace FOT.Pos.Client.Controls;

public partial class SearchableComboBox : UserControl
{
    private IList? _source;
    private bool _suppressSearch;
    private bool _suppressSelection;

    public static readonly DependencyProperty ItemsSourceProperty =
        DependencyProperty.Register(nameof(ItemsSource), typeof(IEnumerable), typeof(SearchableComboBox),
            new PropertyMetadata(null, OnItemsSourceChanged));

    public static readonly DependencyProperty SelectedItemProperty =
        DependencyProperty.Register(nameof(SelectedItem), typeof(object), typeof(SearchableComboBox),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.BindsTwoWayByDefault, OnSelectedItemChanged));

    public static readonly DependencyProperty DisplayMemberPathProperty =
        DependencyProperty.Register(nameof(DisplayMemberPath), typeof(string), typeof(SearchableComboBox),
            new PropertyMetadata("Name", OnDisplayPathChanged));

    public static readonly DependencyProperty PlaceholderProperty =
        DependencyProperty.Register(nameof(Placeholder), typeof(string), typeof(SearchableComboBox),
            new PropertyMetadata("اختر…"));

    public static readonly DependencyProperty IsLightThemeProperty =
        DependencyProperty.Register(nameof(IsLightTheme), typeof(bool), typeof(SearchableComboBox),
            new PropertyMetadata(false, OnThemeChanged));

    public event EventHandler? SelectionChanged;

    public SearchableComboBox()
    {
        InitializeComponent();
        Loaded += (_, _) =>
        {
            ApplyTheme();
            UpdateDisplay();
            ItemsList.DisplayMemberPath = DisplayMemberPath;
        };
    }

    public IEnumerable? ItemsSource
    {
        get => (IEnumerable?)GetValue(ItemsSourceProperty);
        set => SetValue(ItemsSourceProperty, value);
    }

    public object? SelectedItem
    {
        get => GetValue(SelectedItemProperty);
        set => SetValue(SelectedItemProperty, value);
    }

    public string DisplayMemberPath
    {
        get => (string)GetValue(DisplayMemberPathProperty);
        set => SetValue(DisplayMemberPathProperty, value);
    }

    public string Placeholder
    {
        get => (string)GetValue(PlaceholderProperty);
        set => SetValue(PlaceholderProperty, value);
    }

    public bool IsLightTheme
    {
        get => (bool)GetValue(IsLightThemeProperty);
        set => SetValue(IsLightThemeProperty, value);
    }

    private static void OnThemeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is SearchableComboBox c) c.ApplyTheme();
    }

    private static void OnDisplayPathChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is SearchableComboBox c)
        {
            c.ItemsList.DisplayMemberPath = c.DisplayMemberPath;
            c.UpdateDisplay();
        }
    }

    private void ApplyTheme()
    {
        var fg = IsLightTheme ? "#F8FAFC" : "#0C1222";
        var ph = IsLightTheme ? "#94A3B8" : "#94A3B8";
        DisplayText.Foreground = Brush(fg);
        PlaceholderText.Foreground = Brush(ph);
    }

    private static System.Windows.Media.SolidColorBrush Brush(string hex) =>
        new((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex)!);

    private static void OnItemsSourceChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is SearchableComboBox c) c.RebuildSource();
    }

    private static void OnSelectedItemChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is SearchableComboBox c) c.UpdateDisplay();
    }

    private void RebuildSource()
    {
        _source = ItemsSource?.Cast<object>().ToList();
        UpdateDisplay();
    }

    private void UpdateDisplay()
    {
        var text = GetDisplay(SelectedItem);
        DisplayText.Text = text;
        PlaceholderText.Visibility = string.IsNullOrEmpty(text) ? Visibility.Visible : Visibility.Collapsed;
        DisplayText.Visibility = string.IsNullOrEmpty(text) ? Visibility.Collapsed : Visibility.Visible;
    }

    private string GetDisplay(object? item)
    {
        if (item is null) return "";
        var path = DisplayMemberPath;
        if (string.IsNullOrEmpty(path)) return item.ToString() ?? "";
        var prop = TypeDescriptor.GetProperties(item).Find(path, false);
        return prop?.GetValue(item)?.ToString() ?? item.ToString() ?? "";
    }

    private void FieldBorder_OnClick(object sender, MouseButtonEventArgs e)
    {
        PopupCard.MinWidth = Math.Max(240, ActualWidth);
        DropPopup.PlacementTarget = FieldBorder;
        DropPopup.IsOpen = true;
        _suppressSearch = true;
        SearchBox.Text = "";
        _suppressSearch = false;
        ApplyFilter("");
        Dispatcher.BeginInvoke(() =>
        {
            SearchBox.Focus();
            SearchBox.SelectAll();
        });
    }

    private void SearchBox_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressSearch) return;
        ApplyFilter(SearchBox.Text);
    }

    private void SearchBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key is Key.Enter or Key.Return)
        {
            e.Handled = true;
            if (ItemsList.SelectedItem is not null)
                Commit(ItemsList.SelectedItem);
            else if (ItemsList.Items.Count == 1)
                Commit(ItemsList.Items[0]);
            return;
        }
        if (e.Key == Key.Escape)
        {
            DropPopup.IsOpen = false;
            e.Handled = true;
            return;
        }
        if (e.Key == Key.Down && ItemsList.Items.Count > 0)
        {
            ItemsList.Focus();
            if (ItemsList.SelectedIndex < 0) ItemsList.SelectedIndex = 0;
            e.Handled = true;
        }
    }

    private void ItemsList_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key is Key.Enter or Key.Return)
        {
            e.Handled = true;
            if (ItemsList.SelectedItem is not null)
                Commit(ItemsList.SelectedItem);
        }
    }

    private void ApplyFilter(string term)
    {
        _suppressSelection = true;
        try
        {
            ItemsList.Items.Clear();
            if (_source is null) return;
            var q = term.Trim();
            object? highlight = null;
            foreach (var item in _source)
            {
                if (string.IsNullOrEmpty(q) || GetDisplay(item).Contains(q, StringComparison.OrdinalIgnoreCase))
                {
                    ItemsList.Items.Add(item);
                    if (Equals(item, SelectedItem))
                        highlight = item;
                }
            }
            ItemsList.SelectedItem = highlight ?? (ItemsList.Items.Count > 0 ? ItemsList.Items[0] : null);
        }
        finally
        {
            _suppressSelection = false;
        }
    }

    private void ItemsList_OnPreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (_suppressSelection) return;
        if (ItemsList.SelectedItem is null) return;
        Commit(ItemsList.SelectedItem);
        e.Handled = true;
    }

    private void Commit(object item)
    {
        SelectedItem = item;
        DropPopup.IsOpen = false;
        UpdateDisplay();
        SelectionChanged?.Invoke(this, EventArgs.Empty);
    }
}
