using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

const string logo = @"c:\Users\Future of Technology\Documents\pos\tools\output\deema-logo.jpg";
var dir = @"c:\Users\Future of Technology\Documents\pos\tools\output\outlook-2027";
Directory.CreateDirectory(dir);
var desk = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);

Write(Path.Combine(dir, "EVOLUDERM-Outlook-2027-2029-EN.docx"), false, logo);
Write(Path.Combine(dir, "EVOLUDERM-Outlook-2027-2029-AR.docx"), true, logo);
foreach (var name in new[] { "EVOLUDERM-Outlook-2027-2029-EN.docx", "EVOLUDERM-Outlook-2027-2029-AR.docx", "EVOLUDERM-Outlook-2027-2029-EN.pdf", "EVOLUDERM-Outlook-2027-2029-AR.pdf" })
{
    var src = Path.Combine(dir, name);
    if (!File.Exists(src)) continue;
    File.Copy(src, Path.Combine(desk, name), true);
    Console.WriteLine(Path.Combine(desk, name));
}

static void Write(string path, bool ar, string logo)
{
    using var doc = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document);
    var main = doc.AddMainDocumentPart();
    main.Document = new Document(new Body());
    var body = main.Document.Body!;
    if (File.Exists(logo)) body.Append(ImagePara(main, logo));
    if (ar) Arabic(body); else English(body);
    body.Append(new SectionProperties(
        new PageSize { Width = 11906, Height = 16838 },
        new PageMargin { Top = 720, Bottom = 720, Left = 720, Right = 720 }));
    main.Document.Save();
}

