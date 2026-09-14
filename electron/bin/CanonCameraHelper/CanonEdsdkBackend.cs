using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace CanonCameraHelper;

/// <summary>
/// Canon EOS cameras through Canon's EOS Digital SDK (EDSDK).
///
/// EDSDK.dll and EdsImage.dll are copied next to the helper, into canon/, only when
/// the business's SDK is present under sdk/canon at build time (see the csproj);
/// otherwise this backend reports sdkAvailable: false.
///
/// The helper has no Windows message loop, so, as Canon's reference says for console
/// applications, camera events are fetched by calling EdsGetEvent regularly: while
/// waiting for a photo, before each live view frame, and on every status check.
/// </summary>
public sealed class CanonBackend : ICameraBackend
{
    private static readonly string SdkDirectory = Path.Combine(AppContext.BaseDirectory, "canon");
    private static readonly TimeSpan RawOnlyGrace = TimeSpan.FromSeconds(3);
    private const int MaxImageBytes = 200 * 1024 * 1024;

    private static readonly (string Key, uint Property)[] ExposureSettings =
    {
        (SettingKeys.Iso, CanonSdk.PropIsoSpeed),
        (SettingKeys.ShutterSpeed, CanonSdk.PropTv),
        (SettingKeys.Aperture, CanonSdk.PropAv),
        (SettingKeys.WhiteBalance, CanonSdk.PropWhiteBalance),
    };

    // Kept in fields for the life of the process: the SDK holds the function pointers.
    private readonly CanonSdk.ObjectEventHandler _objectHandler;
    private readonly CanonSdk.StateEventHandler _stateHandler;

    private readonly object _eventLock = new();
    private readonly List<IntPtr> _transfers = new();
    private bool _captureError;
    private bool _shutdown;
    private bool _extendShutDown;

    private CanonNative? _sdk;
    private bool _initialized;
    private IntPtr _camera;
    private bool _connected;
    private string? _model;
    private bool _liveView;
    private long _frameNo;

    public CanonBackend()
    {
        _objectHandler = OnObjectEvent;
        _stateHandler = OnStateEvent;
    }

    public string Name => "canon";

    private static bool SdkPresent => File.Exists(Path.Combine(SdkDirectory, CanonNative.LibraryName));

    public CameraStatus GetStatus()
    {
        if (_connected) PumpEvents();
        return new CameraStatus(
            SdkAvailable: SdkPresent,
            Connected: _connected,
            Model: _connected ? _model : null,
            BatteryPercent: _connected ? TryReadBattery() : null,
            ShotsRemaining: null,
            Backend: Name);
    }

