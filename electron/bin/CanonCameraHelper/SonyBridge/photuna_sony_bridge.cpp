// Photuna's bridge between the camera helper (C#) and Sony's Camera Remote SDK.
//
// Sony's SDK is C++: Connect() needs an IDeviceCallback object whose virtual methods
// the SDK calls from its own threads, and properties are C++ classes. C# cannot
// implement a C++ interface, so this DLL owns that object and exposes a small plain-C
// API the helper calls by P/Invoke (see SonyBackend.cs).
//
// Built against the business's Sony SDK, which is never committed:
//   powershell -File scripts/build-sony-bridge.ps1
//
// Every export returns a PsbResult. Sony's own error code for the last failure is
// available from psb_last_sdk_error() for logs.

#include <windows.h>

#include <chrono>
#include <condition_variable>
#include <cstring>
#include <cwchar>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "CameraRemote_SDK.h"
#include "CrCommandData.h"
#include "CrDeviceProperty.h"
#include "CrError.h"
#include "ICrCameraObjectInfo.h"
#include "IDeviceCallback.h"

namespace SDK = SCRSDK;
using namespace std::chrono_literals;

#define PSB_API extern "C" __declspec(dllexport)

enum PsbResult : int
{
    PSB_OK = 0,
    PSB_NO_CAMERA = 1,
    PSB_CONNECT_FAILED = 2,
    PSB_TIMEOUT = 3,
    PSB_NOT_CONNECTED = 4,
    PSB_RAW_ONLY = 5,
    PSB_CAPTURE_FAILED = 6,
    PSB_CAMERA_BUSY = 7,
    PSB_DISCONNECTED = 8,
    PSB_NOT_FOUND = 9,
    PSB_BUFFER_TOO_SMALL = 10,
    PSB_SDK_ERROR = 11,
    PSB_NOT_INITIALIZED = 12,
    PSB_NOT_WRITABLE = 13,
    PSB_NO_FRAME = 14,
};

// Settings the booth uses, so the helper never needs Sony's property codes.
enum PsbSetting : int
{
    PSB_SETTING_ISO = 0,
    PSB_SETTING_SHUTTER_SPEED = 1,
    PSB_SETTING_APERTURE = 2,
    PSB_SETTING_WHITE_BALANCE = 3,
    PSB_SETTING_BATTERY = 4,
};

namespace
{
// Sony's sample passes -1: continue the camera's own file numbering.
constexpr CrInt32 kAutoFileNumber = -1;
// How long a RAW file may arrive without its JPEG before the shot counts as RAW only.
constexpr auto kRawOnlyGrace = 3s;

class DeviceCallback final : public SDK::IDeviceCallback
{
public:
    std::mutex lock;
    std::condition_variable changed;
    bool connected = false;
    bool connectFinished = false;
    bool disconnected = false;
    CrInt32u lastError = 0;
    std::vector<std::wstring> downloads;

    void Reset()
    {
        std::lock_guard<std::mutex> guard(lock);
        connected = false;
        connectFinished = false;
        disconnected = false;
        lastError = 0;
        downloads.clear();
    }

    void OnConnected(SDK::DeviceConnectionVersioin) override
    {
        std::lock_guard<std::mutex> guard(lock);
        connected = true;
        connectFinished = true;
        disconnected = false;
        changed.notify_all();
    }

    void OnDisconnected(CrInt32u error) override
    {
        std::lock_guard<std::mutex> guard(lock);
        connected = false;
        disconnected = true;
        connectFinished = true;
        lastError = error;
        changed.notify_all();
    }

    void OnCompleteDownload(CrChar* filename, CrInt32u type) override
    {
        // Setting-file downloads also arrive here; only images matter.
        if (type != SDK::CrDownloadSettingFileType_None && type != 0xFFFFFFFF) return;
        if (filename == nullptr) return;
        std::lock_guard<std::mutex> guard(lock);
        downloads.emplace_back(filename);
        changed.notify_all();
    }

