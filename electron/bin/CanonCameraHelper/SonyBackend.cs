using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

namespace CanonCameraHelper;

/// <summary>
/// Sony Alpha / ZV / FX cameras over USB through Sony's Camera Remote SDK.
///
/// Sony's SDK is C++, so it is reached through photuna_sony_bridge.dll (SonyBridge/),
/// which owns the SDK's callback object and exposes plain C functions. The bridge and
/// Sony's DLLs are copied into sony/ next to the helper only when both are present at
/// build time; otherwise this backend reports sdkAvailable: false.
///
/// Written from Sony's API reference and sample without a Sony camera to test against —
/// run scripts/test-camera-helper.js --hardware with a camera attached before relying
/// on it at an event.
/// </summary>
public sealed class SonyBackend : ICameraBackend
{
    private static readonly string SdkDirectory = Path.Combine(AppContext.BaseDirectory, "sony");
    private const string BridgeName = "photuna_sony_bridge.dll";

    private const int ConnectTimeoutMs = 8_000;
    private const int ValuesCapacity = 8_192;

    private static readonly (string Key, int Setting)[] ExposureSettings =
    {
        (SettingKeys.Iso, SonyBridge.SettingIso),
        (SettingKeys.ShutterSpeed, SonyBridge.SettingShutterSpeed),
        (SettingKeys.Aperture, SonyBridge.SettingAperture),
        (SettingKeys.WhiteBalance, SonyBridge.SettingWhiteBalance),
    };

    private SonyBridge? _bridge;
    private bool _initialized;
    private bool _connected;
    private string? _model;

    private bool _liveView;
    private byte[] _frameBuffer = new byte[2 * 1024 * 1024];
    private uint _lastFrameNo = uint.MaxValue;
    private long _frameCount;

    public string Name => "sony";

    private static bool SdkPresent =>
        File.Exists(Path.Combine(SdkDirectory, BridgeName)) && File.Exists(Path.Combine(SdkDirectory, "Cr_Core.dll"));

    public CameraStatus GetStatus()
    {
        var connected = _connected && _bridge is not null && _bridge.IsConnected() != 0;
        return new CameraStatus(
            SdkAvailable: SdkPresent,
            Connected: connected,
            Model: connected ? _model : null,
            BatteryPercent: connected ? TryReadBattery() : null,
            ShotsRemaining: null,
            Backend: Name);
    }

    public CameraStatus Connect()
    {
        EnsureInitialized();
        if (_connected && _bridge!.IsConnected() != 0) return GetStatus();

        var model = new char[256];
        var rc = _bridge!.Connect(model, model.Length, ConnectTimeoutMs);
        if (rc != SonyBridge.Ok)
        {
            _connected = false;
            throw rc switch
            {
                SonyBridge.NoCamera => new CameraException("NO_CAMERA", "No Sony camera found."),
                SonyBridge.CameraBusy => new CameraException("CAMERA_IN_USE",
                    "The Sony camera is being used by another app. Close Imaging Edge Desktop / Remote, then try again."),
                _ => new CameraException("CONNECT_FAILED",
                    $"The Sony camera did not accept the connection (bridge {rc}, SDK 0x{_bridge.LastSdkError():X}). " +
                    "On the camera, turn PC Remote on and set the USB connection to PC Remote."),
            };
        }

        _connected = true;
        var name = new string(model).TrimEnd('\0').Trim();
        _model = string.IsNullOrEmpty(name) ? "Sony camera" : name;
        return GetStatus();
    }

    public void Disconnect()
    {
        if (!_connected || _bridge is null) return;
        _connected = false;
        try { _bridge.Disconnect(); } catch (Exception ex) { Log($"disconnect failed: {ex.Message}"); }
    }