static void English(Body body)
{
    body.Append(H("EVOLUDERM — commercial outlook 2027–2029", false));
    body.Append(P("Deema Al Hayat Cosmetics Trading Co. Ltd.  ·  Baghdad, Zayouna 714  ·  info@deemaalhayat.com.iq", false, "64748B"));
    body.Append(P("Brand EVOLUDERM  ·  Supplier C2J SARL  ·  Client code C01521  ·  Ref. CAP-EVO-2027  ·  8 October 2026", false, "64748B"));
    body.Append(P("This document sets out the purchasing and marketing capacity that Deema Al Hayat can place at the disposal of EVOLUDERM in the Republic of Iraq. The figures are submitted for discussion of annual objectives. They are not a confirmed order, a minimum purchase obligation, or a contractual penalty.", false));
    body.Append(H("1. Present position", false));
    body.Append(P("EVOLUDERM already forms part of our assortment. In September and October 2026 distribution was established with 38 partner outlets: pharmacies, drug warehouses and cosmetics stores throughout Iraq. This outlook is the following step. It does not relaunch the brand. Territory: throughout the Republic of Iraq, with no governorate set apart from the others. Purchases mean goods acquired from EVOLUDERM, and are not a commitment to retail sell-out. Coverage is across Iraq, without a commitment to a fixed number of outlets.", false));
    body.Append(H("2. Purchasing capacity (euro)", false));
    body.Append(P("The lowest purchasing scenario for 2027 is €100,000. In that first year, purchases may rise by 20%, to €120,000, and by up to 50%, to €150,000, if demand supports it. In each following year the same step is taken from that year’s lowest figure: about 20% higher, and up to 50% higher. The higher figures are available room, not an obligation.", false));
    body.Append(Table(false,
        ["Year", "Lowest scenario", "About 20% higher", "Up to 50% higher"],
        [
            ["2027", "€100,000", "€120,000", "€150,000"],
            ["2028", "€120,000", "€144,000", "€180,000"],
            ["2029", "€144,000", "€172,800", "€216,000"]
        ]));
    body.Append(P("These amounts are the annual purchasing capacity, in euros, for goods acquired from EVOLUDERM. During the year, orders would follow demand in the pharmacies and stores we supply.", false));
    body.Append(H("3. Marketing capacity", false));
    body.Append(P("Independently of purchases, the following amounts may be invested in local activation. The website and the telephone application would be developed once, in 2027, at €3,000. From 2028 the digital cost is limited to annual upkeep of €500. The larger amounts are directed to advertising, content and the points of sale.", false));
    body.Append(Table(false, ["Year", "Marketing capacity"], [["2027", "€25,000"], ["2028", "€26,000"], ["2029", "€30,000"]]));
    body.Append(P("2027 — €25,000, including the application and website", true));
    body.Append(Table(false,
        ["Activity", "Amount", "Presentation to the market"],
        [
            ["Social advertising", "€9,000", "Arabic campaigns on Instagram, TikTok and Facebook at launch and at two subsequent retail occasions"],
            ["Influencers and content", "€9,500", "Iraqi content creators and Arabic content prepared for the EVOLUDERM range"],
            ["Testers and in-store material", "€3,500", "Testers and counter material in the pharmacies and stores we supply"],
            ["Website and telephone application", "€3,000", "Brand website and telephone application, developed once in 2027"],
            ["Total", "€25,000", ""]
        ],
        onlySecondNumeric: true));
    body.Append(P("2028 — €26,000. The application is not rebuilt. The year is devoted to advertising and to work at the points of sale.", true));
    body.Append(Table(false, ["Activity", "Amount"],
        [["Social advertising", "€12,500"], ["Influencers and content", "€8,500"], ["Testers and in-store material", "€4,500"], ["Website and application upkeep", "€500"], ["Total", "€26,000"]]));
    body.Append(P("2029 — €30,000. Paid social advertising is set at €15,250, in three waves: the beginning of the year, mid-year, and the promotional season. Influencer activity remains a separate line.", true));
    body.Append(Table(false, ["Activity", "Amount"],
        [["Social advertising", "€15,250"], ["Influencers and content", "€8,750"], ["Testers and in-store material", "€5,500"], ["Website and application upkeep", "€500"], ["Total", "€30,000"]]));
    body.Append(H("4. Digital presence, content and points of sale", false));
    body.Append(P("Official EVOLUDERM pages for Iraq would be maintained on Instagram, TikTok and Facebook, with customer communication in Arabic. In 2027 a single project covers the brand website and the telephone application, at €3,000. From 2028 both remain online at €500 a year, and the application is not rebuilt. Collaborations would be undertaken with Iraqi content creators, together with Arabic content for the range. Testers are supplied to the pharmacies and cosmetics stores we serve throughout Iraq and are replenished. When a promotion is in place, the same outlets receive simple counter material, and staff receive a brief introduction.", false));
    body.Append(H("5. Use of this outlook", false));
    body.Append(P("The amounts in this document are submitted so that annual objectives may be discussed on a clear basis. They describe the capacity of Deema Al Hayat. They are not proposed as a minimum purchase or as a minimum marketing obligation. Before each new year, the practical order level may be agreed with you according to sell-out and stock. Deema Al Hayat remains at your disposal for that review, and would be pleased to discuss it at your convenience.", false));
    body.Append(P("Deema Al Hayat Cosmetics Trading Co. Ltd. — Baghdad, Zayouna 714 — info@deemaalhayat.com.iq — C01521 — CAP-EVO-2027 — Capacity outlook, not a contractual commitment.", false, "64748B"));
}

