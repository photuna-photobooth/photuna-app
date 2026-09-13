# Builds the USB camera helper ready to ship: the Sony bridge (when Sony's SDK is
# present), then a self-contained canon-camera-helper.exe with whichever camera SDKs
# this PC has, published to electron/bin/CanonCameraHelper/bin/publish.
#
#   powershell -ExecutionPolicy Bypass -File scripts/build-camera-helper.ps1
#
# A build PC needs:
#   - .NET SDK 8 or newer                       (dotnet --list-sdks)
#   - Camera SDKs unpacked under electron/bin/CanonCameraHelper/sdk/ (licensed to the
#     business, never committed):  sdk/nikon/S-SDKZ-200BF-ALLIN, sdk/sony/RemoteCli
#   - For Sony only: Visual Studio 2022 Build Tools with the C++ workload
# Brands whose SDK is missing are simply left out; the booth then keeps the webcam
# for them.

$ErrorActionPreference = 'Stop'

$repo = Split-Path $PSScriptRoot -Parent
$helper = Join-Path $repo 'electron\bin\CanonCameraHelper'
$publish = Join-Path $helper 'bin\publish'

$sdks = & dotnet --list-sdks 2>$null
if (-not ($sdks | Where-Object { [int]($_.Split('.')[0]) -ge 8 })) {
    throw '.NET SDK 8 or newer is not installed.'
}

$hasNikon = Test-Path (Join-Path $helper 'sdk\nikon\S-SDKZ-200BF-ALLIN\Module\Win\BinaryFile\ControlServiceLayer.dll')
$hasSony = Test-Path (Join-Path $helper 'sdk\sony\RemoteCli\external\crsdk\Cr_Core.lib')

if ($hasSony) {
    & (Join-Path $PSScriptRoot 'build-sony-bridge.ps1')
}

if (Test-Path $publish) { Remove-Item -Recurse -Force $publish }

& dotnet publish $helper -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $publish
if ($LASTEXITCODE -ne 0) { throw 'The camera helper did not build.' }

$exe = Join-Path $publish 'canon-camera-helper.exe'
if (-not (Test-Path $exe)) { throw "Build finished but $exe is missing." }

$included = @()
if (Test-Path (Join-Path $publish 'nikon\ControlServiceLayer.dll')) { $included += 'Nikon Z' }
if (Test-Path (Join-Path $publish 'sony\photuna_sony_bridge.dll')) { $included += 'Sony' }
if ($hasNikon -and -not ($included -contains 'Nikon Z')) { throw 'Nikon SDK is present but was not copied into the build.' }
if ($hasSony -and -not ($included -contains 'Sony')) { throw 'Sony SDK is present but was not copied into the build.' }

$sizeMb = [math]::Round(((Get-ChildItem $publish -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ''
Write-Host "Camera helper built: $publish ($sizeMb MB)"
Write-Host ("Camera brands included: " + $(if ($included.Count) { $included -join ', ' } else { 'none (webcam only)' }))