    void OnError(CrInt32u error) override
    {
        std::lock_guard<std::mutex> guard(lock);
        lastError = error;
        connectFinished = true;
        changed.notify_all();
    }
};

std::mutex g_apiLock;
bool g_initialized = false;
SDK::CrDeviceHandle g_device = 0;
SDK::ICrEnumCameraObjectInfo* g_cameraList = nullptr;
DeviceCallback g_callback;
int g_lastSdkError = 0;

bool IsConnected()
{
    std::lock_guard<std::mutex> guard(g_callback.lock);
    return g_device != 0 && g_callback.connected;
}

bool HasExtension(const std::wstring& path, const wchar_t* extension)
{
    const auto dot = path.find_last_of(L'.');
    return dot != std::wstring::npos && _wcsicmp(path.c_str() + dot, extension) == 0;
}

bool IsJpeg(const std::wstring& path)
{
    return HasExtension(path, L".jpg") || HasExtension(path, L".jpeg");
}

void CopyText(const std::wstring& text, wchar_t* out, int capacity)
{
    if (out == nullptr || capacity <= 0) return;
    wcsncpy_s(out, static_cast<size_t>(capacity), text.c_str(), _TRUNCATE);
}

bool PropertyCode(int setting, CrInt32u& code)
{
    switch (setting)
    {
    case PSB_SETTING_ISO: code = SDK::CrDeviceProperty_IsoSensitivity; return true;
    case PSB_SETTING_SHUTTER_SPEED: code = SDK::CrDeviceProperty_ShutterSpeed; return true;
    case PSB_SETTING_APERTURE: code = SDK::CrDeviceProperty_FNumber; return true;
    case PSB_SETTING_WHITE_BALANCE: code = SDK::CrDeviceProperty_WhiteBalance; return true;
    case PSB_SETTING_BATTERY: code = SDK::CrDeviceProperty_BatteryLevel; return true;
    default: return false;
    }
}

// Reads one property's reported value type and writability.
int ReadPropertyInfo(CrInt32u code, SDK::CrDataType& type, bool& writable)
{
    SDK::CrDeviceProperty* list = nullptr;
    CrInt32 count = 0;
    auto error = SDK::GetSelectDeviceProperties(g_device, 1, &code, &list, &count);
    if (CR_FAILED(error) || list == nullptr)
    {
        g_lastSdkError = error;
        return PSB_NOT_FOUND;
    }
    int result = PSB_NOT_FOUND;
    for (CrInt32 i = 0; i < count; ++i)
    {
        if (list[i].GetCode() != code) continue;
        type = list[i].GetValueType();
        writable = list[i].IsSetEnableCurrentValue();
        result = PSB_OK;
        break;
    }
    SDK::ReleaseDeviceProperties(g_device, list);
    return result;
}

int SetProperty(CrInt32u code, CrInt64u value, SDK::CrDataType type)
{
    SDK::CrDeviceProperty property;
    property.SetCode(code);
    property.SetCurrentValue(value);
    property.SetValueType(type);
    auto error = SDK::SetDeviceProperty(g_device, &property);
    if (CR_FAILED(error))
    {
        g_lastSdkError = error;
        return PSB_SDK_ERROR;
    }
    return PSB_OK;
}

// Sets a property using the type the camera itself reports for it.
int SetReportedProperty(CrInt32u code, CrInt64u value)
{
    SDK::CrDataType type{};
    bool writable = false;
    auto info = ReadPropertyInfo(code, type, writable);
    if (info != PSB_OK) return info;
    if (!writable) return PSB_NOT_WRITABLE;
    return SetProperty(code, value, type);
}

void ReleaseDevice()
{
    if (g_device != 0)
    {
        SDK::ReleaseDevice(g_device);
        g_device = 0;
    }
    if (g_cameraList != nullptr)
    {
        g_cameraList->Release();
        g_cameraList = nullptr;
    }
}
} // namespace

PSB_API int psb_last_sdk_error()
{
    return g_lastSdkError;
}

