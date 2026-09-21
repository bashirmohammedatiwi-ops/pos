using System.Windows;

using System.Windows.Controls;

using System.Windows.Media;

using FOT.Pos.Admin.Navigation;



namespace FOT.Pos.Admin.Controls;



public partial class SidebarNav : UserControl

{

    private readonly Dictionary<string, NavLinkVisual> _links = new();

    private string? _activeKey;



    public event EventHandler<string>? PageSelected;



    public SidebarNav()

    {

        InitializeComponent();

        Loaded += (_, _) => BuildNav();

    }



    private void BuildNav()

    {

        RootPanel.Children.Clear();

        _links.Clear();



        foreach (var group in AppNavigation.Groups)

        {

            if (group.Key == "home")

            {

                foreach (var page in group.Pages)

                    RootPanel.Children.Add(CreateNavButton(page, featured: true));

                continue;

            }



            RootPanel.Children.Add(CreateGroupHeader(group));



            var itemsPanel = new StackPanel { Margin = new Thickness(0, 0, 0, 4) };

            foreach (var page in group.Pages)

                itemsPanel.Children.Add(CreateNavButton(page, featured: false));



            RootPanel.Children.Add(itemsPanel);

        }

    }



    private Border CreateGroupHeader(NavGroup group)

    {

        var header = new Border { Style = (Style)FindResource("SidebarGroupHeader") };

        var row = new Grid();

        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });



        if (!string.IsNullOrEmpty(group.Icon))

        {

            var icon = new TextBlock

            {

                Text = group.Icon,

                Style = (Style)FindResource("SidebarMdl2Icon"),

                Foreground = new SolidColorBrush(Color.FromRgb(0x47, 0x55, 0x69)),

                Margin = new Thickness(0, 0, 8, 0),

                VerticalAlignment = VerticalAlignment.Center

            };

            Grid.SetColumn(icon, 0);

            row.Children.Add(icon);

        }



        var title = new TextBlock

        {

            Text = group.Title.ToUpperInvariant(),

            Style = (Style)FindResource("SidebarGroupHeaderText"),

            VerticalAlignment = VerticalAlignment.Center

        };

        Grid.SetColumn(title, 1);

        row.Children.Add(title);



        header.Child = row;

        return header;

    }



    private Button CreateNavButton(NavPage page, bool featured)

    {

        var visual = CreateLinkContent(page);

        var btn = new Button

        {

            Tag = page.Key,

            Content = visual.Root,

            Style = (Style)FindResource(featured ? "SidebarFeaturedItem" : "SidebarNavItem"),

            HorizontalContentAlignment = HorizontalAlignment.Stretch

        };

        btn.Click += NavButton_Click;



        _links[page.Key] = visual with { Button = btn, Featured = featured };

        ApplyVisualState(page.Key, page.Key == _activeKey);

        return btn;

    }



    private NavLinkVisual CreateLinkContent(NavPage page)

    {

        var iconHost = new Border

        {

            Width = 34,

            Height = 34,

            CornerRadius = new CornerRadius(9),

            Background = new SolidColorBrush(Color.FromRgb(0x11, 0x18, 0x27)),

            Margin = new Thickness(0, 0, 10, 0)

        };



        var icon = new TextBlock

        {

            Text = page.Icon,

            Style = (Style)FindResource("SidebarMdl2Icon"),

            Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8))

        };

        iconHost.Child = icon;



        var title = new TextBlock

        {

            Text = page.Title,

            FontSize = 13,

            FontWeight = FontWeights.Medium,

            Foreground = new SolidColorBrush(Color.FromRgb(0xCB, 0xD5, 0xE1))

        };



        var subtitle = new TextBlock

        {

            Text = page.Subtitle,

            FontSize = 10,

            Foreground = new SolidColorBrush(Color.FromRgb(0x64, 0x74, 0x8B)),

            Margin = new Thickness(0, 2, 0, 0),

            TextTrimming = TextTrimming.CharacterEllipsis

        };



        var texts = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

        texts.Children.Add(title);

        if (!string.IsNullOrWhiteSpace(page.Subtitle))

            texts.Children.Add(subtitle);



        var root = new Grid();

        root.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        Grid.SetColumn(iconHost, 0);

        Grid.SetColumn(texts, 1);

        root.Children.Add(iconHost);

        root.Children.Add(texts);



        return new NavLinkVisual(null!, iconHost, icon, title, subtitle, root, false);

    }



    private void NavButton_Click(object sender, RoutedEventArgs e)

    {

        if (sender is Button { Tag: string key })

            PageSelected?.Invoke(this, key);

    }



    public void SetActive(string key)

    {

        _activeKey = key;

        foreach (var linkKey in _links.Keys)

            ApplyVisualState(linkKey, linkKey == key);

    }



    private void ApplyVisualState(string key, bool active)

    {

        if (!_links.TryGetValue(key, out var link))

            return;



        link.Button.Style = (Style)FindResource(active

            ? link.Featured ? "SidebarFeaturedItemActive" : "SidebarNavItemActive"

            : link.Featured ? "SidebarFeaturedItem" : "SidebarNavItem");



        var titleColor = active ? Colors.White : Color.FromRgb(0xCB, 0xD5, 0xE1);

        var subtitleColor = active ? Color.FromRgb(0xBF, 0xDB, 0xFE) : Color.FromRgb(0x64, 0x74, 0x8B);

        var iconFg = active ? Colors.White : Color.FromRgb(0x94, 0xA3, 0xB8);

        var iconBg = active ? Color.FromArgb(0x55, 0xFF, 0xFF, 0xFF) : Color.FromRgb(0x11, 0x18, 0x27);



        link.Title.Foreground = new SolidColorBrush(titleColor);

        link.Subtitle.Foreground = new SolidColorBrush(subtitleColor);

        link.Icon.Foreground = new SolidColorBrush(iconFg);

        link.IconHost.Background = new SolidColorBrush(iconBg);

        link.Title.FontWeight = active ? FontWeights.SemiBold : FontWeights.Medium;

    }



    private sealed record NavLinkVisual(

        Button Button,

        Border IconHost,

        TextBlock Icon,

        TextBlock Title,

        TextBlock Subtitle,

        Grid Root,

        bool Featured);

}

