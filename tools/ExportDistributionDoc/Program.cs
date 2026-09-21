using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using PIC = DocumentFormat.OpenXml.Drawing.Pictures;

const string logoPath = @"c:\Users\Future of Technology\Documents\pos\tools\output\deema-logo.jpg";
var outDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "pos", "tools", "output");
Directory.CreateDirectory(outDir);
var outPath = Path.Combine(outDir, "EVOLUDERM-Distribution-Plan.docx");
var desktopPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "EVOLUDERM-Distribution-Plan.docx");

var retailers = SortRetailers(BuildRetailers());
var phases = BuildPhases(retailers);
var regions = BuildRegions(retailers);

using (var doc = WordprocessingDocument.Create(outPath, WordprocessingDocumentType.Document))
{
    var main = doc.AddMainDocumentPart();
    main.Document = new Document(new Body());
    var body = main.Document.Body!;

    EnsureDocumentSettings(main);
    EnsureStyles(main);
    var firstHeaderId = AddFirstPageHeader(main);
    var runningHeaderId = AddRunningHeader(main);
    var firstFooterId = AddFirstPageFooter(main);
    var footerId = AddFooter(main);

    body.Append(LetterheadBlock(main, logoPath));
    body.Append(Spacer(30));
    body.Append(TitleBlock());
    body.Append(Spacer(30));
    body.Append(SummaryBox(retailers, phases));
    body.Append(Spacer(50));
    body.Append(IntroParagraph(retailers.Count));
    body.Append(Spacer(60));
    body.Append(SectionHeading("1. Distribution Overview"));
    body.Append(BodyPara(
        "Deema Al Hayat is rolling out EVOLUDERM across Iraq — pharmacies first, then cosmetics boutiques, grouped by geography for efficient logistics. " +
        "This document reflects our Sep–Oct 2026 rollout (15 Sep – 10 Oct); our partner network continues to grow month by month."));
    body.Append(Spacer(60));
    body.Append(SectionHeading("2. Rollout Schedule — September / October 2026"));
    body.Append(PhaseTable(phases));

    body.Append(PageBreak());
    body.Append(SectionHeading("3. Partner Network"));
    body.Append(BodyPara(
        $"{retailers.Count} outlets across {regions.Count} regions. Sorted by priority, delivery phase, and store name."));
    body.Append(Spacer(30));
    foreach (var region in regions)
    {
        body.Append(RegionHeadingParagraph(region.Name, region.PhaseLabel, region.Items.Count));
        body.Append(RegionRetailerTable(main, region));
        body.Append(Spacer(40));
    }

    body.Append(PageBreak());
    body.Append(SectionHeading("4. Operational Notes"));
    foreach (var note in OperationalNotes())
        body.Append(BulletPara(note));
    body.Append(Spacer(80));
    body.Append(ClosingBlock());
    body.Append(BuildSectionProperties(firstHeaderId, runningHeaderId, firstFooterId, footerId));
    main.Document.Save();
}

try { File.Copy(outPath, desktopPath, true); Console.WriteLine($"Desktop: {desktopPath}"); }
catch (IOException)
{
    var alt = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "EVOLUDERM-Distribution-Plan-v10.docx");
    File.Copy(outPath, alt, true);
    Console.WriteLine($"Desktop (alt): {alt}");
}
Console.WriteLine($"Created: {outPath}");

static List<Retailer> SortRetailers(List<Retailer> list) =>
    list.OrderBy(r => r.Phase)
        .ThenBy(r => RegionOrder(r.Region))
        .ThenBy(r => r.ChannelType == "Pharmacy" ? 0 : 1)
        .ThenBy(r => r.ListOrder)
        .ThenBy(r => r.City)
        .ThenBy(r => r.Name)
        .ToList();

static int RegionOrder(string region) => region switch
{
    "Baghdad — Pharmacies" => 1,
    "Baghdad — Cosmetics" => 2,
    "Northern Iraq" => 3,
    "Central Iraq" => 4,
    "Southern Iraq" => 5,
    _ => 9
};

static List<RegionGroup> BuildRegions(List<Retailer> retailers)
{
    var groups = new List<RegionGroup>();
    var index = 1;
    foreach (var g in retailers.GroupBy(r => r.Region).OrderBy(x => RegionOrder(x.Key)))
    {
        var items = g.OrderBy(r => r.ListOrder)
            .ThenBy(r => r.Phase)
            .ThenBy(r => r.ChannelType == "Pharmacy" ? 0 : 1)
            .ThenBy(r => r.Name)
            .ToList();
        var phaseLabel = items.Select(r => r.Phase).Distinct().Order().Select(p => $"P{p}").Aggregate((a, b) => $"{a}, {b}");
        groups.Add(new RegionGroup(g.Key, phaseLabel, items, index));
        index += items.Count;
    }
    return groups;
}