    public CameraStatus Connect()
    {
        EnsureInitialized();
        if (_connected)
        {
            PumpEvents();
            if (_connected) return GetStatus();
        }

        var sdk = _sdk!;
        var rc = sdk.GetCameraList(out var list);
        if (rc != CanonSdk.Ok || list == IntPtr.Zero)
            throw new CameraException("NO_CAMERA", $"No Canon camera found (EDSDK 0x{rc:X}).");

        var camera = IntPtr.Zero;
        try
        {
            rc = sdk.GetChildCount(list, out var count);
            if (rc != CanonSdk.Ok || count <= 0)
                throw new CameraException("NO_CAMERA", "No Canon camera found.");
            rc = sdk.GetChildAtIndex(list, 0, out camera);
            if (rc != CanonSdk.Ok || camera == IntPtr.Zero)
                throw new CameraException("NO_CAMERA", "No Canon camera found.");
        }
        finally
        {
            sdk.Release(list);
        }

        try
        {
            var model = ReadDeviceDescription(sdk, camera);

            sdk.SetObjectEventHandler(camera, CanonSdk.ObjectEventAll,
                Marshal.GetFunctionPointerForDelegate(_objectHandler), IntPtr.Zero);
            sdk.SetCameraStateEventHandler(camera, CanonSdk.StateEventAll,
                Marshal.GetFunctionPointerForDelegate(_stateHandler), IntPtr.Zero);

            rc = sdk.OpenSession(camera);
            if (rc != CanonSdk.Ok)
            {
                // COMM_PORT_IS_IN_USE: another process already has a session with this
                // camera — another Photuna window, EOS Utility or EOS Webcam Utility.
                throw rc is CanonSdk.ErrDeviceBusy or CanonSdk.ErrPtpDeviceBusy or CanonSdk.ErrCommPortIsInUse
                    ? new CameraException("CAMERA_IN_USE",
                        "The Canon camera is being used by another app. Close other Photuna windows, EOS Utility and EOS Webcam Utility, then try again.")
                    : Map(rc, "CONNECT_FAILED", "The Canon camera did not accept the connection");
            }

            _camera = camera;
            camera = IntPtr.Zero;
            _connected = true;
            _liveView = false;
            lock (_eventLock) { _shutdown = false; _captureError = false; }
            _model = string.IsNullOrWhiteSpace(model) ? "Canon camera" : model;

            // Send photos to the PC. The SDK checks free space on the host before
            // shooting, so report plenty — as Canon's sample does.
            var saveTo = SetUInt(CanonSdk.PropSaveTo, CanonSdk.SaveToHost);
            if (saveTo == CanonSdk.Ok)
            {
                var capacity = new CanonSdk.Capacity { NumberOfFreeClusters = 0x7FFFFFFF, BytesPerSector = 0x1000, Reset = 1 };
                var capacityRc = sdk.SetCapacity(_camera, capacity);
                if (capacityRc != CanonSdk.Ok) Log($"SetCapacity answered 0x{capacityRc:X}");
            }
            else
            {
                Log($"could not set SaveTo=Host (0x{saveTo:X}); photos may only go to the card");
            }

            return GetStatus();
        }
        finally
        {
            if (camera != IntPtr.Zero) sdk.Release(camera);
        }
    }

    public void Disconnect()
    {
        if (_sdk is null || _camera == IntPtr.Zero)
        {
            _connected = false;
            return;
        }

        try { StopLiveView(); } catch (Exception ex) { Log($"stop live view on disconnect failed: {ex.Message}"); }
        ReleaseTransfers(cancel: true);
        try { _sdk.CloseSession(_camera); } catch (Exception ex) { Log($"CloseSession failed: {ex.Message}"); }
        ReleaseCamera();
    }

