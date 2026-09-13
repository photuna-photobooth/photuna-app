# Canon camera helper

Gives the booth full-resolution captures and manual exposure control from a Canon
camera connected by USB, instead of screenshots of a webcam feed.

It is a separate process on purpose. Camera SDKs are native code that can crash,
hang in a driver call, or stop answering when a cable is pulled. Running outside
Electron means only this process dies; `electron/services/cameraHelper.js` times
the call out, kills the helper, restarts it on the next request, and the booth
falls back to the webcam for that shot.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Process, protocol, timeouts, restart limits, simulated camera | done |
| 1 | Canon EDSDK: connect, full-resolution capture to the PC, battery | needs the SDK |
| 2 | ISO / shutter / aperture / white balance controls in the dashboard | |
| 3 | Live view from the camera for preview and burst clips | |
| 4 | Booth flow integration with per-shot webcam fallback, beta flag | |

Until the SDK is added, the real backend reports `sdkAvailable: false` and every
call fails with `SDK_NOT_INSTALLED`. Nothing in the booth uses it yet.

## Resuming: `PHOTUNA-CANON-PHASE1`

Phase 1 is waiting on Canon approving the business's EDSDK application. When it
is approved, start here, in this order:

1. `node scripts/test-camera-helper.js` — all 14 checks must pass first.
2. Put the SDK in `sdk/` (64-bit `EDSDK.dll`, `EdsImage.dll`, and Canon's C#
   sample wrapper `EDSDK.cs`). It is git-ignored; keep it that way.
3. Read the licence's redistribution terms before planning to bundle the DLLs.
4. Check the test camera's model against the SDK's supported-camera list.
5. Close EOS Webcam Utility and EOS Utility — they cannot share the camera.
6. Implement `CanonBackend.cs`: initialise the SDK, open a session, save to host,
   take a picture and download it to the requested path, read ISO / shutter /
   aperture / white balance from their property descriptions, read battery, pump
   messages on the STA thread, and map SDK errors to the existing error codes.
7. Define `EDSDK` and copy the DLLs only when `sdk/` exists, so builds without
   the SDK still succeed.
8. Add a `--hardware` mode to the test script, run with the camera attached.
9. Ship only the exe and DLLs via electron-builder `extraResources`.

## Canon EDSDK — licensing

The EDSDK is licensed by Canon and is only available after registering with the
Canon developer programme and accepting its licence. It must be obtained by the
business, not downloaded or committed by a contributor.

- Put it under `sdk/` in this folder. That directory is git-ignored; **never
  commit Canon's DLLs or headers.**
- Read the licence's redistribution terms before shipping: bundling `EDSDK.dll`
  and `EdsImage.dll` with the installer must be permitted by the agreement you
  accepted.
- Use the 64-bit DLLs; the helper is `win-x64`.

## Building

```bash
dotnet build -c Release electron/bin/CanonCameraHelper
```

## Testing without a camera

```bash
node scripts/test-camera-helper.js
```

Runs the helper with `--simulate` and checks capture, settings validation, path
safety, and every failure mode below. The simulator is selected only by
`--simulate`, which the app passes only when `PHOTUNA_CAMERA_SIMULATOR=1`, so an
operator can never choose it.

`PHOTUNA_CAMERA_SIM_FAIL` injects failures:

| Value | Simulates |
|---|---|
| `connect` | no camera found |
| `capture` | shutter did not fire |
| `focus` | autofocus failed — the most common real-world failure |
| `hang` | a driver call that never returns |
| `crash` | the helper dying mid-capture |
| `unplug-after-2` | the USB cable pulled after two shots |

## Protocol

Line-delimited JSON over stdin/stdout. stdout carries protocol messages only;
logs go to stderr.

```
→ {"id":"1","cmd":"connect"}
← {"id":"1","ok":true,"result":{"sdkAvailable":true,"connected":true,"model":"...","batteryPercent":87,...}}

→ {"id":"2","cmd":"capture","args":{"directory":"C:\\...\\captures","fileName":"shot_00.jpg","timeoutMs":10000}}
← {"id":"2","ok":false,"error":{"code":"FOCUS_FAILED","message":"..."}}
```

The first line is always `{"event":"ready","backend":"...","protocol":1}`.

| Command | Args | Result |
|---|---|---|
| `status` | | camera status |
| `connect` | | camera status |
| `disconnect` | | camera status |
| `capture` | `directory` (absolute, must exist), `fileName` (plain `.jpg`), `timeoutMs` 1000–30000 | path, width, height, bytes, elapsedMs |
| `getSettings` | | `{ iso, shutterSpeed, aperture, whiteBalance }` each `{ current, allowed[] }` |
| `setSetting` | `key`, `value` (must be in `allowed`) | all settings |
| `shutdown` | | helper exits |

The helper writes only inside `directory`, and only a plain `.jpg` file name, so
a malformed request cannot write elsewhere on the PC.

Error codes the booth acts on: `NO_CAMERA`, `NOT_CONNECTED`, `FOCUS_FAILED`,
`CAPTURE_FAILED`, `DISCONNECTED`, `VALUE_NOT_ALLOWED`, `UNKNOWN_SETTING`,
`SDK_NOT_INSTALLED`, `BAD_REQUEST`; and from the app side `TIMEOUT`,
`HELPER_EXITED`, `HELPER_UNSTABLE`, `HELPER_NOT_FOUND`, `HELPER_START_FAILED`.