static List<Retailer> BuildRetailers() =>
[
    R("Masdar Al-Dawa Pharmacy", "Baghdad — Pharmacies", "Baghdad", "Baghdad", "Pharmacy", "Facebook", "https://www.facebook.com/share/19RkZWDDtZ/", 1),
    R("Ozone Pharmacy", "Baghdad — Pharmacies", "Baghdad", "Al-Harithiya", "Pharmacy", "Facebook", "https://www.facebook.com/share/1M49haFTUN/", 1),
    R("Basmat Alhayat Pharmacy", "Baghdad — Pharmacies", "Baghdad", "Baghdad", "Pharmacy", "Facebook", "https://www.facebook.com/share/19Wc9hj5Gp/", 1),
    R("Four Seasons Pharmacy", "Baghdad — Pharmacies", "Baghdad", "Al-Kindi Street, Al-Harithiya", "Pharmacy", "Facebook", "https://www.facebook.com/share/1FBFkVC13E/", 1),
    R("Al-Naqous Al-Fiddi Pharmacy", "Baghdad — Pharmacies", "Baghdad", "Baghdad", "Pharmacy", "Instagram", "https://www.instagram.com/alnaqous_group", 1),
    R("Tariq Al-Shams Pharmacy", "Baghdad — Pharmacies", "Baghdad", "Al-Harithiya", "Pharmacy", "Facebook", "https://www.facebook.com/share/14oUJ5aDhum/", 1),
    R("Tariq Al-Yusr Pharmacy", "Baghdad — Pharmacies", "Baghdad", "Awirij — near South Baghdad Arch", "Pharmacy", "Facebook", "https://www.facebook.com/share/1MNzx3HKo9/", 1),
    R("MRT MAB", "Baghdad — Cosmetics", "Baghdad", "Al-Bahou Street", "Cosmetics", "Instagram", "https://www.instagram.com/mrt_mab", 1),
    R("Deema Al Hayat Cosmetic", "Baghdad — Cosmetics", "Baghdad", "Baghdad", "Cosmetics", "Instagram", "https://www.instagram.com/alhayat_cosmatic", 2, listOrder: 1),
    R("Al-Shaheera Cosmetic", "Baghdad — Cosmetics", "Baghdad", "Baghdad", "Cosmetics", "Instagram", "https://www.instagram.com/alshaheera_official", 2, listOrder: 2),
    R("Mekyaji Cosmetic", "Baghdad — Cosmetics", "Baghdad", "Al-Mansour — 14 Ramadan (opposite Al-Taif Islamic Bank)", "Cosmetics", "Instagram", "https://www.instagram.com/mekyagi_shop", 2),
    R("Mekyaji Cosmetic — Branch 2", "Baghdad — Cosmetics", "Baghdad", "Al-Mansour Mall, Floor 1", "Cosmetics", "Instagram", "https://www.instagram.com/mekyagi_shop", 2),
    R("Nasamat Cosmetic", "Baghdad — Cosmetics", "Baghdad", "Al-Mansour — Al-Ruwad Street", "Cosmetics", "Instagram", "https://www.instagram.com/nasamat.p", 2),
    R("Beauty Rose Cosmetic", "Baghdad — Cosmetics", "Baghdad", "Palestine St — Al-Sakhra Junction", "Cosmetics", "Instagram", "https://www.instagram.com/beauty_rose6", 2),
    R("Dawod Al-Alouchi Cosmetic", "Baghdad — Cosmetics", "Baghdad", "Baghdad", "Cosmetics", "Instagram", "https://www.instagram.com/dawod_alalochi", 2),
    R("Sahm Cosmetic", "Baghdad — Cosmetics", "Baghdad", "Baghdad", "Cosmetics", "Instagram", "https://www.instagram.com/sahm.cosmetic", 2),
    R("Lancom Cosmetic", "Baghdad — Cosmetics", "Baghdad", "Baghdad", "Cosmetics", "Instagram", "https://www.instagram.com/lancom_cosmtices", 2),
    R("Butik Mariya", "Baghdad — Cosmetics", "Baghdad", "Baghdad", "Cosmetics", "Instagram", "https://www.instagram.com/butik.mariya", 2),
    R("Taj Cosmetics", "Baghdad — Cosmetics", "Baghdad", "Baghdad", "Cosmetics", "Instagram", "https://www.instagram.com/taj.cosmetics1", 2),
    R("Rasha Moon Cosmetic", "Baghdad — Cosmetics", "Baghdad", "Baghdad", "Cosmetics", "Instagram", "https://www.instagram.com/rasha._moon", 2),
    R("Beauty UK Store", "Northern Iraq", "Sulaymaniyah", "Sulaymaniyah", "Cosmetics", "Instagram", "https://www.instagram.com/beautyuk__store", 3),
    R("AM Cosmetic", "Northern Iraq", "Erbil", "Manara Market", "Cosmetics", "Instagram", "https://www.instagram.com/am._.cosmetic", 3),
    R("AH Cosmetic", "Northern Iraq", "Erbil", "Erbil", "Cosmetics", "Instagram", "https://www.instagram.com/ah_cosmetic", 3),
    R("A2M Cosmetic", "Northern Iraq", "Mosul", "Cultural Complex", "Cosmetics", "Instagram", "https://www.instagram.com/a2m.cosmetic", 3),
    R("Mikyajy Cosmetic — Mosul", "Northern Iraq", "Mosul", "Al-Zuhour District", "Cosmetics", "Instagram", "https://www.instagram.com/mikyajy_cosmetic", 3),
    R("Waleed Cosmetic", "Northern Iraq", "Kirkuk", "Al-Quds St — near Khattar Restaurant", "Cosmetics", "Instagram", "https://www.instagram.com/waleed_cosmetic", 3),
    R("Tahseen Cosmetic Line", "Northern Iraq", "Kirkuk", "Kirkuk", "Cosmetics", "Instagram", "https://www.instagram.com/cosmoline_by_tahseen2", 3),
    R("Loyal Cosmetic", "Northern Iraq", "Kirkuk", "Kirkuk", "Cosmetics", "Instagram", "https://www.instagram.com/loyal._.cosmetic", 3),
    R("Mikyajy Center", "Central Iraq", "Samarra", "Samarra", "Cosmetics", "Instagram", "https://www.instagram.com/mikyajy_center1", 4),
    R("Zaid Cosmetic", "Central Iraq", "Samarra", "Al-Urmawiya Market", "Cosmetics", "Instagram", "https://www.instagram.com/zaid_cosmetic_", 4),
    R("Zaid Cosmetic — University Branch", "Central Iraq", "Samarra", "Inside Samarra University", "Cosmetics", "Instagram", "https://www.instagram.com/zaid_cosmetic_", 4),
    R("Joelle Cosmetic", "Central Iraq", "Diyala", "Muqdadiya — Teachers District", "Cosmetics", "Instagram", "https://www.instagram.com/cosmetic.joelle1", 4),
    R("Helen No.1", "Central Iraq", "Hilla", "Street 40 — Al-Samoual Sweets Branch", "Cosmetics", "Instagram", "https://www.instagram.com/helen_no.1", 4),
    R("La Vera Beauty", "Southern Iraq", "Samawa", "Near Arz Lebanon", "Cosmetics", "Instagram", "https://www.instagram.com/la_verabeauty", 4),
    R("Lebanon Center Cosmetic", "Southern Iraq", "Najaf", "Najaf", "Cosmetics", "Instagram", "https://www.instagram.com/cosmatic_lebanon", 4),
    R("Nahwa Al-Jamal Cosmetic", "Southern Iraq", "Wasit", "Wasit", "Cosmetics", "Instagram", "https://www.instagram.com/cos.nahwa_aljamal", 4),
    R("Al-Kawakeb Center", "Southern Iraq", "Kut", "Kut", "Cosmetics", "Instagram", "https://www.instagram.com/al_kawakeb.center", 4),
    R("Safy Center", "Southern Iraq", "Dhi Qar", "Dhi Qar", "Cosmetics", "Instagram", "https://www.instagram.com/safy.center.sc", 4),
    R("Huda Beauty", "Southern Iraq", "Basra", "Al-Madina District", "Cosmetics", "Instagram", "https://www.instagram.com/huda_beauty2017", 4),
    R("Mohammed Cosmetic", "Southern Iraq", "Basra", "Basra", "Cosmetics", "Instagram", "https://www.instagram.com/mohammed__vx", 4),
];

