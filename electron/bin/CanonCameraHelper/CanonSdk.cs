using System.Runtime.InteropServices;

namespace CanonCameraHelper;

/// <summary>
/// Bindings for Canon's EOS Digital SDK (EDSDK.dll, 64-bit).
///
/// Constants and layouts are transcribed from EDSDKTypes.h / EDSDKErrors.h and Canon's
/// C# sample, which are licensed to the business and kept only under sdk/ (never
/// committed). Structures use default alignment, as in Canon's sample.
/// </summary>
internal static class CanonSdk
{
    // EDSDKErrors.h
    public const uint Ok = 0x00000000;
    public const uint ErrDeviceNotFound = 0x00000080;
    public const uint ErrDeviceBusy = 0x00000081;
    public const uint ErrDeviceInvalid = 0x00000082;
    public const uint ErrCommPortIsInUse = 0x000000C0;
    public const uint ErrCommDisconnected = 0x000000C1;
    public const uint ErrCommUsbBusErr = 0x000000C4;
    public const uint ErrSessionNotOpen = 0x00002003;
    public const uint ErrPtpDeviceBusy = 0x00002019;
    public const uint ErrObjectNotReady = 0x0000A102;
    public const uint ErrTakePictureAfNg = 0x00008D01;
    public const uint ErrTakePictureNoCardNg = 0x00008D06;
    public const uint ErrTakePictureCardNg = 0x00008D07;
    public const uint ErrTakePictureStroboChargeNg = 0x00008D0A;
    public const uint ErrTakePictureLvRelProhibitModeNg = 0x00008D0D;

    // Property IDs
    public const uint PropBatteryLevel = 0x00000008;
    public const uint PropSaveTo = 0x0000000b;
    public const uint PropWhiteBalance = 0x00000106;
    public const uint PropAeMode = 0x00000400;
    public const uint PropIsoSpeed = 0x00000402;
    public const uint PropAv = 0x00000405;
    public const uint PropTv = 0x00000406;
    public const uint PropEvfOutputDevice = 0x00000500;
    public const uint PropEvfMode = 0x00000501;

    public const uint SaveToHost = 2;
    public const uint EvfOutputDevicePc = 0x02;

    // Camera commands
    public const uint CommandExtendShutDownTimer = 0x00000001;
    public const uint CommandPressShutterButton = 0x00000004;
    public const int ShutterButtonOff = 0x00000000;
    public const int ShutterButtonCompletely = 0x00000003;

    // Events
    public const uint ObjectEventAll = 0x00000200;
    public const uint ObjectEventDirItemRequestTransfer = 0x00000208;
    public const uint StateEventAll = 0x00000300;
    public const uint StateEventShutdown = 0x00000301;
    public const uint StateEventWillSoonShutDown = 0x00000303;
    public const uint StateEventCaptureError = 0x00000305;

    // EdsDeviceInfo: char[256] szPortName, char[256] szDeviceDescription, uint, uint.
    public const int DeviceInfoSize = 520;
    public const int DeviceInfoDescriptionOffset = 256;
    public const int NameLength = 256;

    // EdsPropertyDesc: int Form, uint Access, int NumElements, int[128] PropDesc.
    public const int PropertyDescSize = 524;
    public const int PropertyDescCountOffset = 8;
    public const int PropertyDescValuesOffset = 12;
    public const int PropertyDescMaxValues = 128;

    // EdsDirectoryItemInfo: UInt64 Size@0, int isFolder@8, uint GroupID@12, uint Option@16,
    // char[256] szFileName@20, uint format@276, uint dateTime@280 (padded to 288).
    public const int DirectoryItemInfoSize = 288;
    public const int DirectoryItemFileNameOffset = 20;

    [StructLayout(LayoutKind.Sequential)]
    public struct Capacity
    {
        public int NumberOfFreeClusters;
        public int BytesPerSector;
        public int Reset;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint NoArgsFn();
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint RefFn(IntPtr reference);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint OutRefFn(out IntPtr reference);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint GetChildCountFn(IntPtr reference, out int count);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint GetChildAtIndexFn(IntPtr reference, int index, out IntPtr child);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint BufferOutFn(IntPtr reference, IntPtr buffer);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint SendCommandFn(IntPtr camera, uint command, int parameter);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint SetCapacityFn(IntPtr camera, Capacity capacity);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint PropertyDataFn(IntPtr reference, uint propertyId, int parameter, int size, IntPtr data);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint GetPropertyDescFn(IntPtr reference, uint propertyId, IntPtr desc);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint DownloadFn(IntPtr item, ulong size, IntPtr stream);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint CreateMemoryStreamFn(ulong size, out IntPtr stream);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint GetPointerFn(IntPtr stream, out IntPtr pointer);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint GetLengthFn(IntPtr stream, out ulong length);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint CreateEvfImageRefFn(IntPtr stream, out IntPtr evfImage);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint DownloadEvfImageFn(IntPtr camera, IntPtr evfImage);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint SetEventHandlerFn(IntPtr camera, uint eventId, IntPtr handler, IntPtr context);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint ObjectEventHandler(uint eventId, IntPtr reference, IntPtr context);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate uint StateEventHandler(uint eventId, uint parameter, IntPtr context);
}

/// <summary>EDSDK.dll loaded from a folder, with its exports bound.</summary>
internal sealed class CanonNative
{
    public const string LibraryName = "EDSDK.dll";