    public CaptureResult Capture(string destinationPath, TimeSpan timeout)
    {
        RequireConnected();
        var sdk = _sdk!;
        var stopwatch = Stopwatch.StartNew();

        PumpEvents();
        ReleaseTransfers(cancel: true);
        lock (_eventLock) _captureError = false;

        // Full press with autofocus, then release — as Canon's sample does.
        var rc = sdk.SendCommand(_camera, CanonSdk.CommandPressShutterButton, CanonSdk.ShutterButtonCompletely);
        if (rc is CanonSdk.ErrDeviceBusy)
        {
            Thread.Sleep(300);
            PumpEvents();
            rc = sdk.SendCommand(_camera, CanonSdk.CommandPressShutterButton, CanonSdk.ShutterButtonCompletely);
        }
        var released = sdk.SendCommand(_camera, CanonSdk.CommandPressShutterButton, CanonSdk.ShutterButtonOff);
        if (rc != CanonSdk.Ok) throw MapShot(rc);
        if (released != CanonSdk.Ok) Log($"shutter release answered 0x{released:X}");

        DateTime? rawOnlySince = null;
        while (true)
        {
            PumpEvents();
            if (!_connected)
                throw new CameraException("DISCONNECTED", "The Canon camera was disconnected.");

            bool captureError;
            List<IntPtr> transfers;
            lock (_eventLock)
            {
                captureError = _captureError;
                transfers = new List<IntPtr>(_transfers);
                _transfers.Clear();
            }

            for (var i = 0; i < transfers.Count; i++)
            {
                var item = transfers[i];
                var (name, size) = ReadDirectoryItem(sdk, item);
                if (IsJpeg(name))
                {
                    try
                    {
                        DownloadTo(sdk, item, size, destinationPath);
                    }
                    finally
                    {
                        sdk.Release(item);
                        for (var j = i + 1; j < transfers.Count; j++) CancelAndRelease(sdk, transfers[j]);
                    }

                    var (width, height) = JpegInfo.ReadSize(destinationPath);
                    return new CaptureResult(
                        Path: destinationPath,
                        Width: width,
                        Height: height,
                        Bytes: new FileInfo(destinationPath).Length,
                        ElapsedMs: stopwatch.ElapsedMilliseconds);
                }

                // RAW (CR3/CR2) or HEIF: not usable by the booth. RAW + JPEG sends the
                // JPEG as its own transfer.
                CancelAndRelease(sdk, item);
                rawOnlySince ??= DateTime.UtcNow;
            }

            if (captureError)
                throw new CameraException("CAPTURE_FAILED", "The Canon camera could not take the photo.");
            if (rawOnlySince is not null && DateTime.UtcNow - rawOnlySince > RawOnlyGrace)
                throw new CameraException("IMAGE_NOT_JPEG",
                    "The camera saved RAW or HEIF only. Set its image quality to JPEG or RAW + JPEG.");
            if (stopwatch.Elapsed > timeout)
                throw new CameraException("CAPTURE_FAILED", "The Canon camera did not send the photo to the PC in time.");

            Thread.Sleep(50);
        }
    }

    public IReadOnlyDictionary<string, SettingValue> GetSettings()
    {
        RequireConnected();
        PumpEvents();

        var settings = new Dictionary<string, SettingValue>();
        foreach (var (key, property) in ExposureSettings)
        {
            if (!TryGetUInt(property, out var current)) continue;

            var allowed = ReadAllowedCodes(property)
                .Select(code => CanonValues.Format(key, code))
                .Where(label => label is not null)
                .Select(label => label!)
                .Distinct()
                .ToList();
            var currentLabel = CanonValues.Format(key, current) ?? $"0x{current:X}";
            if (!allowed.Contains(currentLabel)) allowed.Insert(0, currentLabel);

            settings[key] = new SettingValue(currentLabel, allowed);
        }
        return settings;
    }

    public IReadOnlyDictionary<string, SettingValue> SetSetting(string key, string value)
    {
        RequireConnected();
        var property = ExposureSettings.FirstOrDefault(s => s.Key == key).Property;
        if (property == 0)
            throw new CameraException("UNKNOWN_SETTING", $"Unknown setting '{key}'.");

        var code = ReadAllowedCodes(property).Cast<uint?>()
            .FirstOrDefault(c => CanonValues.Format(key, c!.Value) == value);
        if (code is null)
            throw new CameraException("VALUE_NOT_ALLOWED", $"'{value}' is not an allowed value for {key}.");

        var rc = SetUInt(property, code.Value);
        if (rc != CanonSdk.Ok)
            throw new CameraException("SETTING_REJECTED",
                $"The camera refused this change (EDSDK 0x{rc:X}). Its mode dial may be locking {key}.");

        PumpEvents();
        return GetSettings();
    }

    public void StartLiveView()
    {
        RequireConnected();
        PumpEvents();

        if (TryGetUInt(CanonSdk.PropEvfMode, out var mode) && mode == 0)
            SetUInt(CanonSdk.PropEvfMode, 1);

        TryGetUInt(CanonSdk.PropEvfOutputDevice, out var device);
        var rc = SetUInt(CanonSdk.PropEvfOutputDevice, device | CanonSdk.EvfOutputDevicePc);
        if (rc != CanonSdk.Ok)
            throw new CameraException("LIVE_VIEW_UNAVAILABLE", $"The Canon camera did not start live view (EDSDK 0x{rc:X}).");
        _liveView = true;
    }

