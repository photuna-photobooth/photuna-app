namespace CanonCameraHelper;

/// <summary>
/// The real Canon backend, built on Canon's EOS Digital SDK (EDSDK).
///
/// Phase 0: this is deliberately a stub that reports the SDK as unavailable. The
/// EDSDK is licensed by Canon and obtained by registering with the Canon developer
/// programme; it cannot be downloaded or committed on the project's behalf. Until
/// it is added under sdk/ (see README.md), every call fails with SDK_NOT_INSTALLED
/// and the booth keeps using the webcam, exactly as it does today.
///
/// Phase 1 replaces the bodies below with EDSDK calls: EdsInitializeSDK, session
/// open/close, kEdsCameraCommand_TakePicture with the image saved to the host,
/// kEdsPropID_ISOSpeed / Tv / Av / WhiteBalance with their property descriptions
/// as the allowed lists, and kEdsPropID_BatteryLevel for status.
/// </summary>
public sealed class CanonBackend : ICameraBackend
{
    private const string NotInstalled =
        "Canon EDSDK is not installed in this build. The booth will use the webcam.";

    public string Name => "canon-edsdk";

    public CameraStatus GetStatus() => new(
        SdkAvailable: false,
        Connected: false,
        Model: null,
        BatteryPercent: null,
        ShotsRemaining: null,
        Backend: Name);

    public CameraStatus Connect() =>
        throw new CameraException("SDK_NOT_INSTALLED", NotInstalled);

    public void Disconnect()
    {
    }

    public CaptureResult Capture(string destinationPath, TimeSpan timeout) =>
        throw new CameraException("SDK_NOT_INSTALLED", NotInstalled);

    public IReadOnlyDictionary<string, SettingValue> GetSettings() =>
        throw new CameraException("SDK_NOT_INSTALLED", NotInstalled);

    public IReadOnlyDictionary<string, SettingValue> SetSetting(string key, string value) =>
        throw new CameraException("SDK_NOT_INSTALLED", NotInstalled);

    public void StartLiveView() =>
        throw new CameraException("SDK_NOT_INSTALLED", NotInstalled);

    public void StopLiveView()
    {
    }

    public LiveViewFrame? GetLiveViewFrame() =>
        throw new CameraException("SDK_NOT_INSTALLED", NotInstalled);

    public void Dispose()
    {
    }
}
