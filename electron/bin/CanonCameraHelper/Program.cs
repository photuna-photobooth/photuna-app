using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CanonCameraHelper;

/// <summary>
/// Line-delimited JSON over stdin/stdout, one request per line:
///
///   → {"id":"7","cmd":"capture","args":{"directory":"C:\\...","fileName":"shot_00.jpg"}}
///   ← {"id":"7","ok":true,"result":{"path":"...","width":6000,...}}
///   ← {"id":"7","ok":false,"error":{"code":"FOCUS_FAILED","message":"..."}}
///
/// Unsolicited messages carry "event" instead of "id" (the first is always
/// {"event":"ready",...}). stdout carries protocol messages only; anything
/// human-readable goes to stderr, so a stray log line can never corrupt a reply.
/// </summary>
internal static class Program
{
    private const int ProtocolVersion = 1;
    private const int MaxLineLength = 64_000;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // A file name the app chose, never a path: the helper writes only inside the
    // directory it is given, so a malformed request cannot write anywhere else.
    private static readonly Regex SafeFileName =
        new(@"^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}\.jpe?g$", RegexOptions.CultureInvariant);

    [STAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

        ICameraBackend backend = args.Contains("--simulate")
            ? new SimulatedBackend()
            : new CanonBackend();

        Log($"starting with backend {backend.Name}");
        Emit(new JsonObject
        {
            ["event"] = "ready",
            ["backend"] = backend.Name,
            ["protocol"] = ProtocolVersion,
        });

        try
        {
            string? line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Length == 0) continue;
                if (!Handle(backend, line)) break;
            }
        }
        finally
        {
            try { backend.Disconnect(); } catch (Exception ex) { Log($"disconnect on exit failed: {ex.Message}"); }
            backend.Dispose();
            Log("stopped");
        }

        return 0;
    }

    /// <returns>false when the helper should exit.</returns>
    private static bool Handle(ICameraBackend backend, string line)
    {
        string? id = null;

        try
        {
            if (line.Length > MaxLineLength)
                throw new CameraException("BAD_REQUEST", "Request is too large.");

            var request = JsonNode.Parse(line)?.AsObject()
                ?? throw new CameraException("BAD_REQUEST", "Request is not a JSON object.");

            id = request["id"]?.GetValue<string>();
            var cmd = request["cmd"]?.GetValue<string>()
                ?? throw new CameraException("BAD_REQUEST", "Missing cmd.");
            var args = request["args"] as JsonObject ?? new JsonObject();

            switch (cmd)
            {
                case "status":
                    Reply(id, backend.GetStatus());
                    return true;

                case "connect":
                    Reply(id, backend.Connect());
                    return true;

                case "disconnect":
                    backend.Disconnect();
                    Reply(id, backend.GetStatus());
                    return true;

                case "capture":
                    Reply(id, Capture(backend, args));
                    return true;

                case "getSettings":
                    Reply(id, backend.GetSettings());
                    return true;

                case "setSetting":
                {
                    var key = RequiredString(args, "key");
                    if (!SettingKeys.All.Contains(key))
                        throw new CameraException("UNKNOWN_SETTING", $"Unknown setting '{key}'.");
                    Reply(id, backend.SetSetting(key, RequiredString(args, "value")));
                    return true;
                }

                case "shutdown":
                    Reply(id, new { stopping = true });
                    return false;

                default:
                    throw new CameraException("UNKNOWN_COMMAND", $"Unknown command '{cmd}'.");
            }
        }
        catch (CameraException ex)
        {
            Fail(id, ex.Code, ex.Message);
        }
        catch (JsonException ex)
        {
            Fail(id, "BAD_REQUEST", $"Malformed JSON: {ex.Message}");
        }
        catch (InvalidOperationException ex)
        {
            Fail(id, "BAD_REQUEST", ex.Message);
        }
        catch (Exception ex)
        {
            Log($"unexpected failure: {ex}");
            Fail(id, "INTERNAL", ex.Message);
        }

        return true;
    }

    private static CaptureResult Capture(ICameraBackend backend, JsonObject args)
    {
        var directory = RequiredString(args, "directory");
        var fileName = RequiredString(args, "fileName");

        if (!Path.IsPathFullyQualified(directory))
            throw new CameraException("BAD_REQUEST", "directory must be an absolute path.");
        if (!Directory.Exists(directory))
            throw new CameraException("BAD_REQUEST", "directory does not exist.");
        if (!SafeFileName.IsMatch(fileName))
            throw new CameraException("BAD_REQUEST", "fileName must be a plain .jpg name.");

        var timeoutMs = args["timeoutMs"]?.GetValue<int>() ?? 10_000;
        timeoutMs = Math.Clamp(timeoutMs, 1_000, 30_000);

        return backend.Capture(Path.Combine(directory, fileName), TimeSpan.FromMilliseconds(timeoutMs));
    }

    private static string RequiredString(JsonObject args, string name)
    {
        var value = args[name]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(value))
            throw new CameraException("BAD_REQUEST", $"Missing {name}.");
        return value;
    }

    private static void Reply(string? id, object result)
    {
        Emit(new JsonObject
        {
            ["id"] = id,
            ["ok"] = true,
            ["result"] = JsonSerializer.SerializeToNode(result, result.GetType(), JsonOptions),
        });
    }

    private static void Fail(string? id, string code, string message)
    {
        Emit(new JsonObject
        {
            ["id"] = id,
            ["ok"] = false,
            ["error"] = new JsonObject { ["code"] = code, ["message"] = message },
        });
    }

    private static void Emit(JsonNode message)
    {
        Console.Out.WriteLine(message.ToJsonString(JsonOptions));
        Console.Out.Flush();
    }

    private static void Log(string message)
    {
        Console.Error.WriteLine($"[canon-camera-helper] {message}");
        Console.Error.Flush();
    }
}