static Retailer R(string name, string region, string city, string address, string channelType, string channel, string link, int phase, int listOrder = 100) =>
    new(name, region, city, address, channelType, channel, link, phase, listOrder);

static List<DistributionPhase> BuildPhases(List<Retailer> retailers) =>
[
    new(1, "15 – 19 Sep 2026", "Baghdad — Pharmacies",
        "Baghdad pharmacy network + MRT MAB.",
        retailers.Count(r => r.Phase == 1)),
    new(2, "22 – 26 Sep 2026", "Baghdad — Cosmetics",
        "Deema Al Hayat Cosmetic, then Al-Shaheera Cosmetic, followed by Al-Mansour cluster & Baghdad boutiques.",
        retailers.Count(r => r.Phase == 2)),
    new(3, "29 Sep – 03 Oct 2026", "Northern Iraq",
        "Erbil, Mosul, Kirkuk, Sulaymaniyah.",
        retailers.Count(r => r.Phase == 3)),
    new(4, "06 – 10 Oct 2026", "Central & Southern",
        "Samarra, Diyala, Hilla, Samawa, Najaf, Basra & south.",
        retailers.Count(r => r.Phase == 4)),
];

static void EnsureDocumentSettings(MainDocumentPart main)
{
    var settingsPart = main.AddNewPart<DocumentSettingsPart>();
    settingsPart.Settings = new Settings(
        new CharacterSpacingControl { Val = CharacterSpacingValues.DoNotCompress },
        new ThemeFontLanguages { Val = "en-US", EastAsia = "en-US", Bidi = "en-US" },
        new UpdateFieldsOnOpen(),
        new Compatibility(
            new CompatibilitySetting { Name = CompatSettingNameValues.CompatibilityMode, Uri = "http://schemas.microsoft.com/office/word", Val = "15" }));
}

