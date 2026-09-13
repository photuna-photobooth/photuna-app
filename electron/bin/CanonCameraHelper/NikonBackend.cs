using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace CanonCameraHelper;

/// <summary>
/// Nikon Z-series cameras through Nikon's Remote SDK v2 (simplified API).
///
/// The SDK files are copied next to the helper, into nikon/, only when the business's
/// SDK is present under sdk/ at build time (see the csproj). Without them this backend
/// reports sdkAvailable: false and the booth keeps using the webcam.
///
/// Written from Nikon's documentation and sample program without a Nikon camera to
/// test against — run scripts/test-camera-helper.js --hardware with a Z body attached
/// before relying on it at an event.
/// </summary>
public sealed class NikonBackend : ICameraBackend
{
    private static readonly string SdkDirectory = Path.Combine(AppContext.BaseDirectory, "nikon");

    // Nikon's readme: these profiles must be in %LOCALAPPDATA%\Nikon\NXTether.
    private static readonly string[] ProfileFiles = { "DC_PTP_Config.config", "MaidLayer.config", "RangeValue.config" };

    private static readonly (string Key, uint Capability)[] ExposureSettings =
    {
        (SettingKeys.Iso, NikonSdk.CapSensitivity),
        (SettingKeys.ShutterSpeed, NikonSdk.CapShutterSpeed),
        (SettingKeys.Aperture, NikonSdk.CapAperture),
        (SettingKeys.WhiteBalance, NikonSdk.CapWbMode),
    };

    private static readonly TimeSpan DeviceDiscoveryWait = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan RawOnlyGrace = TimeSpan.FromSeconds(2);

    // Kept in fields for the life of the process: the SDK holds the function pointers.
    private readonly NikonSdk.EventProc _eventProc;
    private readonly NikonSdk.UiRequestProc _uiRequestProc;
    private readonly NikonSdk.ProgressProc _progressProc;
    private readonly NikonSdk.DataProc _dataProc;
    private readonly NikonSdk.LiveViewDataProc _liveViewDataProc;

    private readonly object _shotLock = new();
    private readonly List<string> _savedFiles = new();
    private readonly SemaphoreSlim _shotSignal = new(0);
    private string? _shotFailure;
    private bool _captureComplete;

    private NikonNative? _sdk;
    private bool _initialized;
    private bool _connected;
    private string? _model;

    // Live view frames arrive on an SDK thread; the newest is kept until asked for.
    private readonly object _frameLock = new();
    private volatile bool _liveView;
    private byte[]? _latestFrame;
    private long _latestFrameNo;
    private long _returnedFrameNo;
    private int _invalidFrames;
    private const int MaxInvalidFrames = 30;

    public NikonBackend()
    {
        _eventProc = OnEvent;
        _uiRequestProc = OnUiRequest;
        _progressProc = (_, _, _, _, _) => { };
        _dataProc = (_, _, _) => NikonSdk.NoError;
        _liveViewDataProc = OnLiveViewData;
    }

    public string Name => "nikon";

    private static bool SdkPresent => File.Exists(Path.Combine(SdkDirectory, NikonNative.LibraryName));

    public CameraStatus GetStatus() => new(
        SdkAvailable: SdkPresent,
        Connected: _connected,
        Model: _connected ? _model : null,
        BatteryPercent: _connected ? TryReadBattery() : null,
        ShotsRemaining: null,
        Backend: Name);

    public CameraStatus Connect()
    {
        EnsureInitialized();
        if (_connected) return GetStatus();

        var sdk = _sdk!;
        var (deviceId, name) = FindAvailableDevice(sdk);

        var capInfo = IntPtr.Zero;
        var rc = sdk.ConnectDevice(deviceId, ref capInfo);
        FreeCapInfoList(sdk, capInfo);
        if (rc != NikonSdk.NoError)
            throw Map(rc, "CAPTURE_FAILED", "The Nikon camera could not be opened");

        _connected = true;
        _model = string.IsNullOrWhiteSpace(name) ? "Nikon camera" : name;

        // Send shots to the PC only: the booth does not depend on a card being present
        // or having space.
        var saveTo = SetUnsigned(NikonSdk.CapSaveMedia, NikonSdk.SaveMediaSdram);
        if (saveTo != NikonSdk.NoError)
            Log($"could not set save media to PC (NKERROR {saveTo}); shots may also go to the card");

        return GetStatus();
    }

