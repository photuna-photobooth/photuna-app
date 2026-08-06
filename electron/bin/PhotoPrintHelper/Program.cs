using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.IO;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var options = ParseArgs(args);

            if (!options.TryGetValue("--file", out var filePath) || string.IsNullOrWhiteSpace(filePath))
                throw new ArgumentException("Missing --file");

            if (!options.TryGetValue("--printer", out var printerName) || string.IsNullOrWhiteSpace(printerName))
                throw new ArgumentException("Missing --printer");

            var copies = ParseInt(options, "--copies", 1);
            var dpi = ParseInt(options, "--dpi", 300);
            var layout = NormalizeLayout(GetOption(options, "--layout", "4x6"));
            var orientation = GetOption(options, "--orientation", "landscape");
            var usePrinterDefaults = ParseBool(options, "--use-printer-defaults", false);
            var colorMode = GetOption(options, "--color", "color");
            var quality = GetOption(options, "--quality", "high");

            if (!File.Exists(filePath))
                throw new FileNotFoundException("Image file not found", filePath);

            using var sourceImage = Image.FromFile(filePath);

            for (int i = 0; i < Math.Max(1, copies); i++)
            {
                using var printDoc = new PrintDocument();
                printDoc.PrinterSettings.PrinterName = printerName;
                printDoc.PrintController = new StandardPrintController();
                printDoc.OriginAtMargins = false;

                if (!printDoc.PrinterSettings.IsValid)
                    throw new InvalidOperationException($"Printer is not valid: {printerName}");

                if (!usePrinterDefaults)
                {
                    ApplyPaperSettings(printDoc, layout, orientation);
                }

                printDoc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
                printDoc.OriginAtMargins = false;
                printDoc.DefaultPageSettings.Color =
                    !string.Equals(colorMode, "bw", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(colorMode, "mono", StringComparison.OrdinalIgnoreCase);

                TryApplyBestPrinterResolution(printDoc, dpi, quality);

                Console.WriteLine("PRINT DEBUG ----------------");
                Console.WriteLine($"Printer: {printerName}");
                Console.WriteLine($"Layout: {layout}");
                Console.WriteLine($"Copies: {copies}");
                Console.WriteLine($"DPI request: {dpi}");
                Console.WriteLine($"Orientation: {orientation}");
                Console.WriteLine($"Use printer defaults: {usePrinterDefaults}");
                Console.WriteLine($"Selected Paper: {printDoc.DefaultPageSettings.PaperSize?.PaperName}");
                Console.WriteLine($"Paper Size: {printDoc.DefaultPageSettings.PaperSize?.Width} x {printDoc.DefaultPageSettings.PaperSize?.Height}");
                Console.WriteLine($"Landscape: {printDoc.DefaultPageSettings.Landscape}");

                // Validate paper size is 4x6 in. (DS-RX1 reports as landscape 6×4 = 600×400)
                var ps = printDoc.DefaultPageSettings.PaperSize;
                bool is4x6 = ps != null && (
                    (Approximately(ps.Width, 400) && Approximately(ps.Height, 600)) ||
                    (Approximately(ps.Width, 600) && Approximately(ps.Height, 400))
                );
                Console.WriteLine($"Photo size: {(ps?.Width ?? 0) / 100.0:F1} x {(ps?.Height ?? 0) / 100.0:F1} in.  Validated 4×6: {(is4x6 ? "PASS" : "WARN – not 4×6")}");
                Console.WriteLine("Fit: Shrink to fit");

                printDoc.PrintPage += (sender, e) =>
                {
                    e.Graphics.PageUnit = GraphicsUnit.Display;
                    e.Graphics.PageScale = 1f;
                    e.Graphics.CompositingQuality = CompositingQuality.HighQuality;
                    e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    e.Graphics.SmoothingMode = SmoothingMode.HighQuality;

                    using var renderImage = PrepareImageForLayout(sourceImage, layout);

                    int hardX = (int)Math.Round(e.PageSettings.HardMarginX);
                    int hardY = (int)Math.Round(e.PageSettings.HardMarginY);
                    int pageWidth  = e.PageBounds.Width;
                    int pageHeight = e.PageBounds.Height;

                    // Shrink to fit: scale image down to fill the printable area while
                    // maintaining aspect ratio, centered on the page. Never scales up.
                    int printableX = hardX;
                    int printableY = hardY;
                    int printableW = Math.Max(1, pageWidth  - 2 * hardX);
                    int printableH = Math.Max(1, pageHeight - 2 * hardY);

                    float scale = Math.Min(
                        (float)printableW / renderImage.Width,
                        (float)printableH / renderImage.Height
                    );

                    int drawW = (int)Math.Round(renderImage.Width  * scale);
                    int drawH = (int)Math.Round(renderImage.Height * scale);
                    int drawX = printableX + (printableW - drawW) / 2;
                    int drawY = printableY + (printableH - drawH) / 2;

                    Console.WriteLine($"Scale: {scale:F4}  printable: {printableW}×{printableH}  image: {renderImage.Width}×{renderImage.Height}  draw: ({drawX},{drawY},{drawW},{drawH})");

                    e.Graphics.DrawImage(
                        renderImage,
                        new Rectangle(drawX, drawY, drawW, drawH),
                        new Rectangle(0, 0, renderImage.Width, renderImage.Height),
                        GraphicsUnit.Pixel
                    );

                    e.HasMorePages = false;
                };

                printDoc.Print();
            }

            Console.WriteLine("OK");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.ToString());
            return 1;
        }
    }

    private static Bitmap PrepareImageForLayout(Image sourceImage, string layout)
    {
        string normalized = NormalizeLayout(layout);
        var bitmap = new Bitmap(sourceImage);

        // The DS-RX1 (and most DNP printers) always operate with a landscape (6×4) page.
        // Photuna composites portrait images for 4×6 and 2×6 (1200×1800).
        // Rotate portrait outputs 90° CW → landscape (1800×1200) so the image fills
        // the landscape page at full bleed (scale = 1/3 exactly). 6×4 and 6×2 composites
        // are already landscape — no rotation needed.
        if ((normalized == "4x6" || normalized == "2x6") && bitmap.Height > bitmap.Width)
            bitmap.RotateFlip(RotateFlipType.Rotate90FlipNone);

        TrySetBitmapDpi(bitmap, 300, 300);
        return bitmap;
    }

    private static void ApplyPaperSettings(PrintDocument printDoc, string layout, string orientation)
    {
        string normalized = NormalizeLayout(layout);

        // DS-RX1 (and most DNP printers) always use landscape page orientation.
        //   4x6  → landscape 6×4 (600×400). Image pre-rotated 90° CW in PrepareImageForLayout.
        //   2x6  → landscape 6×4 (600×400). Same sheet as 4x6; STRIP DEVMODE cuts at 2".
        //   6x4  → landscape 6×4 (600×400). Image already landscape.
        //   6x2  → landscape 6×2 (600×200) if available, else 6×4 fallback.
        bool isStrip62 = normalized == "6x2";

        int widthHundredths  = 600;
        int heightHundredths = isStrip62 ? 200 : 400;

        bool landscape = true;   // always landscape for DS-RX1
        printDoc.DefaultPageSettings.Landscape = landscape;
        printDoc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
        printDoc.OriginAtMargins = false;

        PaperSize? best = null;

        Console.WriteLine("Available paper sizes:");
        foreach (PaperSize ps in printDoc.PrinterSettings.PaperSizes)
            Console.WriteLine($"PaperSize: Name={ps.PaperName}, W={ps.Width}, H={ps.Height}, RawKind={ps.RawKind}");

        // Step 1: name match
        foreach (PaperSize ps in printDoc.PrinterSettings.PaperSizes)
        {
            string name = (ps.PaperName ?? "").ToLowerInvariant();
            bool is46Name =
                name.Contains("4x6") || name.Contains("4 x 6") ||
                name.Contains("6x4") || name.Contains("6 x 4");
            bool isStripName =
                name.Contains("2x6") || name.Contains("2 x 6") ||
                name.Contains("6x2") || name.Contains("6 x 2") ||
                name.Contains("strip") || name.Contains("split") ||
                name.Contains("2-cut") || name.Contains("2 cut") ||
                name.Contains("2 inch cut") || name.Contains("2-inch cut");

            if (isStrip62)
            {
                // 6×2 landscape strip: prefer explicit strip/6x2 name, then fall through to 4x6
                if (isStripName) { best = ps; Console.WriteLine($"Using named 6x2 strip paper: {ps.PaperName}"); break; }
            }

            // For all layouts: find the 4×6 paper (excludes strip-named papers)
            if (is46Name && !isStripName) { best = ps; Console.WriteLine($"Using named 4x6 paper: {ps.PaperName}"); break; }
        }

        // Step 2: size match
        if (best == null)
        {
            foreach (PaperSize ps in printDoc.PrinterSettings.PaperSizes)
            {
                if ((Approximately(ps.Width, widthHundredths) && Approximately(ps.Height, heightHundredths)) ||
                    (Approximately(ps.Width, heightHundredths) && Approximately(ps.Height, widthHundredths)))
                {
                    best = ps;
                    Console.WriteLine($"Using size-matched paper: {ps.PaperName}");
                    break;
                }
            }
        }

        // Step 3: final fallback — for 2x6, create a portrait 4×6 custom paper (not 6×2)
        if (best == null)
        {
            best = new PaperSize("Photo 4x6", widthHundredths, heightHundredths);
            Console.WriteLine($"Using custom fallback paper: {best.PaperName} ({best.Width}x{best.Height})");
        }

        printDoc.DefaultPageSettings.PaperSize = best;
    }

    private static void TryApplyBestPrinterResolution(PrintDocument printDoc, int requestedDpi, string quality)
    {
        try
        {
            PrinterResolution? best = null;

            foreach (PrinterResolution pr in printDoc.PrinterSettings.PrinterResolutions)
            {
                if (pr.Kind == PrinterResolutionKind.Custom)
                {
                    if (pr.X == requestedDpi || pr.Y == requestedDpi)
                    {
                        best = pr;
                        break;
                    }
                }
            }

            if (best == null)
            {
                foreach (PrinterResolution pr in printDoc.PrinterSettings.PrinterResolutions)
                {
                    if (quality.Equals("high", StringComparison.OrdinalIgnoreCase) &&
                        pr.Kind == PrinterResolutionKind.High)
                    {
                        best = pr;
                        break;
                    }

                    if (!quality.Equals("high", StringComparison.OrdinalIgnoreCase) &&
                        pr.Kind == PrinterResolutionKind.Medium)
                    {
                        best = pr;
                        break;
                    }
                }
            }

            if (best == null)
            {
                best = new PrinterResolution
                {
                    Kind = quality.Equals("high", StringComparison.OrdinalIgnoreCase)
                        ? PrinterResolutionKind.High
                        : PrinterResolutionKind.Medium
                };
            }

            printDoc.DefaultPageSettings.PrinterResolution = best;
            Console.WriteLine($"Resolution applied: Kind={best.Kind}, X={best.X}, Y={best.Y}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Resolution selection warning: {ex.Message}");
        }
    }

    private static void TrySetBitmapDpi(Bitmap bitmap, float dpiX, float dpiY)
    {
        try
        {
            bitmap.SetResolution(dpiX, dpiY);
        }
        catch
        {
            // Ignore if unsupported by driver/image source.
        }
    }

    private static string NormalizeLayout(string layout)
    {
        return (layout ?? "4x6").Trim().ToLowerInvariant() switch
        {
            "4x6" => "4x6",
            "6x4" => "6x4",
            "2x6" => "2x6",
            "6x2" => "6x2",
            _ => "4x6"
        };
    }

    private static bool Approximately(int a, int b, int tolerance = 8)
    {
        return Math.Abs(a - b) <= tolerance;
    }

    private static Dictionary<string, string> ParseArgs(string[] args)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        for (int i = 0; i < args.Length; i++)
        {
            var key = args[i];
            if (!key.StartsWith("--"))
                continue;

            var value = (i + 1 < args.Length && !args[i + 1].StartsWith("--"))
                ? args[++i]
                : "true";

            dict[key] = value;
        }

        return dict;
    }

    private static string GetOption(Dictionary<string, string> options, string key, string fallback)
    {
        return options.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value
            : fallback;
    }

    private static int ParseInt(Dictionary<string, string> options, string key, int fallback)
    {
        return options.TryGetValue(key, out var value) && int.TryParse(value, out var parsed)
            ? parsed
            : fallback;
    }

    private static bool ParseBool(Dictionary<string, string> options, string key, bool fallback)
    {
        return options.TryGetValue(key, out var value) && bool.TryParse(value, out var parsed)
            ? parsed
            : fallback;
    }
}