    public void StopLiveView()
    {
        if (!_liveView) return;
        _liveView = false;
        if (!_connected) return;
        if (TryGetUInt(CanonSdk.PropEvfOutputDevice, out var device))
        {
            var rc = SetUInt(CanonSdk.PropEvfOutputDevice, device & ~CanonSdk.EvfOutputDevicePc);
            if (rc != CanonSdk.Ok) Log($"stopping live view answered 0x{rc:X}");
        }
    }

    public LiveViewFrame? GetLiveViewFrame()
    {
        RequireConnected();
        if (!_liveView)
            throw new CameraException("LIVE_VIEW_OFF", "Live view is not started.");

        PumpEvents();
        if (!_connected)
            throw new CameraException("DISCONNECTED", "The Canon camera was disconnected.");

        var sdk = _sdk!;
        var stream = IntPtr.Zero;
        var evfImage = IntPtr.Zero;
        try
        {
            var rc = sdk.CreateMemoryStream(0, out stream);
            if (rc == CanonSdk.Ok) rc = sdk.CreateEvfImageRef(stream, out evfImage);
            if (rc == CanonSdk.Ok) rc = sdk.DownloadEvfImage(_camera, evfImage);

            // The first frames after starting live view are not ready yet.
            if (rc is CanonSdk.ErrObjectNotReady or CanonSdk.ErrDeviceBusy) return null;
            if (rc != CanonSdk.Ok)
                throw new CameraException("LIVE_VIEW_UNAVAILABLE", $"The Canon camera's live view stopped (EDSDK 0x{rc:X}).");

            var bytes = ReadStream(sdk, stream);
            if (bytes is null || bytes.Length < 3 || bytes[0] != 0xFF || bytes[1] != 0xD8) return null;
            return new LiveViewFrame(bytes, ++_frameNo);
        }
        finally
        {
            if (evfImage != IntPtr.Zero) sdk.Release(evfImage);
            if (stream != IntPtr.Zero) sdk.Release(stream);
        }
    }

    public void Dispose()
    {
        Disconnect();
        if (_initialized && _sdk is not null)
        {
            try { _sdk.TerminateSdk(); } catch (Exception ex) { Log($"EdsTerminateSDK failed: {ex.Message}"); }
            _initialized = false;
        }
    }

    // ── setup and events ───────────────────────────────────────────────────────

    private void EnsureInitialized()
    {
        if (_initialized) return;
        if (!SdkPresent)
            throw new CameraException("SDK_NOT_INSTALLED", "Canon camera support is not included in this build.");

        _sdk ??= CanonNative.Load(SdkDirectory);
        var rc = _sdk.InitializeSdk();
        if (rc != CanonSdk.Ok)
            throw new CameraException("SDK_NOT_INSTALLED", $"The Canon SDK did not start (EDSDK 0x{rc:X}).");
        _initialized = true;
    }

    private void RequireConnected()
    {
        if (!_connected || _sdk is null || _camera == IntPtr.Zero)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");
    }

    /// <summary>Delivers queued camera events to the handlers below, on this thread.</summary>
    private void PumpEvents()
    {
        if (_sdk is null || _camera == IntPtr.Zero) return;
        try { _sdk.GetEvent(); } catch (Exception ex) { Log($"EdsGetEvent failed: {ex.Message}"); }

        bool shutdown, extend;
        lock (_eventLock)
        {
            shutdown = _shutdown;
            extend = _extendShutDown;
            _extendShutDown = false;
        }

        if (shutdown)
        {
            Log("camera shut down or was disconnected");
            ReleaseTransfers(cancel: false);
            ReleaseCamera();
            return;
        }

        // Keep the camera from powering off between guests.
        if (extend) _sdk.SendCommand(_camera, CanonSdk.CommandExtendShutDownTimer, 0);
    }