    public CaptureResult Capture(string destinationPath, TimeSpan timeout)
    {
        if (!_connected || _bridge is null || _bridge.IsConnected() == 0)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");

        var stopwatch = Stopwatch.StartNew();
        // Sony names the files itself, and RAW + JPEG produces two, so shots land in a
        // private folder first and only the JPEG is moved to where the booth asked.
        var workDirectory = Path.Combine(Path.GetTempPath(), "photuna-sony", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDirectory);

        try
        {
            var file = new char[1024];
            var rc = _bridge.Capture(workDirectory, file, file.Length, (int)timeout.TotalMilliseconds);
            var reported = new string(file).TrimEnd('\0');

            switch (rc)
            {
                case SonyBridge.Ok:
                    break;
                case SonyBridge.RawOnly:
                    throw new CameraException("IMAGE_NOT_JPEG",
                        "The camera saved RAW only. Set its file format to JPEG or RAW + JPEG.");
                case SonyBridge.Disconnected:
                    _connected = false;
                    throw new CameraException("DISCONNECTED", "The Sony camera was disconnected.");
                case SonyBridge.NotConnected:
                    _connected = false;
                    throw new CameraException("NOT_CONNECTED", "Camera is not connected.");
                case SonyBridge.Timeout:
                    throw new CameraException("CAPTURE_FAILED", "The Sony camera did not send the photo to the PC in time.");
                default:
                    throw new CameraException("CAPTURE_FAILED",
                        $"The Sony camera did not take the photo (bridge {rc}, SDK 0x{_bridge.LastSdkError():X}).");
            }

            var jpeg = Path.IsPathRooted(reported) ? reported : Path.Combine(workDirectory, reported);
            if (!File.Exists(jpeg))
                throw new CameraException("CAPTURE_FAILED", "The Sony camera reported a photo that is not on disk.");

            File.Move(jpeg, destinationPath, overwrite: true);
            var (width, height) = JpegInfo.ReadSize(destinationPath);

            return new CaptureResult(
                Path: destinationPath,
                Width: width,
                Height: height,
                Bytes: new FileInfo(destinationPath).Length,
                ElapsedMs: stopwatch.ElapsedMilliseconds);
        }
        finally
        {
            try { Directory.Delete(workDirectory, recursive: true); } catch { /* best effort */ }
        }
    }

    public IReadOnlyDictionary<string, SettingValue> GetSettings()
    {
        RequireConnected();
        var settings = new Dictionary<string, SettingValue>();
        foreach (var (key, setting) in ExposureSettings)
        {
            var read = ReadSetting(setting);
            if (read is null) continue;

            var allowed = read.Value.Candidates
                .Select(v => Format(setting, v))
                .Where(v => v is not null)
                .Select(v => v!)
                .Distinct()
                .ToList();
            var current = Format(setting, read.Value.Current);
            if (current is null || allowed.Count == 0) continue;
            if (!allowed.Contains(current)) allowed.Insert(0, current);

            settings[key] = new SettingValue(current, allowed);
        }
        return settings;
    }

    public IReadOnlyDictionary<string, SettingValue> SetSetting(string key, string value)
    {
        RequireConnected();
        var setting = ExposureSettings.FirstOrDefault(s => s.Key == key);
        if (setting.Key is null)
            throw new CameraException("UNKNOWN_SETTING", $"Unknown setting '{key}'.");

        var read = ReadSetting(setting.Setting)
            ?? throw new CameraException("VALUE_NOT_ALLOWED", $"The camera does not offer {key} right now.");
        var match = read.Candidates.Where(v => Format(setting.Setting, v) == value).ToList();
        if (match.Count == 0)
            throw new CameraException("VALUE_NOT_ALLOWED", $"'{value}' is not an allowed value for {key}.");
        if (!read.Writable)
            throw new CameraException("SETTING_REJECTED",
                $"The camera will not change {key} right now. Check its mode dial and that PC Remote has priority.");

        var rc = _bridge!.SetSetting(setting.Setting, match[0]);
        if (rc != SonyBridge.Ok)
            throw new CameraException("SETTING_REJECTED",
                $"The camera refused this change (bridge {rc}, SDK 0x{_bridge.LastSdkError():X}).");

        return GetSettings();
    }

    public void StartLiveView()
    {
        RequireConnected();
        var rc = _bridge!.StartLiveView();
        if (rc != SonyBridge.Ok)
            throw new CameraException("LIVE_VIEW_UNAVAILABLE",
                $"The Sony camera did not start live view (bridge {rc}, SDK 0x{_bridge.LastSdkError():X}).");
        _lastFrameNo = uint.MaxValue;
        _liveView = true;
    }

    public void StopLiveView()
    {
        if (!_liveView || _bridge is null) return;
        _liveView = false;
        try { _bridge.StopLiveView(); } catch (Exception ex) { Log($"stop live view failed: {ex.Message}"); }
    }