static void EnsureStyles(MainDocumentPart main)
{
    if (main.StyleDefinitionsPart != null) return;
    var stylesPart = main.AddNewPart<StyleDefinitionsPart>();
    var ltrPara = new ParagraphProperties(
        new TextDirection { Val = TextDirectionValues.LeftToRightTopToBottom2010 },
        new Justification { Val = JustificationValues.Left },
        new WidowControl(),
        new SpacingBetweenLines { After = "80", Line = "276", LineRule = LineSpacingRuleValues.Auto });
    stylesPart.Styles = new Styles(
        new DocDefaults(
            new RunPropertiesDefault(new RunProperties(
                new RunFonts { Ascii = "Calibri", HighAnsi = "Calibri", ComplexScript = "Calibri" },
                new Languages { Val = "en-US", EastAsia = "en-US", Bidi = "en-US" },
                new FontSize { Val = "22" })),
            new ParagraphPropertiesDefault(ltrPara)));
}

static SectionProperties BuildSectionProperties(
    string firstHeaderId, string runningHeaderId, string firstFooterId, string footerId) =>
    new(
        new TitlePage(),
        new PageSize { Width = 11906U, Height = 16838U },
        new PageMargin { Top = 720, Bottom = 960, Left = 1080, Right = 1080, Header = 360, Footer = 280, Gutter = 0 },
        new HeaderReference { Type = HeaderFooterValues.First, Id = firstHeaderId },
        new HeaderReference { Type = HeaderFooterValues.Default, Id = runningHeaderId },
        new FooterReference { Type = HeaderFooterValues.First, Id = firstFooterId },
        new FooterReference { Type = HeaderFooterValues.Default, Id = footerId });

static IEnumerable<OpenXmlElement> LtrParaElements(
    JustificationValues align = default,
    bool keepWithNext = false,
    bool keepLines = false)
{
    if (align == default) align = JustificationValues.Left;
    yield return new TextDirection { Val = TextDirectionValues.LeftToRightTopToBottom2010 };
    yield return new Justification { Val = align };
    yield return new WidowControl();
    yield return new SpacingBetweenLines { After = "80", Line = "276", LineRule = LineSpacingRuleValues.Auto };
    if (keepWithNext) yield return new KeepNext();
    if (keepLines) yield return new KeepLines();
}

static ParagraphProperties MakeLtrParaProps(
    JustificationValues align = default,
    bool keepWithNext = false,
    bool keepLines = false) =>
    new(LtrParaElements(align, keepWithNext, keepLines).ToArray());

static ParagraphProperties RtlParaProps() =>
    new(new BiDi(), new Justification { Val = JustificationValues.Right },
        new SpacingBetweenLines { After = "30", Line = "240" });

static Paragraph PageBreak() =>
    new(new ParagraphProperties(new PageBreakBefore()), new Run(new Text("") { Space = SpaceProcessingModeValues.Preserve }));

static string[] OperationalNotes() =>
[
    "Rollout window: 15 September – 10 October 2026 (four weekly delivery phases).",
    "In August 2026, Deema Al Hayat supplied additional pharmacies and cosmetics partners not listed here — our network is expanding.",
    "Product focus: EVOLUDERM skincare, body care & lip care (Tree 840).",
    "Phase 1 — Baghdad pharmacies  ·  Phase 2 — Baghdad cosmetics (Deema Al Hayat, then Al-Shaheera, listed first).",
    "Phases 3–4 — Northern, central & southern governorates.",
    "Delivery dates confirmed 48 hours before each dispatch."
];

/// <summary>Page 1: empty header — full letterhead lives in document body.</summary>
static string AddFirstPageHeader(MainDocumentPart main)
{
    var headerPart = main.AddNewPart<HeaderPart>("rIdFirstHeader");
    var relId = main.GetIdOfPart(headerPart);
    headerPart.Header = new Header(EmptyHeaderFooterParagraph());
    return relId;
}

/// <summary>Page 1: no footer — avoids overlap with body letterhead.</summary>
static string AddFirstPageFooter(MainDocumentPart main)
{
    var footerPart = main.AddNewPart<FooterPart>("rIdFirstFooter");
    var relId = main.GetIdOfPart(footerPart);
    footerPart.Footer = new Footer(EmptyHeaderFooterParagraph());
    return relId;
}

/// <summary>Pages 2+: compact single-line running header.</summary>
static string AddRunningHeader(MainDocumentPart main)
{
    var headerPart = main.AddNewPart<HeaderPart>("rIdRunningHeader");
    var relId = main.GetIdOfPart(headerPart);
    headerPart.Header = new Header(RunningHeaderTable());
    return relId;
}

static Paragraph EmptyHeaderFooterParagraph() => new(
    new ParagraphProperties(new SpacingBetweenLines
    {
        Before = "0", After = "0", Line = "240", LineRule = LineSpacingRuleValues.Exact
    }),
    new Run(new Text("") { Space = SpaceProcessingModeValues.Preserve }));

