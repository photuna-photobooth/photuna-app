namespace CanonCameraHelper;

/// <summary>
/// A failure the booth can act on. <see cref="Code"/> is stable and machine-readable
/// (the app decides whether to retry, reconnect or fall back to the webcam from it);
/// the message is for logs only.
/// </summary>
public sealed class CameraException : Exception
{
    public string Code { get; }

    public CameraException(string code, string message) : base(message)
    {
        Code = code;
    }
}

public sealed record CameraStatus(
    bool SdkAvailable,
    bool Connected,
    string? Model,
    int? BatteryPercent,
    int? ShotsRemaining,
    string Backend);

public sealed record CaptureResult(
    string Path,
    int Width,
    int Height,
    long Bytes,
    long ElapsedMs);

/// <summary>
/// A camera setting's current value and every value the camera will accept right
/// now. The allowed list comes from the camera itself — it changes with the lens,
/// the mode dial and firmware — so the app only ever offers values from it.
/// </summary>
public sealed record SettingValue(string Current, IReadOnlyList<string> Allowed);

/// <summary>One live view frame: a JPEG, and a number that increases with every new frame.</summary>
public sealed record LiveViewFrame(byte[] Jpeg, long FrameNo);

public static class SettingKeys
{
    public const string Iso = "iso";
    public const string ShutterSpeed = "shutterSpeed";
    public const string Aperture = "aperture";
    public const string WhiteBalance = "whiteBalance";

    public static readonly IReadOnlySet<string> All =
        new HashSet<string> { Iso, ShutterSpeed, Aperture, WhiteBalance };
}

public interface ICameraBackend : IDisposable
{
    string Name { get; }

    CameraStatus GetStatus();

    CameraStatus Connect();

    void Disconnect();

    /// <summary>
    /// Fires the shutter and saves the full-resolution image on this PC at
    /// <paramref name="destinationPath"/>. Saving to the PC rather than only the
    /// card means a full card never silently stops a booth mid-event.
    /// </summary>
    CaptureResult Capture(string destinationPath, TimeSpan timeout);

    IReadOnlyDictionary<string, SettingValue> GetSettings();

    /// <summary>
    /// Applies one setting. Implementations must reject any value not in the
    /// setting's current allowed list.
    /// </summary>
    IReadOnlyDictionary<string, SettingValue> SetSetting(string key, string value);

    /// <summary>
    /// Starts the camera's live view, so guests see what the lens sees rather than a
    /// webcam next to it.
    /// </summary>
    void StartLiveView();

    void StopLiveView();

    /// <summary>The newest frame not yet returned, or null when no new frame has arrived.</summary>
    LiveViewFrame? GetLiveViewFrame();
}