    public LiveViewFrame? GetLiveViewFrame()
    {
        RequireConnected();
        if (!_liveView)
            throw new CameraException("LIVE_VIEW_OFF", "Live view is not started.");

        var rc = _bridge!.LiveViewFrame(_frameBuffer, _frameBuffer.Length, out var size, out var frameNo);
        if (rc == SonyBridge.BufferTooSmall && size > _frameBuffer.Length && size <= 16 * 1024 * 1024)
        {
            _frameBuffer = new byte[size];
            rc = _bridge.LiveViewFrame(_frameBuffer, _frameBuffer.Length, out size, out frameNo);
        }
        if (rc == SonyBridge.NoFrame) return null;
        if (rc != SonyBridge.Ok || size <= 0)
            throw new CameraException("LIVE_VIEW_UNAVAILABLE",
                $"The Sony camera's live view stopped (bridge {rc}, SDK 0x{_bridge.LastSdkError():X}).");
        if (frameNo == _lastFrameNo) return null;

        _lastFrameNo = frameNo;
        return new LiveViewFrame(_frameBuffer[..size], ++_frameCount);
    }

    public void Dispose()
    {
        Disconnect();
        if (_initialized && _bridge is not null)
        {
            try { _bridge.Release(); } catch (Exception ex) { Log($"release failed: {ex.Message}"); }
            _initialized = false;
        }
    }

    // ── internals ──────────────────────────────────────────────────────────────

    private void EnsureInitialized()
    {
        if (_initialized) return;
        if (!SdkPresent)
            throw new CameraException("SDK_NOT_INSTALLED", "Sony camera support is not included in this build.");

        _bridge ??= SonyBridge.Load(SdkDirectory, BridgeName);
        var rc = _bridge.Init();
        if (rc != SonyBridge.Ok)
            throw new CameraException("SDK_NOT_INSTALLED", $"The Sony SDK did not start (bridge {rc}).");
        _initialized = true;
    }

    private void RequireConnected()
    {
        if (!_connected || _bridge is null || _bridge.IsConnected() == 0)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");
    }

    private (ulong Current, List<ulong> Candidates, bool Writable)? ReadSetting(int setting)
    {
        var buffer = new byte[ValuesCapacity];
        var rc = _bridge!.GetSetting(setting, out var current, buffer, buffer.Length, out var bytes, out var writable);
        if (rc != SonyBridge.Ok) return null;

        var width = setting is SonyBridge.SettingAperture or SonyBridge.SettingWhiteBalance ? 2 : 4;
        var candidates = new List<ulong>();
        for (var offset = 0; offset + width <= bytes; offset += width)
        {
            candidates.Add(width == 2 ? BitConverter.ToUInt16(buffer, offset) : BitConverter.ToUInt32(buffer, offset));
        }
        return (current, candidates, writable != 0);
    }