    private uint OnObjectEvent(uint eventId, IntPtr reference, IntPtr context)
    {
        try
        {
            if (eventId == CanonSdk.ObjectEventDirItemRequestTransfer && reference != IntPtr.Zero)
            {
                lock (_eventLock) _transfers.Add(reference);
            }
            else if (reference != IntPtr.Zero)
            {
                _sdk?.Release(reference);
            }
        }
        catch (Exception ex)
        {
            Log($"object event 0x{eventId:X} handling failed: {ex.Message}");
        }
        return CanonSdk.Ok;
    }

    private uint OnStateEvent(uint eventId, uint parameter, IntPtr context)
    {
        lock (_eventLock)
        {
            switch (eventId)
            {
                case CanonSdk.StateEventShutdown:
                    _shutdown = true;
                    break;
                case CanonSdk.StateEventWillSoonShutDown:
                    _extendShutDown = true;
                    break;
                case CanonSdk.StateEventCaptureError:
                    _captureError = true;
                    break;
            }
        }
        return CanonSdk.Ok;
    }

    private void ReleaseCamera()
    {
        if (_sdk is not null && _camera != IntPtr.Zero)
        {
            try { _sdk.Release(_camera); } catch { /* already gone */ }
        }
        _camera = IntPtr.Zero;
        _connected = false;
        _liveView = false;
        lock (_eventLock) _shutdown = false;
    }

    private void ReleaseTransfers(bool cancel)
    {
        if (_sdk is null) return;
        List<IntPtr> pending;
        lock (_eventLock)
        {
            pending = new List<IntPtr>(_transfers);
            _transfers.Clear();
        }
        foreach (var item in pending)
        {
            if (cancel) CancelAndRelease(_sdk, item);
            else _sdk.Release(item);
        }
    }

    private static void CancelAndRelease(CanonNative sdk, IntPtr item)
    {
        try { sdk.DownloadCancel(item); } catch { /* best effort */ }
        try { sdk.Release(item); } catch { /* best effort */ }
    }

    // ── data ───────────────────────────────────────────────────────────────────

    private static void DownloadTo(CanonNative sdk, IntPtr item, ulong size, string destinationPath)
    {
        if (size == 0 || size > MaxImageBytes)
            throw new CameraException("CAPTURE_FAILED", $"The camera reported an unexpected photo size ({size} bytes).");

        var rc = sdk.CreateMemoryStream(size, out var stream);
        if (rc != CanonSdk.Ok)
            throw new CameraException("CAPTURE_FAILED", $"Could not prepare the photo download (EDSDK 0x{rc:X}).");
        try
        {
            rc = sdk.Download(item, size, stream);
            if (rc != CanonSdk.Ok)
            {
                sdk.DownloadCancel(item);
                throw Map(rc, "CAPTURE_FAILED", "The photo could not be downloaded from the camera");
            }
            rc = sdk.DownloadComplete(item);
            if (rc != CanonSdk.Ok)
                throw Map(rc, "CAPTURE_FAILED", "The photo download did not finish");

            var bytes = ReadStream(sdk, stream)
                ?? throw new CameraException("CAPTURE_FAILED", "The camera sent an empty photo.");
            File.WriteAllBytes(destinationPath, bytes);
        }
        finally
        {
            sdk.Release(stream);
        }
    }

    private static byte[]? ReadStream(CanonNative sdk, IntPtr stream)
    {
        if (sdk.GetPointer(stream, out var pointer) != CanonSdk.Ok || pointer == IntPtr.Zero) return null;
        if (sdk.GetLength(stream, out var length) != CanonSdk.Ok || length == 0 || length > MaxImageBytes) return null;
        var bytes = new byte[(int)length];
        Marshal.Copy(pointer, bytes, 0, (int)length);
        return bytes;
    }

