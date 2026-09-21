using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FOT.Pos.Client.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Client;

public partial class MaterialTreePickerWindow : Window
{
    private long? _parent;
    private readonly Stack<long?> _history = new();

    public ArticleTreeNodeDto? SelectedNode { get; private set; }

    public MaterialTreePickerWindow()
    {
        InitializeComponent();
        PosOverlay.Prepare(this);
        Loaded += async (_, _) => await LoadAsync();
    }

    private async Task LoadAsync(string? search = null)
    {
        BackBtn.IsEnabled = _history.Count > 0;
        var nodes = await AppServices.Api.GetArticleTreeAsync(_parent, search);
        TreeList.ItemsSource = nodes?.Select(NodeDisplay.From).ToList();
    }

    private async void Search_Click(object sender, RoutedEventArgs e) => await SearchAsync();

    private async void SearchBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) await SearchAsync();
    }

    private async Task SearchAsync()
    {
        _parent = null;
        _history.Clear();
        await LoadAsync(string.IsNullOrWhiteSpace(SearchBox.Text) ? null : SearchBox.Text.Trim());
    }

    private async void Back_Click(object sender, RoutedEventArgs e)
    {
        if (_history.Count == 0) return;
        _parent = _history.Pop();
        await LoadAsync();
    }

    private async void TreeList_OnDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (TreeList.SelectedItem is not NodeDisplay node) return;
        if (node.Source.IsFolder || node.Source.HasChildren)
        {
            _history.Push(_parent);
            _parent = node.Source.Seq;
            await LoadAsync();
            return;
        }
        SelectedNode = node.Source;
        DialogResult = true;
    }

    private void Select_Click(object sender, RoutedEventArgs e)
    {
        if (TreeList.SelectedItem is not NodeDisplay node) return;
        if (!node.Source.IsFolder && !node.Source.HasChildren) return;
        SelectedNode = node.Source;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => PosOverlay.CloseQuietly(this);

    private sealed class NodeDisplay
    {
        public ArticleTreeNodeDto Source { get; }
        public string Name => Source.Name ?? Source.Num ?? $"#{Source.Seq}";
        public string Icon => Source.IsFolder ? "📁" : "📦";
        public string SubLabel => Source.IsFolder ? $"مجلد · Seq {Source.Seq}" : Source.Barcode ?? "";

        private NodeDisplay(ArticleTreeNodeDto s) => Source = s;
        public static NodeDisplay From(ArticleTreeNodeDto n) => new(n);
    }
}