    private int? TryReadBattery()
    {
        try
        {
            var read = ReadSetting(SonyBridge.SettingBattery);
            if (read is null) return null;
            // CrBatteryLevel: 1 = nearly empty, 2..5 = quarters, 6..8 = thirds; the
            // 0x0001xxxx variants are the same levels on USB power.
            return (read.Value.Current & 0xFFFF) switch
            {
                1 => 5,
                2 => 25,
                3 => 50,
                4 => 75,
                5 => 100,
                6 => 33,
                7 => 67,
                8 => 100,
                _ => null,
            };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Formats raw values the way the booth shows them for every brand; null hides a value.</summary>
    private static string? Format(int setting, ulong raw) => setting switch
    {
        SonyBridge.SettingIso => FormatIso((uint)raw),
        SonyBridge.SettingShutterSpeed => FormatShutterSpeed((uint)raw),
        SonyBridge.SettingAperture => FormatAperture((ushort)raw),
        SonyBridge.SettingWhiteBalance => FormatWhiteBalance((ushort)raw),
        _ => null,
    };

    private static string? FormatIso(uint raw)
    {
        // bits 24-27: multi-frame noise reduction modes, which a booth does not use.
        if (((raw >> 24) & 0x0F) != 0) return null;
        var value = raw & 0x00FFFFFF;
        return value == 0x00FFFFFF ? "Auto" : value.ToString(CultureInfo.InvariantCulture);
    }

    private static string? FormatShutterSpeed(uint raw)
    {
        if (raw == 0xFFFFFFFF) return null;
        if (raw == 0) return "Bulb";
        var numerator = raw >> 16;
        var denominator = raw & 0xFFFF;
        if (denominator == 0) return null;
        if (numerator == 1) return $"1/{denominator}";
        if (numerator % denominator == 0) return $"{numerator / denominator}\"";
        return $"{numerator / denominator}.{numerator % denominator}\"";
    }

    private static string? FormatAperture(ushort raw)
    {
        if (raw == 0xFFFF) return null;
        if (raw is 0 or 0xFFFE) return "--";
        return raw % 100 == 0
            ? $"f/{raw / 100}"
            : $"f/{Math.Round(raw / 100.0, 1).ToString(CultureInfo.InvariantCulture)}";
    }

    private static string FormatWhiteBalance(ushort raw) => raw switch
    {
        0x0000 => "Auto",
        0x0001 => "Underwater auto",
        0x0011 => "Daylight",
        0x0012 => "Shade",
        0x0013 => "Cloudy",
        0x0014 => "Incandescent",
        0x0020 => "Fluorescent",
        0x0021 => "Fluorescent: warm white",
        0x0022 => "Fluorescent: cool white",
        0x0023 => "Fluorescent: day white",
        0x0024 => "Fluorescent: daylight",
        0x0030 => "Flash",
        0x0100 => "Color temperature",
        0x0101 => "Custom 1",
        0x0102 => "Custom 2",
        0x0103 => "Custom 3",
        0x0104 => "Custom",
        _ => $"0x{raw:X4}",
    };

    private static void Log(string message)
    {
        Console.Error.WriteLine($"[canon-camera-helper] sony: {message}");
        Console.Error.Flush();
    }
}

/// <summary>photuna_sony_bridge.dll loaded from a folder, with its exports bound.</summary>
internal sealed class SonyBridge
{
    public const int Ok = 0;
    public const int NoCamera = 1;
    public const int Timeout = 3;
    public const int NotConnected = 4;
    public const int RawOnly = 5;
    public const int CameraBusy = 7;
    public const int Disconnected = 8;
    public const int BufferTooSmall = 10;
    public const int NoFrame = 14;

    public const int SettingIso = 0;
    public const int SettingShutterSpeed = 1;
    public const int SettingAperture = 2;
    public const int SettingWhiteBalance = 3;
    public const int SettingBattery = 4;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int IntFn();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate void VoidFn();

    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
    public delegate int ConnectFn([Out] char[] modelOut, int modelCapacity, int timeoutMs);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
    public delegate int CaptureFn(string saveDirectory, [Out] char[] fileOut, int fileCapacity, int timeoutMs);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate int GetSettingFn(int setting, out ulong current, [Out] byte[] values, int valuesCapacity,
        out int valuesBytes, out int writable);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate int SetSettingFn(int setting, ulong value);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate int LiveViewFrameFn([Out] byte[] buffer, int capacity, out int size, out uint frameNo);

    public IntFn Init { get; }
    public VoidFn Release { get; }
    public IntFn IsConnected { get; }
    public ConnectFn Connect { get; }
    public IntFn Disconnect { get; }
    public CaptureFn Capture { get; }
    public GetSettingFn GetSetting { get; }
    public SetSettingFn SetSetting { get; }
    public IntFn LastSdkError { get; }
    public IntFn StartLiveView { get; }
    public IntFn StopLiveView { get; }
    public LiveViewFrameFn LiveViewFrame { get; }

    private SonyBridge(IntPtr library)
    {
        StartLiveView = Export<IntFn>(library, "psb_start_live_view");
        StopLiveView = Export<IntFn>(library, "psb_stop_live_view");
        LiveViewFrame = Export<LiveViewFrameFn>(library, "psb_live_view_frame");
        Init = Export<IntFn>(library, "psb_init");
        Release = Export<VoidFn>(library, "psb_release");
        IsConnected = Export<IntFn>(library, "psb_is_connected");
        Connect = Export<ConnectFn>(library, "psb_connect");
        Disconnect = Export<IntFn>(library, "psb_disconnect");
        Capture = Export<CaptureFn>(library, "psb_capture");
        GetSetting = Export<GetSettingFn>(library, "psb_get_setting");
        SetSetting = Export<SetSettingFn>(library, "psb_set_setting");
        LastSdkError = Export<IntFn>(library, "psb_last_sdk_error");
    }

    public static SonyBridge Load(string directory, string bridgeName)
    {
        try
        {
            // Cr_Core.dll and its CrAdapter folder sit beside the bridge.
            SetDllDirectoryW(directory);
            return new SonyBridge(NativeLibrary.Load(Path.Combine(directory, bridgeName)));
        }
        catch (Exception ex) when (ex is DllNotFoundException or BadImageFormatException or EntryPointNotFoundException)
        {
            throw new CameraException("SDK_NOT_INSTALLED", $"The Sony SDK could not be loaded ({ex.Message}).");
        }
    }

    private static T Export<T>(IntPtr library, string name) where T : Delegate =>
        Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library, name));

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetDllDirectoryW(string path);
}