    private static (string Name, ulong Size) ReadDirectoryItem(CanonNative sdk, IntPtr item)
    {
        var buffer = Marshal.AllocHGlobal(CanonSdk.DirectoryItemInfoSize);
        try
        {
            Marshal.Copy(new byte[CanonSdk.DirectoryItemInfoSize], 0, buffer, CanonSdk.DirectoryItemInfoSize);
            if (sdk.GetDirectoryItemInfo(item, buffer) != CanonSdk.Ok) return ("", 0);
            var size = (ulong)Marshal.ReadInt64(buffer, 0);
            var name = ReadAnsi(buffer + CanonSdk.DirectoryItemFileNameOffset, CanonSdk.NameLength);
            return (name, size);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string ReadDeviceDescription(CanonNative sdk, IntPtr camera)
    {
        var buffer = Marshal.AllocHGlobal(CanonSdk.DeviceInfoSize);
        try
        {
            Marshal.Copy(new byte[CanonSdk.DeviceInfoSize], 0, buffer, CanonSdk.DeviceInfoSize);
            if (sdk.GetDeviceInfo(camera, buffer) != CanonSdk.Ok) return "";
            return ReadAnsi(buffer + CanonSdk.DeviceInfoDescriptionOffset, CanonSdk.NameLength);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private bool TryGetUInt(uint property, out uint value)
    {
        value = 0;
        var buffer = Marshal.AllocHGlobal(sizeof(uint));
        try
        {
            if (_sdk!.GetPropertyData(_camera, property, 0, sizeof(uint), buffer) != CanonSdk.Ok) return false;
            value = (uint)Marshal.ReadInt32(buffer);
            return true;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private uint SetUInt(uint property, uint value)
    {
        var buffer = Marshal.AllocHGlobal(sizeof(uint));
        try
        {
            Marshal.WriteInt32(buffer, (int)value);
            return _sdk!.SetPropertyData(_camera, property, 0, sizeof(uint), buffer);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private List<uint> ReadAllowedCodes(uint property)
    {
        var codes = new List<uint>();
        var buffer = Marshal.AllocHGlobal(CanonSdk.PropertyDescSize);
        try
        {
            Marshal.Copy(new byte[CanonSdk.PropertyDescSize], 0, buffer, CanonSdk.PropertyDescSize);
            if (_sdk!.GetPropertyDesc(_camera, property, buffer) != CanonSdk.Ok) return codes;
            var count = Math.Clamp(Marshal.ReadInt32(buffer, CanonSdk.PropertyDescCountOffset), 0, CanonSdk.PropertyDescMaxValues);
            for (var i = 0; i < count; i++)
                codes.Add((uint)Marshal.ReadInt32(buffer, CanonSdk.PropertyDescValuesOffset + i * sizeof(int)));
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
        return codes;
    }

    private int? TryReadBattery()
    {
        try
        {
            // 0–100 on battery; 0xFFFFFFFF when powered by an AC adapter.
            return TryGetUInt(CanonSdk.PropBatteryLevel, out var level) && level <= 100 ? (int)level : null;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsJpeg(string name)
    {
        var extension = Path.GetExtension(name);
        return extension.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".jpeg", StringComparison.OrdinalIgnoreCase);
    }

    private static string ReadAnsi(IntPtr pointer, int maxBytes)
    {
        var bytes = new byte[maxBytes];
        Marshal.Copy(pointer, bytes, 0, maxBytes);
        var end = Array.IndexOf(bytes, (byte)0);
        return Encoding.Latin1.GetString(bytes, 0, end < 0 ? maxBytes : end).Trim();
    }

    private static CameraException MapShot(uint rc) => rc switch
    {
        CanonSdk.ErrTakePictureAfNg => new("FOCUS_FAILED", "The camera could not focus."),
        CanonSdk.ErrTakePictureStroboChargeNg => new("CAPTURE_FAILED", "The flash is still charging."),
        CanonSdk.ErrTakePictureNoCardNg or CanonSdk.ErrTakePictureCardNg =>
            new("CAPTURE_FAILED", "The camera will not shoot without a working memory card. Insert one and check it is not locked."),
        CanonSdk.ErrTakePictureLvRelProhibitModeNg =>
            new("CAPTURE_FAILED", "The camera's current mode does not allow shooting from the PC."),
        _ => Map(rc, "CAPTURE_FAILED", "The Canon camera did not take the photo"),
    };

    private static CameraException Map(uint rc, string fallbackCode, string context) => rc switch
    {
        CanonSdk.ErrDeviceNotFound or CanonSdk.ErrDeviceInvalid or CanonSdk.ErrCommDisconnected
            or CanonSdk.ErrCommUsbBusErr or CanonSdk.ErrSessionNotOpen
            => new("DISCONNECTED", "The Canon camera was disconnected."),
        CanonSdk.ErrDeviceBusy or CanonSdk.ErrPtpDeviceBusy => new("CAPTURE_FAILED", "The Canon camera is busy."),
        _ => new(fallbackCode, $"{context} (EDSDK 0x{rc:X})."),
    };

    private static void Log(string message)
    {
        Console.Error.WriteLine($"[canon-camera-helper] canon: {message}");
        Console.Error.Flush();
    }
}

/// <summary>
/// EDSDK property codes as the booth shows them, from Canon's API reference
/// (kEdsPropID_ISOSpeed, kEdsPropID_Av, kEdsPropID_Tv, EdsWhiteBalance). Codes missing
/// here are not offered.
/// </summary>
internal static class CanonValues
{
    private static readonly Dictionary<uint, string> Iso = new()
    {
        [0x00] = "Auto", [0x28] = "6", [0x30] = "12", [0x38] = "25", [0x40] = "50", [0x48] = "100",
        [0x4b] = "125", [0x4d] = "160", [0x50] = "200", [0x53] = "250", [0x55] = "320", [0x58] = "400",
        [0x5b] = "500", [0x5d] = "640", [0x60] = "800", [0x63] = "1000", [0x65] = "1250", [0x68] = "1600",
        [0x6b] = "2000", [0x6d] = "2500", [0x70] = "3200", [0x73] = "4000", [0x75] = "5000", [0x78] = "6400",
        [0x7b] = "8000", [0x7d] = "10000", [0x80] = "12800", [0x83] = "16000", [0x85] = "20000",
        [0x88] = "25600", [0x8b] = "32000", [0x8d] = "40000", [0x90] = "51200", [0x93] = "64000",
        [0x95] = "80000", [0x98] = "102400", [0xa0] = "204800", [0xa8] = "409600", [0xb0] = "819200",
    };

    // "(1/3)" variants in Canon's table belong to the 1/3-stop setting; only one of
    // each pair is ever offered at a time, so they share a label.
    private static readonly Dictionary<uint, string> Aperture = new()
    {
        [0x08] = "1", [0x0B] = "1.1", [0x0C] = "1.2", [0x0D] = "1.2", [0x10] = "1.4", [0x13] = "1.6",
        [0x14] = "1.8", [0x15] = "1.8", [0x18] = "2", [0x1B] = "2.2", [0x1C] = "2.5", [0x1D] = "2.5",
        [0x20] = "2.8", [0x23] = "3.2", [0x85] = "3.4", [0x24] = "3.5", [0x25] = "3.5", [0x28] = "4",
        [0x2B] = "4.5", [0x2C] = "4.5", [0x2D] = "5.0", [0x30] = "5.6", [0x33] = "6.3", [0x34] = "6.7",
        [0x35] = "7.1", [0x38] = "8", [0x3B] = "9", [0x3C] = "9.5", [0x3D] = "10", [0x40] = "11",
        [0x43] = "13", [0x44] = "13", [0x45] = "14", [0x48] = "16", [0x4B] = "18", [0x4C] = "19",
        [0x4D] = "20", [0x50] = "22", [0x53] = "25", [0x54] = "27", [0x55] = "29", [0x58] = "32",
        [0x5B] = "36", [0x5C] = "38", [0x5D] = "40", [0x60] = "45", [0x63] = "51", [0x64] = "54",
        [0x65] = "57", [0x68] = "64", [0x6B] = "72", [0x6C] = "76", [0x6D] = "80", [0x70] = "91",
    };

    // Bulb (0x0C) is left out: Canon does not allow setting it from a computer.
    private static readonly Dictionary<uint, string> Shutter = new()
    {
        [0x10] = "30\"", [0x13] = "25\"", [0x14] = "20\"", [0x15] = "20\"", [0x18] = "15\"", [0x1B] = "13\"",
        [0x1C] = "10\"", [0x1D] = "10\"", [0x20] = "8\"", [0x23] = "6\"", [0x24] = "6\"", [0x25] = "5\"",
        [0x28] = "4\"", [0x2B] = "3.2\"", [0x2C] = "3\"", [0x2D] = "2.5\"", [0x30] = "2\"", [0x33] = "1.6\"",
        [0x34] = "1.5\"", [0x35] = "1.3\"", [0x38] = "1\"", [0x3B] = "0.8\"", [0x3C] = "0.7\"", [0x3D] = "0.6\"",
        [0x40] = "0.5\"", [0x43] = "0.4\"", [0x44] = "0.3\"", [0x45] = "0.3\"", [0x48] = "1/4", [0x4B] = "1/5",
        [0x4C] = "1/6", [0x4D] = "1/6", [0x50] = "1/8", [0x53] = "1/10", [0x54] = "1/10", [0x55] = "1/13",
        [0x58] = "1/15", [0x5B] = "1/20", [0x5C] = "1/20", [0x5D] = "1/25", [0x60] = "1/30", [0x63] = "1/40",
        [0x64] = "1/45", [0x65] = "1/50", [0x68] = "1/60", [0x6B] = "1/80", [0x6C] = "1/90", [0x6D] = "1/100",
        [0x70] = "1/125", [0x73] = "1/160", [0x74] = "1/180", [0x75] = "1/200", [0x78] = "1/250",
        [0x7B] = "1/320", [0x7C] = "1/350", [0x7D] = "1/400", [0x80] = "1/500", [0x83] = "1/640",
        [0x84] = "1/750", [0x85] = "1/800", [0x88] = "1/1000", [0x8B] = "1/1250", [0x8C] = "1/1500",
        [0x8D] = "1/1600", [0x90] = "1/2000", [0x93] = "1/2500", [0x94] = "1/3000", [0x95] = "1/3200",
        [0x98] = "1/4000", [0x9B] = "1/5000", [0x9C] = "1/6000", [0x9D] = "1/6400", [0xA0] = "1/8000",
        [0xA3] = "1/10000", [0xA5] = "1/12800", [0xA8] = "1/16000", [0xAB] = "1/20000", [0xAD] = "1/25600",
        [0xB0] = "1/32000",
    };

    private static readonly Dictionary<uint, string> WhiteBalance = new()
    {
        [0] = "Auto", [1] = "Daylight", [2] = "Cloudy", [3] = "Tungsten", [4] = "Fluorescent", [5] = "Flash",
        [6] = "Custom", [8] = "Shade", [9] = "Color temperature", [10] = "PC-1", [11] = "PC-2", [12] = "PC-3",
        [15] = "Custom 2", [16] = "Custom 3", [18] = "Custom 4", [19] = "Custom 5", [20] = "PC-4", [21] = "PC-5",
        [23] = "Auto (white priority)",
    };

    public static string? Format(string key, uint code) => key switch
    {
        SettingKeys.Iso => Iso.TryGetValue(code, out var iso) ? iso : null,
        SettingKeys.Aperture => Aperture.TryGetValue(code, out var av) ? $"f/{av}" : null,
        SettingKeys.ShutterSpeed => Shutter.TryGetValue(code, out var tv) ? tv : null,
        SettingKeys.WhiteBalance => WhiteBalance.TryGetValue(code, out var wb) ? wb : null,
        _ => null,
    };
}