static void Arabic(Body body)
{
    body.Append(H("EVOLUDERM — بيان الإمكانية التجارية 2027–2029", true));
    body.Append(P("ديما الحياة لتجارة مواد التجميل محدودة المسؤولية  ·  بغداد، زيونة 714  ·  info@deemaalhayat.com.iq", true, "64748B"));
    body.Append(P("العلامة EVOLUDERM  ·  المورد C2J SARL  ·  رمز العميل C01521  ·  المرجع CAP-EVO-2027  ·  8 تشرين الأول 2026", true, "64748B"));
    body.Append(P("يحدد هذا البيان إمكانية الشراء والتسويق التي تستطيع ديما الحياة توفيرها لعلامة EVOLUDERM في جمهورية العراق. وتُقدَّم الأرقام لمناقشة الأهداف السنوية. وهي ليست طلباً مؤكداً، ولا حد شراء إلزامي، ولا غرامة تعاقدية.", true));
    body.Append(H("1. الوضع الراهن", true));
    body.Append(P("تشكّل علامة EVOLUDERM جزءاً من تشكيلتنا الحالية. وفي أيلول وتشرين الأول 2026 وُضع التوزيع مع 38 منفذاً شريكاً، تشمل الصيدليات والمذاخر ومحلات التجميل في جميع أنحاء العراق. وهذا البيان هو الخطوة التالية، ولا يعيد إطلاق العلامة من جديد. النطاق: جميع أنحاء جمهورية العراق، من غير تخصيص محافظة دون أخرى. ويُقصد بالشراء البضاعة المقتناة من EVOLUDERM، لا التزاماً بمبيع التجزئة. والتغطية تشمل أنحاء العراق من غير التزام بعدد ثابت من المنافذ.", true));
    body.Append(H("2. إمكانية الشراء (يورو)", true));
    body.Append(P("أقل سيناريو للشراء في سنة 2027 هو 100,000 يورو. وفي تلك السنة الأولى يمكن أن يرتفع الشراء بنسبة 20٪ إلى 120,000 يورو، وبنسبة تصل إلى 50٪ إلى 150,000 يورو، إذا دعم الطلب ذلك. وفي كل سنة تالية تُحسب الزيادة نفسها من المبلغ الأول لتلك السنة: نحو 20٪، وحتى 50٪. والأرقام الأعلى مجال متاح، وليست التزاماً.", true));
    body.Append(Table(true,
        ["السنة", "أقل سيناريو", "زيادة بنحو 20٪", "زيادة حتى 50٪"],
        [
            ["2027", "€100,000", "€120,000", "€150,000"],
            ["2028", "€120,000", "€144,000", "€180,000"],
            ["2029", "€144,000", "€172,800", "€216,000"]
        ]));
    body.Append(P("هذه المبالغ هي إمكانية الشراء السنوية، باليورو، للبضاعة المقتناة من EVOLUDERM. وخلال السنة يُحدَّد الطلب وفق حاجة الصيدليات والمحلات التي نزوّدها.", true));
    body.Append(H("3. إمكانية التسويق", true));
    body.Append(P("بمعزل عن الشراء، يمكن استثمار المبالغ التالية في التنشيط المحلي. ويُنجَز الموقع وتطبيق الهاتف مرة واحدة في عام 2027 بتكلفة 3,000 يورو. ومن عام 2028 تقتصر التكلفة الرقمية على صيانة سنوية قدرها 500 يورو. وتُوجَّه المبالغ الأكبر إلى الإعلان والمحتوى ونقاط البيع.", true));
    body.Append(Table(true, ["السنة", "إمكانية التسويق"], [["2027", "€25,000"], ["2028", "€26,000"], ["2029", "€30,000"]]));
    body.Append(P("2027 — 25,000 يورو، شاملاً التطبيق والموقع", true));
    body.Append(Table(true,
        ["النشاط", "المبلغ", "ما يُقدَّم إلى السوق"],
        [
            ["إعلان وسائل التواصل", "€9,000", "حملات باللغة العربية على إنستغرام وتيك توك وفيسبوك عند الإطلاق وفي مناسبتين تجاريتين لاحقتين"],
            ["المؤثرون والمحتوى", "€9,500", "تعاون مع صنّاع محتوى عراقيين، ومحتوى عربي مُعدّ لتشكيلة EVOLUDERM"],
            ["عيّنات التجربة ومواد العرض", "€3,500", "عيّنات تجربة ومادة عرض بسيطة في الصيدليات والمحلات التي نزوّدها"],
            ["الموقع وتطبيق الهاتف", "€3,000", "موقع العلامة وتطبيق الهاتف، ويُنجَزان مرة واحدة في عام 2027"],
            ["المجموع", "€25,000", ""]
        ],
        onlySecondNumeric: true));
    body.Append(P("2028 — 26,000 يورو. لا يُعاد بناء التطبيق، وتُخصَّص السنة للإعلان والعمل داخل نقاط البيع.", true));
    body.Append(Table(true, ["النشاط", "المبلغ"],
        [["إعلان وسائل التواصل", "€12,500"], ["المؤثرون والمحتوى", "€8,500"], ["عيّنات التجربة ومواد العرض", "€4,500"], ["صيانة الموقع والتطبيق", "€500"], ["المجموع", "€26,000"]]));
    body.Append(P("2029 — 30,000 يورو. يُحدَّد الإعلان المدفوع بمبلغ 15,250 يورو على ثلاث موجات. ويبقى نشاط المؤثرين بنداً مستقلاً.", true));
    body.Append(Table(true, ["النشاط", "المبلغ"],
        [["إعلان وسائل التواصل", "€15,250"], ["المؤثرون والمحتوى", "€8,750"], ["عيّنات التجربة ومواد العرض", "€5,500"], ["صيانة الموقع والتطبيق", "€500"], ["المجموع", "€30,000"]]));
    body.Append(H("4. الحضور الرقمي والمحتوى ونقاط البيع", true));
    body.Append(P("تُدار صفحات رسمية لعلامة EVOLUDERM موجّهة إلى العراق على إنستغرام وتيك توك وفيسبوك، ويكون التواصل مع الزبائن باللغة العربية. وفي عام 2027 يُنجَز موقع العلامة وتطبيق الهاتف معاً بتكلفة 3,000 يورو، ومن عام 2028 يبقيان بتكلفة 500 يورو في السنة من غير إعادة بناء. ويُقام تعاون مع صنّاع محتوى عراقيين ومحتوى عربي للتشكيلة. وتُوفَّر عيّنات التجربة للصيدليات ومحلات التجميل في جميع أنحاء العراق مع إعادة التزويد، وتتلقى المنافذ مادة عرض بسيطة عند العروض، مع شرح موجز للموظفين.", true));
    body.Append(H("5. استخدام هذا البيان", true));
    body.Append(P("تُقدَّم هذه المبالغ لتكون أساساً واضحاً لمناقشة الأهداف السنوية. وهي تصف إمكانية ديما الحياة، ولا تُقترح حداً أدنى للشراء ولا حداً أدنى للإنفاق التسويقي. وقبل كل سنة جديدة يمكن الاتفاق على مستوى الطلب العملي وفقاً لمبيع التجزئة والمخزون. وتبقى ديما الحياة على استعداد لهذه المراجعة، ويسعدها مناقشتها في الوقت الذي يناسبكم.", true));
    body.Append(P("ديما الحياة لتجارة مواد التجميل محدودة المسؤولية — بغداد، زيونة 714 — info@deemaalhayat.com.iq — C01521 — CAP-EVO-2027 — بيان إمكانية، وليس التزاماً تعاقدياً.", true, "64748B"));
}