PSB_API int psb_init()
{
    std::lock_guard<std::mutex> guard(g_apiLock);
    if (g_initialized) return PSB_OK;
    if (!SDK::Init(0))
    {
        SDK::Release();
        return PSB_SDK_ERROR;
    }
    g_initialized = true;
    return PSB_OK;
}

PSB_API int psb_is_connected()
{
    return IsConnected() ? 1 : 0;
}

PSB_API int psb_connect(wchar_t* modelOut, int modelCapacity, int timeoutMs)
{
    std::lock_guard<std::mutex> guard(g_apiLock);
    if (!g_initialized) return PSB_NOT_INITIALIZED;
    if (IsConnected()) return PSB_OK;
    ReleaseDevice();

    // One second is the shortest enumeration Sony allows; with several camera brands
    // tried in turn, a missing camera must not cost long.
    auto error = SDK::EnumCameraObjects(&g_cameraList, 1);
    if (CR_FAILED(error) || g_cameraList == nullptr || g_cameraList->GetCount() == 0)
    {
        g_lastSdkError = error;
        ReleaseDevice();
        return PSB_NO_CAMERA;
    }

    const SDK::ICrCameraObjectInfo* camera = nullptr;
    for (CrInt32u i = 0; i < g_cameraList->GetCount(); ++i)
    {
        auto* candidate = g_cameraList->GetCameraObjectInfo(i);
        if (candidate == nullptr) continue;
        const CrChar* type = candidate->GetConnectionTypeName();
        // USB only: network cameras need pairing and passwords the booth has no UI for.
        if (type != nullptr && _wcsicmp(type, L"IP") == 0) continue;
        camera = candidate;
        break;
    }
    if (camera == nullptr)
    {
        ReleaseDevice();
        return PSB_NO_CAMERA;
    }

    CopyText(camera->GetModel() != nullptr ? camera->GetModel() : L"Sony camera", modelOut, modelCapacity);
    g_callback.Reset();

    // The camera list stays alive until disconnect: the SDK keeps using the object info.
    error = SDK::Connect(const_cast<SDK::ICrCameraObjectInfo*>(camera), &g_callback, &g_device,
        SDK::CrSdkControlMode_Remote, SDK::CrReconnecting_ON);
    if (CR_FAILED(error))
    {
        g_lastSdkError = error;
        g_device = 0;
        ReleaseDevice();
        return error == SDK::CrError_Connect_FailBusy ? PSB_CAMERA_BUSY : PSB_CONNECT_FAILED;
    }

    {
        std::unique_lock<std::mutex> wait(g_callback.lock);
        g_callback.changed.wait_for(wait, std::chrono::milliseconds(timeoutMs),
            [] { return g_callback.connectFinished; });
        if (!g_callback.connected)
        {
            const auto sdkError = g_callback.lastError;
            wait.unlock();
            g_lastSdkError = static_cast<int>(sdkError);
            ReleaseDevice();
            if (sdkError == SDK::CrError_Connect_FailBusy) return PSB_CAMERA_BUSY;
            return sdkError == 0 ? PSB_TIMEOUT : PSB_CONNECT_FAILED;
        }
    }

    // Let the PC set exposure (otherwise the camera's dials win), and send photos to
    // the PC. Cameras that do not offer either keep their own behaviour.
    SetProperty(SDK::CrDeviceProperty_PriorityKeySettings, SDK::CrPriorityKey_PCRemote, SDK::CrDataType_UInt32Array);
    SetReportedProperty(SDK::CrDeviceProperty_StillImageStoreDestination, SDK::CrStillImageStoreDestination_HostPC);
    return PSB_OK;
}

PSB_API int psb_disconnect()
{
    std::lock_guard<std::mutex> guard(g_apiLock);
    if (g_device == 0) return PSB_OK;
    if (IsConnected())
    {
        SDK::Disconnect(g_device);
        std::unique_lock<std::mutex> wait(g_callback.lock);
        g_callback.changed.wait_for(wait, 3s, [] { return g_callback.disconnected; });
    }
    ReleaseDevice();
    return PSB_OK;
}