static Table RunningHeaderTable() => new(
    LtrTableProps(bottomBorder: true),
    new TableGrid(new GridColumn { Width = "6800" }, new GridColumn { Width = "2946" }),
    new TableRow(
        CompactLtrCell("Deema Al Hayat Cosmetics  ·  EVOLUDERM Distribution Plan", false, "64748B", "16", JustificationValues.Left),
        CompactLtrCell("Sep – Oct 2026", false, "94A3B8", "16", JustificationValues.Right)));

/// <summary>Full letterhead on page 1 — logo renders reliably in body.</summary>
static Table LetterheadBlock(MainDocumentPart main, string logoPath)
{
    const long logoW = 1280000L; // ~1.4 in
    const long logoH = 640000L;  // ~0.7 in

    var logoCell = new TableCell(
        ImageParagraph(main, logoPath, logoW, logoH, 9901U),
        new TableCellProperties(
            new TableCellWidth { Width = "1600", Type = TableWidthUnitValues.Dxa },
            new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center },
            new TableCellMargin(new TopMargin { Width = "0", Type = TableWidthUnitValues.Dxa },
                new BottomMargin { Width = "0", Type = TableWidthUnitValues.Dxa },
                new LeftMargin { Width = "0", Type = TableWidthUnitValues.Dxa },
                new RightMargin { Width = "160", Type = TableWidthUnitValues.Dxa })));

    var infoCell = new TableCell(
        new Paragraph(MakeLtrParaProps(), Run("Deema Al Hayat Cosmetics Trading Co. LTD.", true, "0B1220", "24")),
        new Paragraph(RtlParaProps(), RunArabic("ديما الحياة لتجارة مواد التجميل محدودة المسؤولية", true, "0F9F76", "20")),
        new Paragraph(MakeLtrParaProps(),
            Run("Baghdad — Zayouna 714", false, "64748B", "18"),
            Run("     ", false, "64748B", "18"),
            Run("info@deemaalhayat.com.iq", false, "0F9F76", "18")),
        new TableCellProperties(
            new TableCellWidth { Width = "8400", Type = TableWidthUnitValues.Dxa },
            new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center },
            new TableCellMargin(new TopMargin { Width = "0", Type = TableWidthUnitValues.Dxa },
                new BottomMargin { Width = "0", Type = TableWidthUnitValues.Dxa },
                new LeftMargin { Width = "0", Type = TableWidthUnitValues.Dxa })));

    return new Table(
        NoBorderTableProps(),
        new TableRow(logoCell, infoCell),
        new TableRow(new TableCell(
            new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "120", After = "0" },
                new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 14, Space = 1 })),
                new Run(new Text(" ") { Space = SpaceProcessingModeValues.Preserve })),
            new TableCellProperties(new GridSpan { Val = 2 },
                new TableCellWidth { Width = "5000", Type = TableWidthUnitValues.Pct }))));
}

static TableProperties LtrTableProps(bool topBorder = false, bool bottomBorder = false) => new(
    new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
    new TableLayout { Type = TableLayoutValues.Fixed },
    new TableJustification { Val = TableRowAlignmentValues.Left },
    new TableBorders(
        new TopBorder { Val = topBorder ? BorderValues.Single : BorderValues.Nil, Color = "E2E8F0", Size = topBorder ? 4U : 0U },
        new BottomBorder { Val = bottomBorder ? BorderValues.Single : BorderValues.Nil, Color = "0F9F76", Size = bottomBorder ? 8U : 0U },
        new LeftBorder { Val = BorderValues.Nil },
        new RightBorder { Val = BorderValues.Nil },
        new InsideHorizontalBorder { Val = BorderValues.Nil },
        new InsideVerticalBorder { Val = BorderValues.Nil }));

static TableProperties NoBorderTableProps() => LtrTableProps();

static TableCell CompactLtrCell(string text, bool bold, string color, string size, JustificationValues align) =>
    new TableCell(
        new Paragraph(new ParagraphProperties(LtrParaElements(align).Concat([
            new SpacingBetweenLines { Before = "40", After = "40", Line = "240", LineRule = LineSpacingRuleValues.Exact }
        ]).ToArray()), Run(text, bold, color, size)),
        new TableCellProperties(new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center }));

static TableCell CompactLtrPageCell()
{
    var p = new Paragraph(new ParagraphProperties(LtrParaElements(JustificationValues.Center).Concat([
        new SpacingBetweenLines { Before = "40", After = "40", Line = "240", LineRule = LineSpacingRuleValues.Exact }
    ]).ToArray()));
    p.Append(Run("Page ", false, "94A3B8", "16"));
    p.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Begin }));
    p.Append(new Run(new FieldCode(" PAGE ") { Space = SpaceProcessingModeValues.Preserve }));
    p.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Separate }));
    p.Append(new Run(
        new RunProperties(new FontSize { Val = "16" }, new Color { Val = "94A3B8" }),
        new Text("1") { Space = SpaceProcessingModeValues.Preserve }));
    p.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.End }));
    return new TableCell(p, new TableCellProperties(new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center }));
}