    public void Disconnect()
    {
        if (!_connected || _sdk is null) return;
        _connected = false;
        _liveView = false; // DisconnectDevice also ends the SDK's live view thread
        try { _sdk.DisconnectDevice(); } catch (Exception ex) { Log($"disconnect failed: {ex.Message}"); }
    }

    public CaptureResult Capture(string destinationPath, TimeSpan timeout)
    {
        if (!_connected || _sdk is null)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");

        var stopwatch = Stopwatch.StartNew();
        // The SDK names the files itself, and RAW+JPEG produces two, so shots land in a
        // private folder first and only the JPEG is moved to where the booth asked.
        var workDirectory = Path.Combine(Path.GetTempPath(), "photuna-nikon", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workDirectory);

        try
        {
            lock (_shotLock)
            {
                _savedFiles.Clear();
                _shotFailure = null;
                _captureComplete = false;
            }
            while (_shotSignal.CurrentCount > 0) _shotSignal.Wait(0);

            var rc = StartSingleShot(_sdk, workDirectory);
            if (rc != NikonSdk.NoError)
                throw Map(rc, "CAPTURE_FAILED", "The Nikon camera did not take the photo");

            var jpeg = WaitForJpeg(stopwatch, timeout);

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
        if (!_connected || _sdk is null)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");

        var settings = new Dictionary<string, SettingValue>();
        foreach (var (key, capability) in ExposureSettings)
        {
            var allowed = ReadPackedStrings(_sdk, capability, NikonSdk.GetSettingSupportedValueArray);
            var current = ReadEnumValue(_sdk, capability);
            if (allowed is null || current is null || allowed.Count == 0) continue;

            var index = (int)current.Value.Index;
            var currentValue = index >= 0 && index < allowed.Count ? allowed[index] : allowed[0];
            settings[key] = new SettingValue(
                ToDisplay(key, currentValue),
                allowed.Select(v => ToDisplay(key, v)).ToList());
        }
        return settings;
    }

    public IReadOnlyDictionary<string, SettingValue> SetSetting(string key, string value)
    {
        if (!_connected || _sdk is null)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");

        var capability = ExposureSettings.FirstOrDefault(s => s.Key == key).Capability;
        if (capability == 0)
            throw new CameraException("UNKNOWN_SETTING", $"Unknown setting '{key}'.");

        var allowed = ReadPackedStrings(_sdk, capability, NikonSdk.GetSettingSupportedValueArray)
            ?? throw new CameraException("VALUE_NOT_ALLOWED", $"The camera does not offer {key} right now.");
        var index = allowed.IndexOf(FromDisplay(key, value));
        if (index < 0)
            throw new CameraException("VALUE_NOT_ALLOWED", $"'{value}' is not an allowed value for {key}.");

        var current = ReadEnumValue(_sdk, capability)
            ?? throw new CameraException("VALUE_NOT_ALLOWED", $"The camera does not offer {key} right now.");

        // As Nikon's sample does: send back the enum the camera reported, with the new
        // index and no data array.
        var buffer = Marshal.AllocHGlobal(NikonSdk.EnumSize);
        try
        {
            Marshal.Copy(current.Raw, 0, buffer, NikonSdk.EnumSize);
            Marshal.WriteInt32(buffer, NikonSdk.EnumValueOffset, index);
            Marshal.WriteIntPtr(buffer, NikonSdk.EnumDataOffset, IntPtr.Zero);
            var rc = _sdk.SetCapability(capability, buffer, NikonSdk.DataTypeEnumPtr);
            if (rc != NikonSdk.NoError)
            {
                throw rc is NikonSdk.ResultValueOutOfBounds or NikonSdk.ResultOutOfRangeValue
                    ? new CameraException("VALUE_NOT_ALLOWED", $"'{value}' is not an allowed value for {key}.")
                    : new CameraException("SETTING_REJECTED",
                        $"The camera refused this change (NKERROR {rc}). Its mode dial may be locking {key}.");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }

        return GetSettings();
    }

    public void StartLiveView()
    {
        if (!_connected || _sdk is null)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");

        lock (_frameLock)
        {
            _latestFrame = null;
            _returnedFrameNo = _latestFrameNo;
            _invalidFrames = 0;
        }
        _liveView = true;

        // Null completion proc, as for shooting: returns once live view has started.
        var rc = _sdk.StartLiveView(IntPtr.Zero, IntPtr.Zero);
        if (rc != NikonSdk.NoError && rc != NikonSdk.ResultLiveViewAlreadyStarted)
        {
            _liveView = false;
            throw new CameraException("LIVE_VIEW_UNAVAILABLE", $"The Nikon camera did not start live view (NKERROR {rc}).");
        }
    }

    public void StopLiveView()
    {
        if (!_liveView || _sdk is null) return;
        _liveView = false;
        try
        {
            var rc = _sdk.StopLiveView(IntPtr.Zero, IntPtr.Zero);
            if (rc != NikonSdk.NoError && rc != NikonSdk.ResultLiveViewAlreadyStopped)
                Log($"StopLiveView answered NKERROR {rc}");
        }
        catch (Exception ex)
        {
            Log($"StopLiveView failed: {ex.Message}");
        }
    }

    public LiveViewFrame? GetLiveViewFrame()
    {
        if (!_connected || _sdk is null)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");
        if (!_liveView)
            throw new CameraException("LIVE_VIEW_OFF", "Live view is not started.");

        lock (_frameLock)
        {
            if (_invalidFrames >= MaxInvalidFrames)
                throw new CameraException("LIVE_VIEW_UNAVAILABLE", "The Nikon camera's live view frames could not be read.");
            if (_latestFrame is null || _latestFrameNo == _returnedFrameNo) return null;
            _returnedFrameNo = _latestFrameNo;
            return new LiveViewFrame(_latestFrame, _latestFrameNo);
        }
    }

    public void Dispose()
    {
        Disconnect();
        if (_initialized && _sdk is not null)
        {
            try { _sdk.FreeSdk(); } catch (Exception ex) { Log($"FreeSDK failed: {ex.Message}"); }
            _initialized = false;
        }
    }

    // ── setup ──────────────────────────────────────────────────────────────────

    private void EnsureInitialized()
    {
        if (_initialized) return;
        if (!SdkPresent)
            throw new CameraException("SDK_NOT_INSTALLED", "Nikon camera support is not included in this build.");

        EnsureProfiles();
        _sdk ??= NikonNative.Load(SdkDirectory);

        var callbacks = new NikonSdk.CsCallback
        {
            UiRequestProc = Marshal.GetFunctionPointerForDelegate(_uiRequestProc),
            EventProc = Marshal.GetFunctionPointerForDelegate(_eventProc),
            ProgressProc = Marshal.GetFunctionPointerForDelegate(_progressProc),
            DataProc = Marshal.GetFunctionPointerForDelegate(_dataProc),
            LiveViewDataProc = Marshal.GetFunctionPointerForDelegate(_liveViewDataProc),
            RefProc = IntPtr.Zero,
        };

        var deviceList = IntPtr.Zero;
        var rc = _sdk.InitializeSdk(_sdk.CrtMalloc, _sdk.CrtFree, ref callbacks, ref deviceList, IntPtr.Zero);
        FreeDeviceList(_sdk, deviceList);
        if (rc != NikonSdk.NoError)
            throw new CameraException("SDK_NOT_INSTALLED", $"The Nikon SDK did not start (NKERROR {rc}).");

        _initialized = true;
    }

    /// <summary>
    /// Copies Nikon's three profiles into place when they are missing. Existing files are
    /// left alone: Nikon's own apps (NX Tether) keep theirs there too.
    /// </summary>
    private static void EnsureProfiles()
    {
        var target = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Nikon", "NXTether");
        try
        {
            Directory.CreateDirectory(target);
            foreach (var file in ProfileFiles)
            {
                var source = Path.Combine(SdkDirectory, file);
                var destination = Path.Combine(target, file);
                if (File.Exists(source) && !File.Exists(destination))
                    File.Copy(source, destination);
            }
        }
        catch (Exception ex)
        {
            Log($"could not place Nikon profiles in {target}: {ex.Message}");
        }
    }

    private (uint Id, string Name) FindAvailableDevice(NikonNative sdk)
    {
        // A camera plugged in just before connecting can take a moment to be listed.
        var deadline = DateTime.UtcNow + DeviceDiscoveryWait;
        var sawBusyCamera = false;
        while (true)
        {
            var list = IntPtr.Zero;
            var rc = sdk.EnumDevices(ref list, IntPtr.Zero, IntPtr.Zero);
            try
            {
                if (rc == NikonSdk.NoError && list != IntPtr.Zero)
                {
                    var count = Marshal.ReadInt32(list, NikonSdk.DeviceListElementsOffset);
                    var data = Marshal.ReadIntPtr(list, NikonSdk.DeviceListDataOffset);
                    for (var i = 0; data != IntPtr.Zero && i < count; i++)
                    {
                        var entry = data + i * NikonSdk.DeviceInfoSize;
                        var id = (uint)Marshal.ReadInt32(entry, 0);
                        var available = Marshal.ReadByte(entry, NikonSdk.DeviceInfoAvailableOffset) != 0;
                        var name = ReadAnsi(entry + NikonSdk.DeviceInfoNameOffset, 64);
                        if (available) return (id, name);
                        sawBusyCamera = true;
                    }
                }
            }
            finally
            {
                FreeDeviceList(sdk, list);
            }

            if (DateTime.UtcNow >= deadline) break;
            Thread.Sleep(500);
        }

        throw sawBusyCamera
            ? new CameraException("CAMERA_IN_USE",
                "The Nikon camera is being used by another app. Close NX Tether, Camera Control Pro and Nikon Transfer, then try again.")
            : new CameraException("NO_CAMERA", "No Nikon camera found.");
    }

    // ── shooting ───────────────────────────────────────────────────────────────

    private static int StartSingleShot(NikonNative sdk, string saveDirectory)
    {
        var buffer = Marshal.AllocHGlobal(NikonSdk.ShootingStructureSize);
        try
        {
            Marshal.Copy(new byte[NikonSdk.ShootingStructureSize], 0, buffer, NikonSdk.ShootingStructureSize);
            Marshal.WriteInt32(buffer, 0, NikonSdk.ShootingTypeSingle);
            Marshal.WriteByte(buffer, NikonSdk.ShootingAutoFocusOffset, 1);

            var path = saveDirectory.ToCharArray();
            if (path.Length >= NikonSdk.ShootingSavePathChars)
                throw new CameraException("CAPTURE_FAILED", "The temporary folder path is too long for the Nikon SDK.");
            Marshal.Copy(path, 0, buffer + NikonSdk.ShootingSavePathOffset, path.Length);

            // Null completion proc: StartShooting returns once the shot is taken; the
            // file arrives afterwards as kNkMAIDEvent_ImageSaved.
            return sdk.StartShooting(buffer, IntPtr.Zero, IntPtr.Zero);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private string WaitForJpeg(Stopwatch stopwatch, TimeSpan timeout)
    {
        DateTime? rawOnlySince = null;
        while (true)
        {
            lock (_shotLock)
            {
                var jpeg = _savedFiles.FirstOrDefault(IsJpeg);
                if (jpeg is not null && File.Exists(jpeg)) return jpeg;

                if (_shotFailure is not null)
                    throw new CameraException("CAPTURE_FAILED", _shotFailure);

                // RAW only: the camera finished and sent no JPEG.
                if (_captureComplete && _savedFiles.Count > 0)
                {
                    rawOnlySince ??= DateTime.UtcNow;
                    if (DateTime.UtcNow - rawOnlySince > RawOnlyGrace)
                        throw new CameraException("IMAGE_NOT_JPEG",
                            "The camera saved RAW only. Set its image quality to JPEG or RAW + JPEG.");
                }
            }

            var remaining = timeout - stopwatch.Elapsed;
            if (remaining <= TimeSpan.Zero)
                throw new CameraException("CAPTURE_FAILED", "The Nikon camera did not send the photo to the PC in time.");

            _shotSignal.Wait(remaining < TimeSpan.FromMilliseconds(250) ? remaining : TimeSpan.FromMilliseconds(250));
        }
    }

    private static bool IsJpeg(string path)
    {
        var extension = Path.GetExtension(path);
        return extension.Equals(".jpg", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".jpeg", StringComparison.OrdinalIgnoreCase);
    }

    // ── SDK callbacks (SDK threads; must never throw) ──────────────────────────

    private void OnEvent(IntPtr refClient, uint eventId, ulong data)
    {
        try
        {
            var pointer = (IntPtr)(long)data;
            switch (eventId)
            {
                case NikonSdk.EventImageSaved:
                {
                    var path = pointer == IntPtr.Zero ? null : Marshal.PtrToStringUni(pointer);
                    _sdk?.Free(pointer);
                    if (!string.IsNullOrEmpty(path))
                    {
                        lock (_shotLock) _savedFiles.Add(path);
                        _shotSignal.Release();
                    }
                    break;
                }
                case NikonSdk.EventCapChange:
                case NikonSdk.EventCapChangeOperationOnly:
                    // Carries an NkMAIDCapInfo the client owns.
                    _sdk?.Free(pointer);
                    break;
                case NikonSdk.EventStorageFullImageNotSaved:
                    FailShot("The camera's memory is full, so the photo was not saved.");
                    break;
                case NikonSdk.EventAcquireFailedImageNotSaved:
                    FailShot("The camera could not send the photo to the PC.");
                    break;
                case NikonSdk.EventCaptureSkip:
                    FailShot("The camera skipped the shot.");
                    break;
                case NikonSdk.EventCaptureComplete:
                    lock (_shotLock) _captureComplete = true;
                    _shotSignal.Release();
                    break;
            }
        }
        catch (Exception ex)
        {
            Log($"event 0x{eventId:X} handling failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Copies the frame out and releases the SDK's allocation. The image pointer is
    /// only dereferenced once the process confirms that memory is readable and it
    /// starts with a JPEG marker: the offset comes from a hand-computed struct layout,
    /// and a wrong one must stop live view rather than crash the helper.
    /// </summary>
    private void OnLiveViewData(IntPtr refProc, IntPtr liveViewData)
    {
        if (liveViewData == IntPtr.Zero) return;
        try
        {
            var size = Marshal.ReadInt32(liveViewData, NikonSdk.LiveViewImageSizeOffset);
            var image = Marshal.ReadIntPtr(liveViewData, NikonSdk.LiveViewImageDataOffset);
            var valid = size > 2 && size <= NikonSdk.LiveViewMaxImageBytes
                && NativeMemory.IsReadable(image, size)
                && Marshal.ReadByte(image, 0) == 0xFF && Marshal.ReadByte(image, 1) == 0xD8;

            if (valid)
            {
                if (_liveView)
                {
                    var bytes = new byte[size];
                    Marshal.Copy(image, bytes, 0, size);
                    lock (_frameLock)
                    {
                        _latestFrame = bytes;
                        _latestFrameNo++;
                        _invalidFrames = 0;
                    }
                }
                _sdk?.Free(image);
            }
            else
            {
                lock (_frameLock) _invalidFrames++;
                if (_invalidFrames == MaxInvalidFrames)
                    Log("live view frames do not match the expected layout; live view disabled");
            }

            _sdk?.Free(liveViewData);
        }
        catch (Exception ex)
        {
            Log($"live view frame handling failed: {ex.Message}");
        }
    }

    private void FailShot(string message)
    {
        lock (_shotLock) _shotFailure ??= message;
        _shotSignal.Release();
    }

    /// <summary>No one is at the helper to answer, so every prompt gets its default.</summary>
    private static uint OnUiRequest(IntPtr refProc, IntPtr request)
    {
        try
        {
            if (request == IntPtr.Zero) return 0;
            var prompt = Marshal.ReadIntPtr(request, NikonSdk.UiRequestPromptOffset);
            if (prompt != IntPtr.Zero) Log($"camera prompt answered with default: {Marshal.PtrToStringAnsi(prompt)}");
            return (uint)Marshal.ReadInt32(request, NikonSdk.UiRequestDefaultOffset);
        }
        catch
        {
            return 0;
        }
    }

    // ── capabilities ───────────────────────────────────────────────────────────

    private int? TryReadBattery()
    {
        if (_sdk is null) return null;
        try
        {
            var data = IntPtr.Zero;
            var type = 0;
            var rc = _sdk.GetCapability(NikonSdk.CapBatteryLevel, NikonSdk.GetSettingValue, ref data, ref type);
            try
            {
                return rc == NikonSdk.NoError && data != IntPtr.Zero && type == NikonSdk.DataTypeIntegerPtr
                    ? Marshal.ReadInt32(data)
                    : null;
            }
            finally
            {
                _sdk.Free(data);
            }
        }
        catch
        {
            return null;
        }
    }

    private int SetUnsigned(uint capability, uint value)
    {
        var buffer = Marshal.AllocHGlobal(sizeof(uint));
        try
        {
            Marshal.WriteInt32(buffer, (int)value);
            return _sdk!.SetCapability(capability, buffer, NikonSdk.DataTypeUnsignedPtr);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static List<string>? ReadPackedStrings(NikonNative sdk, uint capability, int requestType)
    {
        var data = IntPtr.Zero;
        var type = 0;
        var rc = sdk.GetCapability(capability, requestType, ref data, ref type);
        if (rc != NikonSdk.NoError || data == IntPtr.Zero || type != NikonSdk.DataTypeEnumPtr)
        {
            if (data != IntPtr.Zero && type == NikonSdk.DataTypeEnumPtr)
                sdk.Free(Marshal.ReadIntPtr(data, NikonSdk.EnumDataOffset));
            sdk.Free(data);
            return null;
        }

        var values = Marshal.ReadIntPtr(data, NikonSdk.EnumDataOffset);
        try
        {
            if (Marshal.ReadInt32(data, NikonSdk.EnumTypeOffset) != NikonSdk.ArrayTypePackedString || values == IntPtr.Zero)
                return null;

            // For packed strings ulElements is the byte length of the buffer:
            // "100\0200\0400\0" (see printEnumCapArrayValues in Nikon's sample).
            var byteLength = Marshal.ReadInt32(data, NikonSdk.EnumElementsOffset);
            var result = new List<string>();
            var offset = 0;
            while (offset < byteLength)
            {
                var text = Marshal.PtrToStringAnsi(values + offset) ?? "";
                result.Add(text);
                offset += Encoding.Latin1.GetByteCount(text) + 1;
            }
            return result;
        }
        finally
        {
            sdk.Free(values);
            sdk.Free(data);
        }
    }

    private static (uint Index, byte[] Raw)? ReadEnumValue(NikonNative sdk, uint capability)
    {
        var data = IntPtr.Zero;
        var type = 0;
        var rc = sdk.GetCapability(capability, NikonSdk.GetSettingValue, ref data, ref type);
        try
        {
            if (rc != NikonSdk.NoError || data == IntPtr.Zero || type != NikonSdk.DataTypeEnumPtr) return null;
            var raw = new byte[NikonSdk.EnumSize];
            Marshal.Copy(data, raw, 0, NikonSdk.EnumSize);
            return ((uint)Marshal.ReadInt32(data, NikonSdk.EnumValueOffset), raw);
        }
        finally
        {
            if (data != IntPtr.Zero && type == NikonSdk.DataTypeEnumPtr)
                sdk.Free(Marshal.ReadIntPtr(data, NikonSdk.EnumDataOffset));
            sdk.Free(data);
        }
    }

    // Nikon reports apertures as "5.6"; the booth shows "f/5.6" for every brand.
    private static string ToDisplay(string key, string value) =>
        key == SettingKeys.Aperture && value.Length > 0 && char.IsDigit(value[0]) ? $"f/{value}" : value;

    private static string FromDisplay(string key, string value) =>
        key == SettingKeys.Aperture && value.StartsWith("f/", StringComparison.Ordinal) ? value[2..] : value;

    // ── helpers ────────────────────────────────────────────────────────────────

    private static void FreeDeviceList(NikonNative sdk, IntPtr list)
    {
        if (list == IntPtr.Zero) return;
        sdk.Free(Marshal.ReadIntPtr(list, NikonSdk.DeviceListDataOffset));
        sdk.Free(list);
    }

    private static void FreeCapInfoList(NikonNative sdk, IntPtr list)
    {
        if (list == IntPtr.Zero) return;
        sdk.Free(Marshal.ReadIntPtr(list, NikonSdk.CapInfoListArrayOffset));
        sdk.Free(list);
    }

    private static string ReadAnsi(IntPtr pointer, int maxBytes)
    {
        var bytes = new byte[maxBytes];
        Marshal.Copy(pointer, bytes, 0, maxBytes);
        var end = Array.IndexOf(bytes, (byte)0);
        return Encoding.Latin1.GetString(bytes, 0, end < 0 ? maxBytes : end).Trim();
    }

    private static CameraException Map(int rc, string fallbackCode, string context) => rc switch
    {
        NikonSdk.ResultOutOfFocus => new("FOCUS_FAILED", "The camera could not focus."),
        NikonSdk.ResultCameraNotFound or NikonSdk.ResultDeviceNotAvailable or NikonSdk.ResultInvalidDeviceId
            or NikonSdk.ResultSessionFailure or NikonSdk.ResultBusReset
            => new("DISCONNECTED", "The Nikon camera was disconnected."),
        NikonSdk.ResultDeviceConnectedWithOtherApp => new("CAMERA_IN_USE",
            "The Nikon camera is being used by another app. Close NX Tether, Camera Control Pro and Nikon Transfer."),
        NikonSdk.ResultMediaFull => new("CAPTURE_FAILED", "The camera's memory is full."),
        NikonSdk.ResultBatteryDontWork or NikonSdk.ResultBatteryExhausted => new("CAPTURE_FAILED", "The camera battery is too low."),
        NikonSdk.ResultHighTemperature => new("CAPTURE_FAILED", "The camera is too hot to shoot."),
        NikonSdk.ResultDeviceBusy or NikonSdk.ResultBufferNotReady => new("CAPTURE_FAILED", "The camera is busy."),
        NikonSdk.ResultWaiting2ndRelease => new("CAPTURE_FAILED", "The camera is waiting for a second shutter press."),
        _ => new(fallbackCode, $"{context} (NKERROR {rc})."),
    };

    private static void Log(string message)
    {
        Console.Error.WriteLine($"[canon-camera-helper] nikon: {message}");
        Console.Error.Flush();
    }
}

/// <summary>Checks that native memory can be read before touching it.</summary>
internal static class NativeMemory
{
    private const uint MemCommit = 0x1000;
    private const uint PageNoAccess = 0x01;
    private const uint PageGuard = 0x100;

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryBasicInformation
    {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public ushort PartitionId;
        public UIntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    [DllImport("kernel32.dll")]
    private static extern UIntPtr VirtualQuery(IntPtr address, out MemoryBasicInformation buffer, UIntPtr length);

    public static bool IsReadable(IntPtr address, int length)
    {
        if (address == IntPtr.Zero || length <= 0) return false;
        var info = new MemoryBasicInformation();
        var size = (UIntPtr)(uint)Marshal.SizeOf<MemoryBasicInformation>();
        if (VirtualQuery(address, out info, size) == UIntPtr.Zero) return false;
        if (info.State != MemCommit || (info.Protect & (PageNoAccess | PageGuard)) != 0 || info.Protect == 0) return false;
        var regionEnd = (ulong)info.BaseAddress + (ulong)info.RegionSize;
        return (ulong)address + (ulong)length <= regionEnd;
    }
}

/// <summary>Reads a JPEG's pixel size from its start-of-frame marker.</summary>
internal static class JpegInfo
{
    public static (int Width, int Height) ReadSize(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            if (stream.ReadByte() != 0xFF || stream.ReadByte() != 0xD8) return (0, 0);

            while (true)
            {
                int b;
                do { b = stream.ReadByte(); } while (b != -1 && b != 0xFF);
                int marker;
                do { marker = stream.ReadByte(); } while (marker == 0xFF);
                if (b == -1 || marker == -1) return (0, 0);

                if (marker is 0xD8 or 0x01 or >= 0xD0 and <= 0xD7) continue;
                if (marker is 0xD9 or 0xDA) return (0, 0);

                var length = (stream.ReadByte() << 8) | stream.ReadByte();
                if (length < 2) return (0, 0);

                if (marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC)
                {
                    stream.ReadByte(); // precision
                    var height = (stream.ReadByte() << 8) | stream.ReadByte();
                    var width = (stream.ReadByte() << 8) | stream.ReadByte();
                    return (width, height);
                }

                stream.Seek(length - 2, SeekOrigin.Current);
            }
        }
        catch
        {
            return (0, 0);
        }
    }
}
