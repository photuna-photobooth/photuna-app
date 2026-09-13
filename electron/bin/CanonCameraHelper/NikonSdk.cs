using System.Runtime.InteropServices;

namespace CanonCameraHelper;

/// <summary>
/// Bindings for Nikon's Remote SDK v2 "simplified API" (ControlServiceLayer.dll, Z series).
///
/// Constants and layouts are transcribed from the SDK's Maid3.h / Maid3d1.h, which are
/// licensed to the business and kept only under sdk/ (never committed). Maid3.h is
/// compiled under <c>#pragma pack(2)</c> on Windows, so pointer members that follow an
/// odd-sized field sit at different offsets than .NET's default layout would give —
/// hence explicit offsets and hand-written buffers below.
/// </summary>
internal static class NikonSdk
{
    // eNkMAIDResult / eNkMAIDResultD1 (NKERROR)
    public const int NoError = 0;
    public const int ResultValueOutOfBounds = -125;
    public const int ResultDeviceNotAvailable = -114;
    public const int ResultInvalidDeviceId = -110;
    public const int ResultCapabilityNotSupported = -107;
    public const int ResultOperationNotSupported = -106;
    public const int ResultOutOfRangeValue = -104;
    public const int ResultBufferNotReady = 129;
    public const int ResultMediaFull = 131;
    public const int ResultCameraNotFound = 134;
    public const int ResultBatteryDontWork = 135;
    public const int ResultOutOfFocus = 137;
    public const int ResultSessionFailure = 142;
    public const int ResultBusReset = 144;
    public const int ResultBatteryExhausted = 147;
    public const int ResultCaptureFailure = 148;
    public const int ResultDeviceBusy = 152;
    public const int ResultWaiting2ndRelease = 168;
    public const int ResultHighTemperature = 170;
    public const int ResultDeviceConnectedWithOtherApp = 178;

    // eNkMAIDDataType
    public const int DataTypeIntegerPtr = 5;
    public const int DataTypeUnsignedPtr = 6;
    public const int DataTypeStringPtr = 11;
    public const int DataTypeEnumPtr = 16;

    // eNkMAIDArrayType
    public const int ArrayTypePackedString = 7;

    // eNkSDKGetSettingRequestType
    public const int GetSettingValue = 0;
    public const int GetSettingSupportedValueArray = 1;

    // eNkMAIDCapability / eNkMAIDCapabilityD1 (VendorBaseDX2 = 0x8100)
    public const uint CapBatteryLevel = 48;
    public const uint CapCompressionLevel = 0x8110;
    public const uint CapShutterSpeed = 0x8112;
    public const uint CapAperture = 0x8113;
    public const uint CapSensitivity = 0x8117;
    public const uint CapWbMode = 0x8118;
    public const uint CapSaveMedia = 0x8305;

    // eNkMAIDSaveMedia
    public const uint SaveMediaSdram = 1;

    // eNkMAIDEvent / eNkMAIDEventDX2 (DX2Origin = 0x106)
    public const uint EventCapChange = 4;
    public const uint EventImageSaved = 8;
    public const uint EventStorageFullImageNotSaved = 10;
    public const uint EventAcquireFailedImageNotSaved = 11;
    public const uint EventCaptureComplete = 0x108;
    public const uint EventCapChangeOperationOnly = 0x10B;
    public const uint EventCaptureSkip = 0x11E;

    // eNkMAIDShootingType
    public const int ShootingTypeSingle = 1;

    // MAIDShootingStructure under pack(2): enum@0, 4×ULONG@4..16, bool@20, wchar_t[1024]@22, LPVOID@2070.
    public const int ShootingStructureSize = 2078;
    public const int ShootingAutoFocusOffset = 20;
    public const int ShootingSavePathOffset = 22;
    public const int ShootingSavePathChars = 1024;

    // NkMAIDEnum under pack(2): ULONG×4 @0..12, SWORD@16, LPVOID@18.
    public const int EnumSize = 26;
    public const int EnumTypeOffset = 0;
    public const int EnumElementsOffset = 4;
    public const int EnumValueOffset = 8;
    public const int EnumDataOffset = 18;

    // NkMAIDEnumDevices: ULONG@0, ULONG@4, LPNkMAIDDeviceInfo@8.
    public const int DeviceListElementsOffset = 0;
    public const int DeviceListDataOffset = 8;

    // NkMAIDDeviceInfo under pack(2): ULONG@0, char[64]@4, bool@68, ULONG@70, char[64]@74.
    public const int DeviceInfoSize = 138;
    public const int DeviceInfoNameOffset = 4;
    public const int DeviceInfoAvailableOffset = 68;

    // NkMAIDEnumCapInfo: LPNkMAIDCapInfo@0, ULONG@8, ULONG@12.
    public const int CapInfoListArrayOffset = 0;

    // NkMAIDUIRequestInfo under pack(2): ULONG@0, ULONG@4, BOOL@8, char*@12.
    public const int UiRequestDefaultOffset = 4;
    public const int UiRequestPromptOffset = 12;

    // NkMAIDLiveViewData under pack(2): ULONG ulLvImageSize@0, UWORD×2@4,
    // NKMAIDLiveViewHeader@8 — 884 bytes: 22 chars, 2 WORDs, 13 SIZEINFO,
    // 4×SIZEINFO[96], CTimeCode(4), 2×uint32, stSpiritLevel[3](12), 4 chars, 2×uint32,
    // 4 chars, 6×uint32 — then LPVOID pImageData@892.
    public const int LiveViewImageSizeOffset = 0;
    public const int LiveViewImageDataOffset = 892;
    public const int LiveViewMaxImageBytes = 8 * 1024 * 1024;
    public const int ResultLiveViewAlreadyStopped = -111;
    public const int ResultLiveViewAlreadyStarted = -112;

