using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using FOT.Pos.Admin.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Admin;

public partial class EdariTreePickerDialog : Window
{
    private long? _parent;
    private readonly Stack<long?> _history = new();
    private bool _preferLocal;
    private readonly List<string> _pathSegments = [];

    public bool SelectFolderOnly { get; set; }

    public EdariTreeNodeDto? SelectedNode { get; private set; }

    private bool _usingEdari;

    public EdariTreePickerDialog()
    {
        InitializeComponent();
        Loaded += async (_, _) => await LoadAsync();
    }

    private async Task LoadAsync(string? search = null)
    {
        BackBtn.IsEnabled = _history.Count > 0;
        UpdateBreadcrumb();

        List<TreeNodeView> nodes = [];
        var isSearch = !string.IsNullOrWhiteSpace(search);

        if (isSearch)
        {
            var edari = await AppServices.Api.GetEdariMaterialTreeAsync(null, search);
            if (edari is { Count: > 0 })
            {
                SetSourceBadge("Edari — نتائج البحث", true);
                _usingEdari = true;
                nodes = edari.Select(TreeNodeView.FromEdari).ToList();
            }
            else
            {
                var local = await AppServices.Api.GetArticleTreeAsync(null, search);
                SetSourceBadge("محلي — نتائج البحث", false);
                _usingEdari = false;
                nodes = local?.Select(TreeNodeView.FromArticle).ToList() ?? [];
            }
        }
        else if (!_preferLocal)
        {
            var edari = await AppServices.Api.GetEdariMaterialTreeAsync(_parent, null);
            if (edari is not null)
            {
                SetSourceBadge("Edari NX — شجرة الإداري", true);
                _usingEdari = true;
                nodes = edari.Select(TreeNodeView.FromEdari).ToList();
                if (nodes.Count == 0 && _parent is null)
                    _preferLocal = true;
            }
            else _preferLocal = true;
        }

        if (!isSearch && (_preferLocal || nodes.Count == 0))
        {
            var local = await AppServices.Api.GetArticleTreeAsync(_parent, null);
            SetSourceBadge(_parent is null ? "قاعدة البيانات المحلية" : "محلي", false);
            _usingEdari = false;
            nodes = local?.Select(TreeNodeView.FromArticle).ToList() ?? [];
        }

        TreeList.ItemsSource = nodes;
        StatusText.Text = nodes.Count == 0
            ? "لا توجد عناصر — تحقق من Edari أو مزامنة المواد"
            : $"{nodes.Count:N0} عنصر في هذا المستوى";
        ClearPreview();
    }

    private void SetSourceBadge(string text, bool edari)
    {
        SourceLabel.Text = text;
    }

    private void UpdateBreadcrumb() =>
        BreadcrumbLabel.Text = _pathSegments.Count == 0
            ? "الجذر /"
            : "الجذر / " + string.Join(" / ", _pathSegments);

    private async void Search_Click(object sender, RoutedEventArgs e)
    {
        _parent = null;
        _history.Clear();
        _pathSegments.Clear();
        _preferLocal = false;
        await LoadAsync(string.IsNullOrWhiteSpace(SearchBox.Text) ? null : SearchBox.Text.Trim());
    }

    private void SearchBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) Search_Click(sender, e);
    }

    private async void Back_Click(object sender, RoutedEventArgs e)
    {
        if (_history.Count == 0) return;
        _parent = _history.Pop();
        if (_pathSegments.Count > 0) _pathSegments.RemoveAt(_pathSegments.Count - 1);
        await LoadAsync();
    }

    private async void TreeList_OnDoubleClick(object sender, MouseButtonEventArgs e) =>
        await NavigateOrSelectAsync();

    private async void TreeList_OnSelectionChanged(object sender, SelectionChangedEventArgs e) =>
        await UpdatePreviewAsync();

    private async Task NavigateOrSelectAsync()
    {
        if (TreeList.SelectedItem is not TreeNodeView node) return;

        if (node.IsFolder || node.HasChildren)
        {
            _history.Push(_parent);
            _pathSegments.Add(node.Name);
            _parent = node.Seq;
            SearchBox.Clear();
            await LoadAsync();
            return;
        }

        if (SelectFolderOnly)
        {
            MessageBox.Show("اختر مجلداً لتطبيق الخصم على جميع الأصناف تحته.", "مجلد مطلوب",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        SelectedNode = node.ToEdariDto();
        DialogResult = true;
    }

    private async Task UpdatePreviewAsync()
    {
        if (TreeList.SelectedItem is not TreeNodeView node || (!node.IsFolder && !node.HasChildren))
        {
            ClearPreview();
            return;
        }

        var count = await AppServices.Api.GetTreeProductCountAsync(node.Seq, _usingEdari);
        PreviewTitle.Text = node.Name;
        PreviewCount.Text = count.HasValue
            ? $"سيُطبَّق الخصم على {count.Value:N0} صنف نهائي تحت هذا المجلد"
            : "—";
        PreviewPanel.Visibility = Visibility.Visible;
    }

    private void ClearPreview() => PreviewPanel.Visibility = Visibility.Collapsed;

    private void Select_Click(object sender, RoutedEventArgs e)
    {
        if (TreeList.SelectedItem is not TreeNodeView node)
        {
            MessageBox.Show("اختر عنصراً من الشجرة");
            return;
        }

        if (SelectFolderOnly && !node.IsFolder && !node.HasChildren)
        {
            MessageBox.Show("اختر مجلداً (📁) وليس صنفاً مفرداً");
            return;
        }

        SelectedNode = node.ToEdariDto();
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    private sealed class TreeNodeView
    {
        public long Seq { get; init; }
        public string Name { get; init; } = "";
        public string? Num { get; init; }
        public string? Barcode { get; init; }
        public bool IsFolder { get; init; }
        public bool HasChildren { get; init; }
        public string KindShort => IsFolder || HasChildren ? "مج" : "ص";
        public string SubLabel => IsFolder
            ? $"Seq {Seq}" + (string.IsNullOrWhiteSpace(Num) ? "" : $" · {Num}")
            : Barcode ?? Num ?? "";
        public string KindLabel => IsFolder || HasChildren ? "مجلد" : "صنف";

        public EdariTreeNodeDto ToEdariDto() => new(Seq, null, Name, Num, Barcode, IsFolder, HasChildren);

        public static TreeNodeView FromEdari(EdariTreeNodeDto n) => new()
        {
            Seq = n.Seq, Name = n.Name ?? n.Num ?? $"#{n.Seq}", Num = n.Num, Barcode = n.Barcode,
            IsFolder = n.IsFolder, HasChildren = n.HasChildren
        };

        public static TreeNodeView FromArticle(ArticleTreeNodeDto n) => new()
        {
            Seq = n.Seq, Name = n.Name ?? n.Num ?? $"#{n.Seq}", Num = n.Num, Barcode = n.Barcode,
            IsFolder = n.IsFolder, HasChildren = n.HasChildren
        };
    }
}
