using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;

namespace CanonCameraHelper;

/// <summary>
/// A pretend camera for development and automated tests only. It lets the booth's
/// capture path, timeouts, restarts and webcam fallback be exercised without any
/// hardware.
///
/// It is chosen only by the <c>--simulate</c> argument, which the app passes only
/// when the developer sets PHOTUNA_CAMERA_SIMULATOR=1, so an operator can never
/// select it.
///
/// PHOTUNA_CAMERA_SIM_FAIL injects the failures real cameras have:
///   connect         no camera found
///   capture         shutter does not fire
///   focus           autofocus fails (the most common real-world failure)
///   hang            the call never returns — tests the app's kill-and-restart
///   crash           the helper process dies mid-capture
///   unplug-after-2  third and later captures fail as if the cable was pulled
/// </summary>
public sealed class SimulatedBackend : ICameraBackend
{
    private const int FullWidth = 6000;
    private const int FullHeight = 4000;

    private readonly Dictionary<string, SettingValue> _settings = new()
    {
        [SettingKeys.Iso] = new("400", new[] { "100", "200", "400", "800", "1600", "3200" }),
        [SettingKeys.ShutterSpeed] = new("1/125", new[] { "1/60", "1/100", "1/125", "1/160", "1/200" }),
        [SettingKeys.Aperture] = new("f/5.6", new[] { "f/2.8", "f/4", "f/5.6", "f/8", "f/11" }),
        [SettingKeys.WhiteBalance] = new("auto", new[] { "auto", "daylight", "cloudy", "tungsten", "flash" }),
    };

    private readonly string _failMode =
        Environment.GetEnvironmentVariable("PHOTUNA_CAMERA_SIM_FAIL")?.Trim().ToLowerInvariant() ?? "";

    private bool _connected;
    private int _captureCount;

    public string Name => "simulator";

    public CameraStatus GetStatus() => new(
        SdkAvailable: true,
        Connected: _connected,
        Model: _connected ? "Simulated EOS" : null,
        BatteryPercent: _connected ? 87 : null,
        ShotsRemaining: _connected ? 999 : null,
        Backend: Name);

    public CameraStatus Connect()
    {
        if (_failMode == "connect")
            throw new CameraException("NO_CAMERA", "No camera detected (simulated).");

        _connected = true;
        return GetStatus();
    }

    public void Disconnect() => _connected = false;

    public CaptureResult Capture(string destinationPath, TimeSpan timeout)
    {
        if (!_connected)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");

        _captureCount++;

        switch (_failMode)
        {
            case "capture":
                throw new CameraException("CAPTURE_FAILED", "Shutter did not fire (simulated).");
            case "focus":
                throw new CameraException("FOCUS_FAILED", "Camera could not focus (simulated).");
            case "hang":
                Thread.Sleep(timeout + TimeSpan.FromSeconds(30));
                break;
            case "crash":
                Environment.FailFast("Simulated native crash during capture.");
                break;
            case "unplug-after-2" when _captureCount > 2:
                _connected = false;
                throw new CameraException("DISCONNECTED", "Camera was disconnected (simulated).");
        }

        var stopwatch = Stopwatch.StartNew();

        using (var bitmap = new Bitmap(FullWidth, FullHeight))
        using (var graphics = Graphics.FromImage(bitmap))
        using (var font = new Font("Segoe UI", 150, FontStyle.Bold))
        {
            graphics.Clear(Color.FromArgb(38, 42, 52));
            var label =
                $"SIMULATED CAPTURE #{_captureCount}\n" +
                $"ISO {_settings[SettingKeys.Iso].Current}   " +
                $"{_settings[SettingKeys.ShutterSpeed].Current}   " +
                $"{_settings[SettingKeys.Aperture].Current}";
            graphics.DrawString(label, font, Brushes.White, 240, 1500);
            SaveJpeg(bitmap, destinationPath, quality: 90);
        }

        return new CaptureResult(
            Path: destinationPath,
            Width: FullWidth,
            Height: FullHeight,
            Bytes: new FileInfo(destinationPath).Length,
            ElapsedMs: stopwatch.ElapsedMilliseconds);
    }

    public IReadOnlyDictionary<string, SettingValue> GetSettings() =>
        new Dictionary<string, SettingValue>(_settings);

    public IReadOnlyDictionary<string, SettingValue> SetSetting(string key, string value)
    {
        if (!_connected)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");

        if (!_settings.TryGetValue(key, out var setting))
            throw new CameraException("UNKNOWN_SETTING", $"Unknown setting '{key}'.");

        if (!setting.Allowed.Contains(value))
            throw new CameraException("VALUE_NOT_ALLOWED", $"'{value}' is not an allowed value for {key}.");

        _settings[key] = setting with { Current = value };
        return GetSettings();
    }

    public void Dispose()
    {
    }

    private static void SaveJpeg(Image image, string path, long quality)
    {
        var encoder = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        image.Save(path, encoder, parameters);
    }
}