    public CanonSdk.NoArgsFn InitializeSdk { get; }
    public CanonSdk.NoArgsFn TerminateSdk { get; }
    public CanonSdk.NoArgsFn GetEvent { get; }
    public CanonSdk.RefFn Release { get; }
    public CanonSdk.OutRefFn GetCameraList { get; }
    public CanonSdk.GetChildCountFn GetChildCount { get; }
    public CanonSdk.GetChildAtIndexFn GetChildAtIndex { get; }
    public CanonSdk.BufferOutFn GetDeviceInfo { get; }
    public CanonSdk.RefFn OpenSession { get; }
    public CanonSdk.RefFn CloseSession { get; }
    public CanonSdk.SendCommandFn SendCommand { get; }
    public CanonSdk.SetCapacityFn SetCapacity { get; }
    public CanonSdk.PropertyDataFn GetPropertyData { get; }
    public CanonSdk.PropertyDataFn SetPropertyData { get; }
    public CanonSdk.GetPropertyDescFn GetPropertyDesc { get; }
    public CanonSdk.BufferOutFn GetDirectoryItemInfo { get; }
    public CanonSdk.DownloadFn Download { get; }
    public CanonSdk.RefFn DownloadComplete { get; }
    public CanonSdk.RefFn DownloadCancel { get; }
    public CanonSdk.CreateMemoryStreamFn CreateMemoryStream { get; }
    public CanonSdk.GetPointerFn GetPointer { get; }
    public CanonSdk.GetLengthFn GetLength { get; }
    public CanonSdk.CreateEvfImageRefFn CreateEvfImageRef { get; }
    public CanonSdk.DownloadEvfImageFn DownloadEvfImage { get; }
    public CanonSdk.SetEventHandlerFn SetObjectEventHandler { get; }
    public CanonSdk.SetEventHandlerFn SetCameraStateEventHandler { get; }

    private CanonNative(IntPtr library)
    {
        InitializeSdk = Export<CanonSdk.NoArgsFn>(library, "EdsInitializeSDK");
        TerminateSdk = Export<CanonSdk.NoArgsFn>(library, "EdsTerminateSDK");
        GetEvent = Export<CanonSdk.NoArgsFn>(library, "EdsGetEvent");
        Release = Export<CanonSdk.RefFn>(library, "EdsRelease");
        GetCameraList = Export<CanonSdk.OutRefFn>(library, "EdsGetCameraList");
        GetChildCount = Export<CanonSdk.GetChildCountFn>(library, "EdsGetChildCount");
        GetChildAtIndex = Export<CanonSdk.GetChildAtIndexFn>(library, "EdsGetChildAtIndex");
        GetDeviceInfo = Export<CanonSdk.BufferOutFn>(library, "EdsGetDeviceInfo");
        OpenSession = Export<CanonSdk.RefFn>(library, "EdsOpenSession");
        CloseSession = Export<CanonSdk.RefFn>(library, "EdsCloseSession");
        SendCommand = Export<CanonSdk.SendCommandFn>(library, "EdsSendCommand");
        SetCapacity = Export<CanonSdk.SetCapacityFn>(library, "EdsSetCapacity");
        GetPropertyData = Export<CanonSdk.PropertyDataFn>(library, "EdsGetPropertyData");
        SetPropertyData = Export<CanonSdk.PropertyDataFn>(library, "EdsSetPropertyData");
        GetPropertyDesc = Export<CanonSdk.GetPropertyDescFn>(library, "EdsGetPropertyDesc");
        GetDirectoryItemInfo = Export<CanonSdk.BufferOutFn>(library, "EdsGetDirectoryItemInfo");
        Download = Export<CanonSdk.DownloadFn>(library, "EdsDownload");
        DownloadComplete = Export<CanonSdk.RefFn>(library, "EdsDownloadComplete");
        DownloadCancel = Export<CanonSdk.RefFn>(library, "EdsDownloadCancel");
        CreateMemoryStream = Export<CanonSdk.CreateMemoryStreamFn>(library, "EdsCreateMemoryStream");
        GetPointer = Export<CanonSdk.GetPointerFn>(library, "EdsGetPointer");
        GetLength = Export<CanonSdk.GetLengthFn>(library, "EdsGetLength");
        CreateEvfImageRef = Export<CanonSdk.CreateEvfImageRefFn>(library, "EdsCreateEvfImageRef");
        DownloadEvfImage = Export<CanonSdk.DownloadEvfImageFn>(library, "EdsDownloadEvfImage");
        SetObjectEventHandler = Export<CanonSdk.SetEventHandlerFn>(library, "EdsSetObjectEventHandler");
        SetCameraStateEventHandler = Export<CanonSdk.SetEventHandlerFn>(library, "EdsSetCameraStateEventHandler");
    }

    public static CanonNative Load(string directory)
    {
        try
        {
            // EDSDK.dll loads EdsImage.dll from its own folder.
            SetDllDirectoryW(directory);
            return new CanonNative(NativeLibrary.Load(Path.Combine(directory, LibraryName)));
        }
        catch (Exception ex) when (ex is DllNotFoundException or BadImageFormatException)
        {
            throw new CameraException("SDK_NOT_INSTALLED", $"The Canon SDK could not be loaded ({ex.Message}).");
        }
        catch (EntryPointNotFoundException ex)
        {
            throw new CameraException("SDK_NOT_INSTALLED", $"This Canon SDK version is not the one the booth was built for ({ex.Message}).");
        }
    }

    private static T Export<T>(IntPtr library, string name) where T : Delegate =>
        Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library, name));

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetDllDirectoryW(string path);
}