static string AddFooter(MainDocumentPart main)
{
    var footerPart = main.AddNewPart<FooterPart>();
    var relId = main.GetIdOfPart(footerPart);
    footerPart.Footer = new Footer(FooterTable());
    return relId;
}

static Table FooterTable() => new(
    LtrTableProps(topBorder: true),
    new TableGrid(
        new GridColumn { Width = "3600" },
        new GridColumn { Width = "2546" },
        new GridColumn { Width = "3600" }),
    new TableRow(
        CompactLtrCell("Deema Al Hayat Cosmetics", false, "64748B", "16", JustificationValues.Left),
        CompactLtrPageCell(),
        CompactLtrCell("Prepared for EVOLUDERM · Internal use only", false, "94A3B8", "16", JustificationValues.Right)));

static Table SummaryBox(List<Retailer> retailers, List<DistributionPhase> phases)
{
    var pharma = retailers.Count(r => r.ChannelType == "Pharmacy");
    var cosmetic = retailers.Count(r => r.ChannelType == "Cosmetics");
    return new Table(
        new TableProperties(
            new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
            new TableLayout { Type = TableLayoutValues.Fixed },
            new TableJustification { Val = TableRowAlignmentValues.Left },
            new TableBorders(new TopBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 12 },
                new BottomBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 12 },
                new LeftBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 12 },
                new RightBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 12 },
                new InsideVerticalBorder { Val = BorderValues.Single, Color = "D1FAE5", Size = 4 })),
        new TableRow(
            StatCell($"{retailers.Count}", "Total Outlets", "F0FDF9"),
            StatCell($"{phases.Count}", "Delivery Phases", "F0FDF9"),
            StatCell($"{pharma}", "Pharmacies", "F0FDF9"),
            StatCell($"{cosmetic}", "Cosmetics", "F0FDF9"),
            StatCell("Sep–Oct 2026", "Rollout Window", "F0FDF9")));
}

static TableCell StatCell(string value, string label, string fill) => new(
    new Paragraph(new ParagraphProperties(LtrParaElements(JustificationValues.Center).Concat([
        new SpacingBetweenLines { Before = "80", After = "40" }
    ]).ToArray()), Run(value, true, "0F9F76", "32")),
    new Paragraph(new ParagraphProperties(LtrParaElements(JustificationValues.Center).Concat([
        new SpacingBetweenLines { After = "80" }
    ]).ToArray()), Run(label, false, "64748B", "18")),
    new TableCellProperties(
        new Shading { Val = ShadingPatternValues.Clear, Fill = fill },
        new TableCellWidth { Width = "2000", Type = TableWidthUnitValues.Dxa },
        new TableCellMargin(new TopMargin { Width = "60", Type = TableWidthUnitValues.Dxa },
            new BottomMargin { Width = "60", Type = TableWidthUnitValues.Dxa })));

static Paragraph TitleBlock() => new(
    MakeLtrParaProps(JustificationValues.Left),
    Run("EVOLUDERM", true, "0F9F76", "48"),
    new Run(new Break()),
    Run("Retail Distribution Plan — Iraq", true, "0B1220", "36"),
    new Run(new Break()),
    Run("Prepared for C2J SARL / EVOLUDERM  ·  Sep – Oct 2026", false, "64748B", "20"));

static Paragraph IntroParagraph(int count) => BodyPara(
    "Dear EVOLUDERM Team,\n\n" +
    $"Please find our distribution plan for the rollout period 15 September – 10 October 2026. Deema Al Hayat will supply {count} partner outlets across Iraq " +
    "in four weekly phases, starting with Baghdad pharmacies and expanding to cosmetics boutiques and regional cities.\n\n" +
    "Please note: in August 2026 we also distributed to a wider network of additional pharmacies and cosmetics stores across Iraq. " +
    "Our partner base is growing continuously — future monthly plans will include newly onboarded outlets.\n\n" +
    "This document is organised by delivery phase and geographic region for your logistics planning.");

static Paragraph SectionHeading(string text) => new(
    new ParagraphProperties(
        LtrParaElements(JustificationValues.Left, keepWithNext: true).Concat([
            new SpacingBetweenLines { Before = "100", After = "60" },
            new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 8, Space = 4 })
        ]).ToArray()),
    Run(text, true, "0B1220", "26"));

static Paragraph RegionHeadingParagraph(string region, string phases, int count) => new(
    new ParagraphProperties(
        LtrParaElements(JustificationValues.Left, keepWithNext: true).Concat([
            new SpacingBetweenLines { Before = "80", After = "40" },
            new Shading { Val = ShadingPatternValues.Clear, Fill = "F0FDF9" }
        ]).ToArray()),
    Run($"{region}  ·  {count} outlets  ·  Phases {phases}", true, "0F9F76", "22"));

