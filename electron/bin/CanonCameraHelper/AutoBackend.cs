namespace CanonCameraHelper;

/// <summary>
/// Uses whichever brand's camera is attached. Only backends whose SDK is in this build
/// are tried, in order; the first that connects handles every command until the
/// camera is disconnected.
/// </summary>
public sealed class AutoBackend : ICameraBackend
{
    private readonly IReadOnlyList<ICameraBackend> _backends;
    private ICameraBackend? _active;

    public AutoBackend(params ICameraBackend[] backends)
    {
        _backends = backends;
    }

    public string Name => _active?.Name ?? "auto";

    public CameraStatus GetStatus()
    {
        if (_active is not null) return _active.GetStatus();

        var statuses = _backends.Select(b => b.GetStatus()).ToList();
        var available = statuses.Where(s => s.SdkAvailable).Select(s => s.Backend).ToList();
        return new CameraStatus(
            SdkAvailable: available.Count > 0,
            Connected: false,
            Model: null,
            BatteryPercent: null,
            ShotsRemaining: null,
            Backend: available.Count > 0 ? string.Join("+", available) : "none");
    }

    public CameraStatus Connect()
    {
        if (_active is not null && _active.GetStatus().Connected) return _active.GetStatus();
        _active = null;

        CameraException? firstRealError = null;
        var triedAny = false;

        foreach (var backend in _backends.Where(b => b.GetStatus().SdkAvailable))
        {
            triedAny = true;
            try
            {
                var status = backend.Connect();
                _active = backend;
                return status;
            }
            catch (CameraException ex) when (ex.Code == "NO_CAMERA")
            {
                // Not this brand; try the next.
            }
            catch (CameraException ex)
            {
                firstRealError ??= ex;
            }
        }

        if (firstRealError is not null) throw firstRealError;
        throw triedAny
            ? new CameraException("NO_CAMERA", "No supported camera found. Check the USB cable and that the camera is on.")
            : new CameraException("SDK_NOT_INSTALLED", "No camera brand's SDK is included in this build. The booth will use the webcam.");
    }

    public void Disconnect()
    {
        _active?.Disconnect();
        _active = null;
    }

    public CaptureResult Capture(string destinationPath, TimeSpan timeout) =>
        Active().Capture(destinationPath, timeout);

    public IReadOnlyDictionary<string, SettingValue> GetSettings() => Active().GetSettings();

    public IReadOnlyDictionary<string, SettingValue> SetSetting(string key, string value) =>
        Active().SetSetting(key, value);

    public void Dispose()
    {
        foreach (var backend in _backends)
        {
            try { backend.Dispose(); } catch { /* shutting down */ }
        }
    }

    private ICameraBackend Active() =>
        _active ?? throw new CameraException("NOT_CONNECTED", "Camera is not connected.");
}