PSB_API void psb_release()
{
    psb_disconnect();
    std::lock_guard<std::mutex> guard(g_apiLock);
    if (g_initialized)
    {
        SDK::Release();
        g_initialized = false;
    }
}

// Reads a setting: its current value, whether it can be changed now, and the raw
// candidate values (an array of 16- or 32-bit numbers, depending on the setting).
PSB_API int psb_get_setting(int setting, CrInt64u* current, unsigned char* values, int valuesCapacity,
    int* valuesBytes, int* writable)
{
    std::lock_guard<std::mutex> guard(g_apiLock);
    if (!IsConnected()) return PSB_NOT_CONNECTED;
    CrInt32u code = 0;
    if (!PropertyCode(setting, code)) return PSB_NOT_FOUND;

    SDK::CrDeviceProperty* list = nullptr;
    CrInt32 count = 0;
    auto error = SDK::GetSelectDeviceProperties(g_device, 1, &code, &list, &count);
    if (CR_FAILED(error) || list == nullptr)
    {
        g_lastSdkError = error;
        return PSB_NOT_FOUND;
    }

    int result = PSB_NOT_FOUND;
    for (CrInt32 i = 0; i < count; ++i)
    {
        auto& property = list[i];
        if (property.GetCode() != code) continue;

        *current = property.GetCurrentValue();
        *writable = property.IsSetEnableCurrentValue() ? 1 : 0;
        const auto size = static_cast<int>(property.GetValueSize());
        *valuesBytes = size;
        if (size > valuesCapacity)
        {
            result = PSB_BUFFER_TOO_SMALL;
        }
        else
        {
            if (size > 0 && property.GetValues() != nullptr) std::memcpy(values, property.GetValues(), size);
            result = PSB_OK;
        }
        break;
    }
    SDK::ReleaseDeviceProperties(g_device, list);
    return result;
}

PSB_API int psb_set_setting(int setting, CrInt64u value)
{
    std::lock_guard<std::mutex> guard(g_apiLock);
    if (!IsConnected()) return PSB_NOT_CONNECTED;
    CrInt32u code = 0;
    if (!PropertyCode(setting, code) || setting == PSB_SETTING_BATTERY) return PSB_NOT_FOUND;
    return SetReportedProperty(code, value);
}

// Focuses, takes one photo, and waits until the camera has sent it into
// saveDirectory. On success fileOut holds the JPEG's path as the SDK reported it.
PSB_API int psb_capture(const wchar_t* saveDirectory, wchar_t* fileOut, int fileCapacity, int timeoutMs)
{
    std::lock_guard<std::mutex> guard(g_apiLock);
    if (!IsConnected()) return PSB_NOT_CONNECTED;

    std::wstring directory(saveDirectory != nullptr ? saveDirectory : L"");
    std::wstring prefix;
    auto error = SDK::SetSaveInfo(g_device, const_cast<CrChar*>(directory.c_str()),
        const_cast<CrChar*>(prefix.c_str()), kAutoFileNumber);
    if (CR_FAILED(error))
    {
        g_lastSdkError = error;
        return PSB_CAPTURE_FAILED;
    }

    {
        std::lock_guard<std::mutex> reset(g_callback.lock);
        g_callback.downloads.clear();
    }

    // Half-press to focus, full press, release — as Sony's sample af_shutter() does.
    // A camera in manual focus ignores the half-press.
    SetProperty(SDK::CrDeviceProperty_S1, SDK::CrLockIndicator_Locked, SDK::CrDataType_UInt16);
    std::this_thread::sleep_for(500ms);
    error = SDK::SendCommand(g_device, SDK::CrCommandId_Release, SDK::CrCommandParam_Down);
    std::this_thread::sleep_for(35ms);
    SDK::SendCommand(g_device, SDK::CrCommandId_Release, SDK::CrCommandParam_Up);
    SetProperty(SDK::CrDeviceProperty_S1, SDK::CrLockIndicator_Unlocked, SDK::CrDataType_UInt16);
    if (CR_FAILED(error))
    {
        g_lastSdkError = error;
        return PSB_CAPTURE_FAILED;
    }

    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    std::chrono::steady_clock::time_point rawSince{};
    std::unique_lock<std::mutex> wait(g_callback.lock);
    while (true)
    {
        if (g_callback.disconnected) return PSB_DISCONNECTED;

        for (const auto& file : g_callback.downloads)
        {
            if (IsJpeg(file))
            {
                CopyText(file, fileOut, fileCapacity);
                return PSB_OK;
            }
        }

        const auto now = std::chrono::steady_clock::now();
        if (!g_callback.downloads.empty())
        {
            if (rawSince == std::chrono::steady_clock::time_point{}) rawSince = now;
            if (now - rawSince >= kRawOnlyGrace)
            {
                CopyText(g_callback.downloads.front(), fileOut, fileCapacity);
                return PSB_RAW_ONLY;
            }
        }
        if (now >= deadline) return PSB_TIMEOUT;

        g_callback.changed.wait_for(wait, 250ms);
    }
}