static Paragraph BodyPara(string text)
{
    var p = new Paragraph(MakeLtrParaProps());
    foreach (var line in text.Split('\n'))
    {
        p.Append(Run(line, false, "334155", "21"));
        if (line != text.Split('\n')[^1]) p.Append(new Run(new Break()));
    }
    return p;
}

static Paragraph Spacer(int twips) => new(new ParagraphProperties(new SpacingBetweenLines { After = twips.ToString() }));

static Paragraph BulletPara(string text) => new(
    new ParagraphProperties(LtrParaElements().Concat([
        new Indentation { Left = "360", Hanging = "180" },
        new SpacingBetweenLines { After = "60" }
    ]).ToArray()),
    Run("•  ", true, "0F9F76", "21"),
    Run(text, false, "334155", "21"));

static Paragraph ClosingBlock()
{
    var p = new Paragraph(new ParagraphProperties(LtrParaElements().Concat([
        new SpacingBetweenLines { Before = "120", After = "0" }
    ]).ToArray()));
    p.Append(Run("Best regards,", false, "334155", "21"));
    p.Append(new Run(new Break()));
    p.Append(new Run(new Break()));
    p.Append(Run("Deema Al Hayat Cosmetics Trading Co. LTD.", true, "0B1220", "24"));
    p.Append(new Run(new Break()));
    p.Append(Run("Baghdad, Zayouna 714  ·  info@deemaalhayat.com.iq", false, "64748B", "20"));
    return p;
}

static Table PhaseTable(List<DistributionPhase> phases)
{
    var headers = new[] { "Phase", "Week", "Region", "#", "Delivery Scope" };
    var widths = new[] { "800", "1700", "2200", "600", "3700" };
    var rows = new List<TableRow> { HeaderRow(headers, widths) };
    foreach (var ph in phases)
        rows.Add(DataRow([$"Phase {ph.Number}", ph.Dates, ph.Region, ph.Count.ToString(), ph.Scope], widths, ph.Number % 2 == 0));
    return WrapTable(rows);
}

static Table RegionRetailerTable(MainDocumentPart main, RegionGroup region)
{
    var headers = new[] { "#", "Store", "City", "Type", "Address", "Link", "Phase" };
    var widths = new[] { "400", "1900", "1000", "850", "2200", "1500", "600" };
    var rows = new List<TableRow> { HeaderRow(headers, widths) };
    for (var i = 0; i < region.Items.Count; i++)
        rows.Add(RetailerDataRow(main, region.StartIndex + i, region.Items[i], widths, i % 2 == 1));
    return WrapTable(rows);
}

static TableRow RetailerDataRow(MainDocumentPart main, int num, Retailer r, string[] widths, bool shaded){
    var fill = shaded ? "F8FAFC" : "FFFFFF";
    if (r.ChannelType == "Pharmacy") fill = shaded ? "ECFDF5" : "F0FDF9";
    var row = new TableRow();
    var texts = new[] { num.ToString(), r.Name, r.City, r.ChannelType, r.Address, "", $"P{r.Phase}" };
    for (var i = 0; i < texts.Length; i++)
    {
        Paragraph p = i == 5
            ? LinkParagraph(main, r.Link)
            : new Paragraph(new ParagraphProperties(LtrParaElements().Concat([
                new SpacingBetweenLines { Line = "220", After = "0", Before = "0" }
            ]).ToArray()),
                Run(texts[i], false, i == 3 && r.ChannelType == "Pharmacy" ? "0F9F76" : "1A2332", "17"));
        row.Append(Cell(p, widths[i], false, fill));
    }
    return row;
}

static Table WrapTable(List<TableRow> rows)
{
    var table = new Table(new TableProperties(
        new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
        new TableLayout { Type = TableLayoutValues.Fixed },
        new TableJustification { Val = TableRowAlignmentValues.Left },
        new TableBorders(
            new TopBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
            new BottomBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
            new LeftBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
            new RightBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
            new InsideHorizontalBorder { Val = BorderValues.Single, Color = "E2E8F0", Size = 4 },
            new InsideVerticalBorder { Val = BorderValues.Single, Color = "E2E8F0", Size = 4 })));
    foreach (var row in rows) table.Append(row);
    return table;
}

static TableRow HeaderRow(string[] cells, string[] widths)
{
    var row = new TableRow(new TableRowProperties(new TableHeader()));
    for (var i = 0; i < cells.Length; i++)
        row.Append(Cell(new Paragraph(MakeLtrParaProps(JustificationValues.Center), Run(cells[i], true, "FFFFFF", "18")), widths[i], true, "0F9F76"));
    return row;
}

static TableRow DataRow(string[] cells, string[] widths, bool shaded)
{
    var row = new TableRow();
    for (var i = 0; i < cells.Length; i++)
    {
        var p = new Paragraph(new ParagraphProperties(LtrParaElements().Concat([
            new SpacingBetweenLines { Line = "260" }
        ]).ToArray()), Run(cells[i], false, "1A2332", "18"));
        row.Append(Cell(p, widths[i], false, shaded ? "F8FAFC" : "FFFFFF"));
    }
    return row;
}

