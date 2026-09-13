# Builds photuna_sony_bridge.dll, the C++ bridge between the camera helper and Sony's
# Camera Remote SDK. Needs Visual Studio 2022 Build Tools (C++ workload) and Sony's SDK
# unpacked under electron/bin/CanonCameraHelper/sdk/sony/RemoteCli. The output goes to
# sdk/_build (git-ignored); building the camera helper afterwards copies it into sony/.
#
#   powershell -ExecutionPolicy Bypass -File scripts/build-sony-bridge.ps1

$ErrorActionPreference = 'Stop'

$repo = Split-Path $PSScriptRoot -Parent
$helper = Join-Path $repo 'electron\bin\CanonCameraHelper'
$sdk = Join-Path $helper 'sdk\sony\RemoteCli'

if (-not (Test-Path (Join-Path $sdk 'external\crsdk\Cr_Core.lib'))) {
    throw "Sony's SDK was not found at $sdk. Unpack RemoteCli.zip there first."
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'Visual Studio Build Tools are not installed.' }
$vs = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -latest -property installationPath
if (-not $vs) { throw 'Visual Studio Build Tools with the C++ workload are not installed.' }

$cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
if (-not (Test-Path $cmake)) { throw "CMake was not found at $cmake." }

$build = Join-Path $helper 'sdk\_build\sony-bridge'
$source = Join-Path $helper 'SonyBridge'

& $cmake -S $source -B $build -A x64 -T v143 "-DSONY_SDK_DIR=$($sdk.Replace('\', '/'))"
if ($LASTEXITCODE -ne 0) { throw 'CMake could not configure the Sony bridge.' }

& $cmake --build $build --config Release
if ($LASTEXITCODE -ne 0) { throw 'The Sony bridge did not build.' }

Write-Host "Built $(Join-Path $build 'Release\photuna_sony_bridge.dll')"