static Paragraph H(string text, bool ar) => new(
    Props(ar, true),
    Run(text, true, "0B1220", "28", ar));

static Paragraph P(string text, bool ar, string color = "334155") => new(
    Props(ar, false),
    Run(text, false, color, "21", ar));

static ParagraphProperties Props(bool ar, bool heading)
{
    var p = new ParagraphProperties(
        new Justification { Val = ar ? JustificationValues.Right : JustificationValues.Left },
        new SpacingBetweenLines { Before = heading ? "200" : "60", After = heading ? "80" : "80" });
    if (ar) p.Append(new BiDi());
    if (heading) p.Append(new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Color = "0F9F76", Size = 8, Space = 1 }));
    return p;
}

static Run Run(string text, bool bold, string color, string size, bool ar)
{
    var rp = new RunProperties(
        new RunFonts { Ascii = "Calibri", HighAnsi = "Calibri", ComplexScript = "Calibri" },
        new FontSize { Val = size },
        new FontSizeComplexScript { Val = size },
        new Color { Val = color });
    if (bold) rp.Append(new Bold(), new BoldComplexScript());
    if (ar) rp.Append(new Languages { Bidi = "ar-IQ" });
    return new Run(rp, new Text(text) { Space = SpaceProcessingModeValues.Preserve });
}

static Table Table(bool ar, string[] headers, string[][] rows, bool onlySecondNumeric = false)
{
    var n = headers.Length;
    var widths = n switch
    {
        2 => new[] { 7466, 3000 },
        3 when onlySecondNumeric => new[] { 2500, 1800, 6166 },
        4 => new[] { 1866, 2867, 2867, 2866 },
        _ => new[] { 2200, 4133, 4133 }
    };
    var numeric = new bool[n];
    if (onlySecondNumeric) numeric[1] = true;
    else for (var i = 1; i < n; i++) numeric[i] = true;

    var grid = new TableGrid();
    foreach (var w in widths) grid.Append(new GridColumn { Width = w.ToString() });
    var table = new Table(
        new TableProperties(
            new TableWidth { Width = "10466", Type = TableWidthUnitValues.Dxa },
            new TableLayout { Type = TableLayoutValues.Fixed },
            new TableJustification { Val = TableRowAlignmentValues.Center },
            new TableBorders(
                new TopBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
                new BottomBorder { Val = BorderValues.Single, Color = "CBD5E1", Size = 4 },
                new InsideHorizontalBorder { Val = BorderValues.Single, Color = "E2E8F0", Size = 4 },
                new InsideVerticalBorder { Val = BorderValues.Single, Color = "E2E8F0", Size = 4 })),
        grid);
    table.Append(Row(headers, ar, true, "0F9F76", "FFFFFF", widths, numeric));
    for (var i = 0; i < rows.Length; i++)
        table.Append(Row(rows[i], ar, i == rows.Length - 1, i == rows.Length - 1 ? "E7F6F1" : (i % 2 == 0 ? "FFFFFF" : "F8FAFC"), "1A2332", widths, numeric));
    return table;
}