// Live view is pulled: the helper asks for the newest frame when it wants one.
PSB_API int psb_start_live_view()
{
    std::lock_guard<std::mutex> guard(g_apiLock);
    if (!IsConnected()) return PSB_NOT_CONNECTED;
    // Some cameras stream live view to the PC regardless and refuse this setting;
    // whether frames arrive is what counts.
    auto error = SDK::SetDeviceSetting(g_device, SDK::Setting_Key_EnableLiveView, 1);
    if (CR_FAILED(error)) g_lastSdkError = error;
    return PSB_OK;
}

PSB_API int psb_stop_live_view()
{
    std::lock_guard<std::mutex> guard(g_apiLock);
    if (!IsConnected()) return PSB_OK;
    SDK::SetDeviceSetting(g_device, SDK::Setting_Key_EnableLiveView, 0);
    return PSB_OK;
}

namespace
{
std::vector<CrInt8u> g_frameBuffer;
}

// Copies the newest live view JPEG into out. PSB_NO_FRAME when the camera has no
// newer frame; PSB_BUFFER_TOO_SMALL with *size set when out is too small.
PSB_API int psb_live_view_frame(unsigned char* out, int capacity, int* size, unsigned int* frameNo)
{
    std::lock_guard<std::mutex> guard(g_apiLock);
    *size = 0;
    *frameNo = 0;
    if (!IsConnected()) return PSB_NOT_CONNECTED;

    SDK::CrImageInfo info;
    auto error = SDK::GetLiveViewImageInfo(g_device, &info);
    if (CR_FAILED(error))
    {
        g_lastSdkError = error;
        return PSB_SDK_ERROR;
    }
    const auto bufferSize = info.GetBufferSize();
    if (bufferSize < 1) return PSB_NO_FRAME;

    g_frameBuffer.resize(bufferSize);
    SDK::CrImageDataBlock block;
    block.SetSize(bufferSize);
    block.SetData(g_frameBuffer.data());

    error = SDK::GetLiveViewImage(g_device, &block);
    if (error == SDK::CrWarning_Frame_NotUpdated || error == SDK::CrError_Memory_Insufficient) return PSB_NO_FRAME;
    if (CR_FAILED(error))
    {
        g_lastSdkError = error;
        return PSB_SDK_ERROR;
    }

    const auto imageSize = block.GetImageSize();
    const auto* image = block.GetImageData();
    if (imageSize == 0 || image == nullptr) return PSB_NO_FRAME;

    *size = static_cast<int>(imageSize);
    *frameNo = block.GetFrameNo();
    if (static_cast<int>(imageSize) > capacity) return PSB_BUFFER_TOO_SMALL;
    std::memcpy(out, image, imageSize);
    return PSB_OK;
}