static TableCell Cell(Paragraph p, string width, bool header, string? fill = null)
{
    var props = new List<OpenXmlElement> { new TableCellWidth { Width = width, Type = TableWidthUnitValues.Dxa } };
    if (fill != null) props.Add(new Shading { Val = ShadingPatternValues.Clear, Fill = fill });
    props.Add(new TableCellMargin(new TopMargin { Width = "70", Type = TableWidthUnitValues.Dxa },
        new BottomMargin { Width = "70", Type = TableWidthUnitValues.Dxa },
        new LeftMargin { Width = "90", Type = TableWidthUnitValues.Dxa },
        new RightMargin { Width = "90", Type = TableWidthUnitValues.Dxa }));
    return new TableCell(p, new TableCellProperties(props.ToArray()));
}

static Paragraph LinkParagraph(MainDocumentPart main, string url)
{
    var relId = "rId" + Guid.NewGuid().ToString("N")[..8];
    main.AddHyperlinkRelationship(new Uri(url, UriKind.Absolute), true, relId);
    return new Paragraph(MakeLtrParaProps(), new Hyperlink(
        new Run(
            new RunProperties(new Color { Val = "0F9F76" }, new Underline { Val = UnderlineValues.Single }),
            new Text(ShortLink(url)) { Space = SpaceProcessingModeValues.Preserve }))
    { Id = relId, History = OnOffValue.FromBoolean(true) });
}

static string ShortLink(string url)
{
    try
    {
        var uri = new Uri(url);
        var handle = uri.AbsolutePath.Trim('/').Split('/').LastOrDefault();
        if (uri.Host.Contains("instagram", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(handle))
            return "@" + handle;
        if (uri.Host.Contains("facebook", StringComparison.OrdinalIgnoreCase))
            return "Facebook ↗";
    }
    catch { /* fall through */ }
    return "Link ↗";
}

static Run Run(string text, bool bold, string color, string halfPoints) =>
    new Run(new RunProperties(
        bold ? new Bold() : null!,
        new Color { Val = color },
        new FontSize { Val = halfPoints },
        new RunFonts { Ascii = "Calibri", HighAnsi = "Calibri" },
        new Languages { Val = "en-US", EastAsia = "en-US" }),
        new Text(text) { Space = SpaceProcessingModeValues.Preserve });

static Run RunArabic(string text, bool bold, string color, string halfPoints) =>
    new Run(new RunProperties(
        bold ? new Bold() : null!,
        new Color { Val = color },
        new FontSize { Val = halfPoints },
        new RunFonts { Ascii = "Arial", HighAnsi = "Arial", ComplexScript = "Arial" },
        new Languages { Val = "ar-IQ", Bidi = "ar-IQ" }),
        new Text(text) { Space = SpaceProcessingModeValues.Preserve });

static Paragraph ImageParagraph(MainDocumentPart mainPart, string path, long cx, long cy, uint docPropId)
{
    var imagePart = mainPart.AddImagePart(ImagePartType.Jpeg);
    using (var fs = File.OpenRead(path)) imagePart.FeedData(fs);
    var relId = mainPart.GetIdOfPart(imagePart);
    var drawing = new Drawing(
        new DW.Inline(
            new DW.Extent { Cx = cx, Cy = cy },
            new DW.EffectExtent { LeftEdge = 0L, TopEdge = 0L, RightEdge = 0L, BottomEdge = 0L },
            new DW.DocProperties { Id = docPropId, Name = "Company Logo" },
            new DW.NonVisualGraphicFrameDrawingProperties(new A.GraphicFrameLocks { NoChangeAspect = true }),
            new A.Graphic(new A.GraphicData(new PIC.Picture(
                new PIC.NonVisualPictureProperties(
                    new PIC.NonVisualDrawingProperties { Id = docPropId, Name = "deema-logo.jpg" },
                    new PIC.NonVisualPictureDrawingProperties()),
                new PIC.BlipFill(
                    new A.Blip { Embed = relId, CompressionState = A.BlipCompressionValues.Print },
                    new A.Stretch(new A.FillRectangle())),
                new PIC.ShapeProperties(
                    new A.Transform2D(new A.Offset { X = 0L, Y = 0L }, new A.Extents { Cx = cx, Cy = cy }),
                    new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle })))
            { Uri = "http://schemas.openxmlformats.org/drawingml/2006/picture" }))
        {
            DistanceFromTop = 0U,
            DistanceFromBottom = 0U,
            DistanceFromLeft = 0U,
            DistanceFromRight = 0U
        });
    return new Paragraph(new ParagraphProperties(new SpacingBetweenLines { After = "0", Line = "240" }),
        new Run(drawing));
}

sealed record Retailer(string Name, string Region, string City, string Address, string ChannelType, string Channel, string Link, int Phase, int ListOrder = 100);
sealed record DistributionPhase(int Number, string Dates, string Region, string Scope, int Count);
sealed record RegionGroup(string Name, string PhaseLabel, List<Retailer> Items, int StartIndex);