    /// <summary>Six pointers, so the layout is the same under any packing.</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct CsCallback
    {
        public IntPtr UiRequestProc;
        public IntPtr EventProc;
        public IntPtr ProgressProc;
        public IntPtr DataProc;
        public IntPtr LiveViewDataProc;
        public IntPtr RefProc;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int InitializeSdkFn(IntPtr allocMemory, IntPtr freeMemory, ref CsCallback callback, ref IntPtr deviceList, IntPtr enumCapInfo);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int NoArgsFn();

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int ConnectDeviceFn(uint deviceId, ref IntPtr enumCapInfo);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int EnumDevicesFn(ref IntPtr deviceList, IntPtr completionProc, IntPtr completionRef);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int StartShootingFn(IntPtr shootingStructure, IntPtr completionProc, IntPtr completionRef);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int AsyncCallFn(IntPtr completionProc, IntPtr completionRef);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int GetCapabilityFn(uint capabilityId, int requestType, ref IntPtr data, ref int dataType);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int SetCapabilityFn(uint capabilityId, IntPtr data, int dataType);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate void EventProc(IntPtr refClient, uint eventId, ulong data);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate uint UiRequestProc(IntPtr refProc, IntPtr request);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate void ProgressProc(uint command, uint param, IntPtr refProc, uint done, uint total);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int DataProc(IntPtr refClient, IntPtr dataInfo, IntPtr data);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate void LiveViewDataProc(IntPtr refProc, IntPtr liveViewData);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void CrtFreeFn(IntPtr memory);
}

/// <summary>ControlServiceLayer.dll loaded from a folder, with its exports bound.</summary>
internal sealed class NikonNative
{
    public const string LibraryName = "ControlServiceLayer.dll";

    public NikonSdk.InitializeSdkFn InitializeSdk { get; }
    public NikonSdk.NoArgsFn FreeSdk { get; }
    public NikonSdk.ConnectDeviceFn ConnectDevice { get; }
    public NikonSdk.NoArgsFn DisconnectDevice { get; }
    public NikonSdk.EnumDevicesFn EnumDevices { get; }
    public NikonSdk.StartShootingFn StartShooting { get; }
    public NikonSdk.GetCapabilityFn GetCapability { get; }
    public NikonSdk.SetCapabilityFn SetCapability { get; }
    public NikonSdk.AsyncCallFn StartLiveView { get; }
    public NikonSdk.AsyncCallFn StopLiveView { get; }

    /// <summary>
    /// The SDK allocates what it hands back with the allocator the client registers and
    /// expects the client to release it with the matching free, so both are the C
    /// runtime's own malloc/free — the same pair Nikon's sample uses.
    /// </summary>
    public IntPtr CrtMalloc { get; }
    public IntPtr CrtFree { get; }
    private readonly NikonSdk.CrtFreeFn _free;

    private NikonNative(IntPtr library, IntPtr crt)
    {
        InitializeSdk = Export<NikonSdk.InitializeSdkFn>(library, "InitializeSDK");
        FreeSdk = Export<NikonSdk.NoArgsFn>(library, "FreeSDK");
        ConnectDevice = Export<NikonSdk.ConnectDeviceFn>(library, "ConnectDevice");
        DisconnectDevice = Export<NikonSdk.NoArgsFn>(library, "DisconnectDevice");
        EnumDevices = Export<NikonSdk.EnumDevicesFn>(library, "EnumDevices");
        StartShooting = Export<NikonSdk.StartShootingFn>(library, "StartShooting");
        GetCapability = Export<NikonSdk.GetCapabilityFn>(library, "GetCapability");
        SetCapability = Export<NikonSdk.SetCapabilityFn>(library, "SetCapability");
        StartLiveView = Export<NikonSdk.AsyncCallFn>(library, "StartLiveView");
        StopLiveView = Export<NikonSdk.AsyncCallFn>(library, "StopLiveView");

        CrtMalloc = NativeLibrary.GetExport(crt, "malloc");
        CrtFree = NativeLibrary.GetExport(crt, "free");
        _free = Marshal.GetDelegateForFunctionPointer<NikonSdk.CrtFreeFn>(CrtFree);
    }

    public void Free(IntPtr memory)
    {
        if (memory != IntPtr.Zero) _free(memory);
    }

    public static NikonNative Load(string directory)
    {
        var libraryPath = Path.Combine(directory, LibraryName);
        try
        {
            // ControlServiceLayer.dll loads NkdPTP.dll, dnssd.dll and NkRoyalmile.dll
            // from its own folder.
            SetDllDirectoryW(directory);
            var library = NativeLibrary.Load(libraryPath);
            var crt = NativeLibrary.Load("ucrtbase.dll");
            return new NikonNative(library, crt);
        }
        catch (Exception ex) when (ex is DllNotFoundException or BadImageFormatException)
        {
            throw new CameraException("SDK_NOT_INSTALLED",
                $"The Nikon SDK could not be loaded ({ex.Message}). It needs 64-bit Windows 11 and the Microsoft Visual C++ 2022 runtime.");
        }
        catch (EntryPointNotFoundException ex)
        {
            throw new CameraException("SDK_NOT_INSTALLED",
                $"This Nikon SDK version is not the one the booth was built for ({ex.Message}).");
        }
    }

    private static T Export<T>(IntPtr library, string name) where T : Delegate =>
        Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library, name));

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetDllDirectoryW(string path);
}