static TableRow Row(string[] cells, bool ar, bool bold, string fill, string color, int[] widths, bool[] numeric)
{
    var row = new TableRow();
    for (var i = 0; i < cells.Length; i++)
    {
        var center = numeric[i];
        var pPr = new ParagraphProperties(
            new Justification { Val = center ? JustificationValues.Center : (ar ? JustificationValues.Right : JustificationValues.Left) },
            new SpacingBetweenLines { Before = "40", After = "40" });
        if (ar) pPr.Append(new BiDi());
        var p = new Paragraph(pPr, Run(cells[i], bold, color, "18", ar));
        var tc = new TableCell();
        tc.Append(new TableCellProperties(
            new TableCellWidth { Width = widths[i].ToString(), Type = TableWidthUnitValues.Dxa },
            new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center },
            new Shading { Val = ShadingPatternValues.Clear, Fill = fill },
            new TableCellMargin(
                new TopMargin { Width = "60", Type = TableWidthUnitValues.Dxa },
                new BottomMargin { Width = "60", Type = TableWidthUnitValues.Dxa },
                new LeftMargin { Width = "80", Type = TableWidthUnitValues.Dxa },
                new RightMargin { Width = "80", Type = TableWidthUnitValues.Dxa })));
        tc.Append(p);
        row.Append(tc);
    }
    return row;
}

static Paragraph ImagePara(MainDocumentPart main, string path)
{
    var part = main.AddImagePart(ImagePartType.Jpeg);
    using (var s = File.OpenRead(path)) part.FeedData(s);
    var id = main.GetIdOfPart(part);
    long cx = 2200000L, cy = 700000L;
    var drawing = new Drawing(
        new DocumentFormat.OpenXml.Drawing.Wordprocessing.Inline(
            new DocumentFormat.OpenXml.Drawing.Wordprocessing.Extent { Cx = cx, Cy = cy },
            new DocumentFormat.OpenXml.Drawing.Wordprocessing.DocProperties { Id = 1U, Name = "logo" },
            new DocumentFormat.OpenXml.Drawing.Graphic(
                new DocumentFormat.OpenXml.Drawing.GraphicData(
                    new DocumentFormat.OpenXml.Drawing.Pictures.Picture(
                        new DocumentFormat.OpenXml.Drawing.Pictures.NonVisualPictureProperties(
                            new DocumentFormat.OpenXml.Drawing.Pictures.NonVisualDrawingProperties { Id = 0U, Name = "logo.jpg" },
                            new DocumentFormat.OpenXml.Drawing.Pictures.NonVisualPictureDrawingProperties()),
                        new DocumentFormat.OpenXml.Drawing.Pictures.BlipFill(
                            new DocumentFormat.OpenXml.Drawing.Blip { Embed = id },
                            new DocumentFormat.OpenXml.Drawing.Stretch(new DocumentFormat.OpenXml.Drawing.FillRectangle())),
                        new DocumentFormat.OpenXml.Drawing.Pictures.ShapeProperties(
                            new DocumentFormat.OpenXml.Drawing.Transform2D(
                                new DocumentFormat.OpenXml.Drawing.Offset { X = 0, Y = 0 },
                                new DocumentFormat.OpenXml.Drawing.Extents { Cx = cx, Cy = cy }),
                            new DocumentFormat.OpenXml.Drawing.PresetGeometry(new DocumentFormat.OpenXml.Drawing.AdjustValueList()) { Preset = DocumentFormat.OpenXml.Drawing.ShapeTypeValues.Rectangle })))
                { Uri = "http://schemas.openxmlformats.org/drawingml/2006/picture" }))
        { DistanceFromTop = 0U, DistanceFromBottom = 0U, DistanceFromLeft = 0U, DistanceFromRight = 0U });
    return new Paragraph(drawing);
}
