// Independent InkVoice Windows input helper. No third-party application code.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class InkVoiceInput
{
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const int MaximumTextUnits = 1000000;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk, wScan;
        public uint dwFlags, time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL, wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mouse;
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public HARDWAREINPUT hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion data;
    }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maximum);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    private sealed class InsertResult
    {
        public bool ok;
        public int count;
        public string reason;
        public int win32Error;
        public int sentEvents;
    }

    private static void Emit(object value)
    {
        Console.WriteLine(Json.Serialize(value));
    }

    private static object Error(string reason)
    {
        return new { ok = false, reason = reason };
    }

    private static object ResultObject(InsertResult result)
    {
        if (result.ok) return new { ok = true, count = result.count, sentEvents = result.sentEvents };
        return new { ok = false, reason = result.reason, count = result.count, sentEvents = result.sentEvents, win32Error = result.win32Error };
    }

    private static bool ModifiersHeld()
    {
        int[] keys = { 0x10, 0x11, 0x12, 0x5B, 0x5C };
        foreach (int key in keys) if ((GetAsyncKeyState(key) & 0x8000) != 0) return true;
        return false;
    }

    private static string TargetProblem(IntPtr target, uint expectedPid)
    {
        if (target == IntPtr.Zero || !IsWindow(target)) return "invalid-target";
        if (GetForegroundWindow() != target) return "focus-changed";
        uint currentPid;
        GetWindowThreadProcessId(target, out currentPid);
        if (currentPid == 0 || currentPid != expectedPid) return "target-changed";
        return null;
    }

    private static INPUT UnicodeInput(char unit, bool keyUp)
    {
        INPUT value = new INPUT();
        value.type = INPUT_KEYBOARD;
        value.data.keyboard.wScan = unit;
        value.data.keyboard.dwFlags = KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0);
        return value;
    }

    private static InsertResult Insert(IntPtr target, string source)
    {
        InsertResult result = new InsertResult();
        if (IntPtr.Size != 8 || Marshal.SizeOf(typeof(INPUT)) != 40)
        {
            result.reason = "unsupported-input-layout";
            return result;
        }
        if (source.Length > MaximumTextUnits)
        {
            result.reason = "text-too-large";
            return result;
        }
        uint expectedPid;
        GetWindowThreadProcessId(target, out expectedPid);
        string problem = TargetProblem(target, expectedPid);
        if (problem != null) { result.reason = problem; return result; }
        Stopwatch wait = Stopwatch.StartNew();
        while (ModifiersHeld())
        {
            problem = TargetProblem(target, expectedPid);
            if (problem != null) { result.reason = problem; return result; }
            if (wait.ElapsedMilliseconds >= 1500) { result.reason = "modifiers-held"; return result; }
            Thread.Sleep(10);
        }

        // Windows edit controls interpret CR as the return character. One LF or
        // CRLF in input becomes one Unicode CR event; other UTF-16 units survive.
        string normalized = source.Replace("\r\n", "\n").Replace('\r', '\n').Replace('\n', '\r');
        const int batchUnits = 16;
        for (int offset = 0; offset < normalized.Length; )
        {
            problem = TargetProblem(target, expectedPid);
            if (problem != null) { result.reason = problem; return result; }
            if (ModifiersHeld()) { result.reason = "modifiers-held"; return result; }
            int take = Math.Min(batchUnits, normalized.Length - offset);
            // Never split a surrogate pair across focus checks / SendInput calls.
            if (offset + take < normalized.Length && Char.IsHighSurrogate(normalized[offset + take - 1]) && Char.IsLowSurrogate(normalized[offset + take])) take--;
            INPUT[] events = new INPUT[take * 2];
            for (int index = 0; index < take; index++)
            {
                events[index * 2] = UnicodeInput(normalized[offset + index], false);
                events[index * 2 + 1] = UnicodeInput(normalized[offset + index], true);
            }
            uint sent = SendInput((uint)events.Length, events, Marshal.SizeOf(typeof(INPUT)));
            result.sentEvents += (int)sent;
            result.count += (int)sent / 2;
            if (sent != events.Length)
            {
                result.reason = "send-input-failed";
                result.win32Error = Marshal.GetLastWin32Error();
                return result;
            }
            offset += take;
            // Allow foreground changes to become observable between small batches.
            Thread.Sleep(1);
        }
        result.ok = true;
        return result;
    }

    private static int Foreground()
    {
        IntPtr handle = GetForegroundWindow();
        uint pid;
        GetWindowThreadProcessId(handle, out pid);
        string processName = "";
        if (pid != 0)
        {
            try { using (Process process = Process.GetProcessById((int)pid)) processName = process.ProcessName; }
            catch (ArgumentException) { }
            catch (Win32Exception) { }
        }
        StringBuilder title = new StringBuilder(Math.Min(GetWindowTextLength(handle) + 1, 8192));
        GetWindowText(handle, title, title.Capacity);
        Emit(new { handle = handle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture), pid = pid, processName = processName, title = title.ToString() });
        return 0;
    }

    private static int Check()
    {
        IntPtr foreground = GetForegroundWindow();
        bool ok = IntPtr.Size == 8 && Marshal.SizeOf(typeof(INPUT)) == 40 && Marshal.SizeOf(typeof(KEYBDINPUT)) == 24;
        Emit(new {
            ok = ok, architecture = IntPtr.Size == 8 ? "x64" : "x86", pointerSize = IntPtr.Size,
            inputSize = Marshal.SizeOf(typeof(INPUT)), keyboardInputSize = Marshal.SizeOf(typeof(KEYBDINPUT)),
            inputUnionOffset = Marshal.OffsetOf(typeof(INPUT), "data").ToInt32(),
            foregroundApiAvailable = true, foregroundWindowPresent = foreground != IntPtr.Zero,
            injectionAttempted = false
        });
        return ok ? 0 : 1;
    }

    private static int SelfTestInput()
    {
        const string expected = "InkVoice 测试\nEnglish line \uD83D\uDE00";
        InsertResult insertion = null;
        InsertResult wrongTarget = null;
        string failure = null;
        string observed = "";
        int finished = 0;
        bool began = false;
        Stopwatch timeout = Stopwatch.StartNew();
        Application.EnableVisualStyles();
        using (Form form = new Form())
        using (Form otherOwnWindow = new Form())
        using (TextBox box = new TextBox())
        using (System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer())
        {
            form.Text = "InkVoice input verification — own temporary window";
            form.Width = 620;
            form.Height = 220;
            form.StartPosition = FormStartPosition.CenterScreen;
            box.Multiline = true;
            box.AcceptsReturn = true;
            box.Dock = DockStyle.Fill;
            box.Font = new System.Drawing.Font("Segoe UI", 14);
            form.Controls.Add(box);
            // Create a second, hidden, own-process HWND to verify the live
            // foreground guard without risking text in another application.
            IntPtr wrongHandle = otherOwnWindow.Handle;
            IntPtr ownHandle = IntPtr.Zero;
            form.Shown += delegate {
                ownHandle = form.Handle;
                form.Activate();
                box.Focus();
                SetForegroundWindow(ownHandle);
                timer.Start();
            };
            timer.Interval = 100;
            timer.Tick += delegate {
                if (!began && timeout.ElapsedMilliseconds >= 400)
                {
                    began = true;
                    if (GetForegroundWindow() != ownHandle || !box.Focused)
                    {
                        failure = "foreground-unavailable";
                        form.Close();
                        return;
                    }
                    Thread worker = new Thread(delegate() {
                        try
                        {
                            wrongTarget = Insert(wrongHandle, "must never be inserted");
                            if (wrongTarget.ok || wrongTarget.reason != "focus-changed") failure = "foreground-guard-failed";
                            else insertion = Insert(ownHandle, expected);
                        }
                        catch (Exception exception) { failure = exception.GetType().Name; }
                        finally { Interlocked.Exchange(ref finished, 1); }
                    });
                    worker.IsBackground = true;
                    worker.Start();
                }
                if (Interlocked.CompareExchange(ref finished, 0, 0) != 0 && timeout.ElapsedMilliseconds >= 850)
                {
                    observed = box.Text.Replace("\r\n", "\n").Replace('\r', '\n');
                    form.Close();
                }
                else if (timeout.ElapsedMilliseconds > 6000)
                {
                    failure = "test-timeout";
                    form.Close();
                }
            };
            Application.Run(form);
        }
        bool passed = failure == null && insertion != null && insertion.ok && observed == expected;
        Emit(new {
            ok = passed, kind = "real-desktop-input", target = "own-temporary-winforms-textbox",
            actualInputVerified = passed, blocked = failure == "foreground-unavailable",
            reason = failure ?? (insertion == null ? "test-window-closed" : (!insertion.ok ? insertion.reason : (observed != expected ? "text-mismatch" : null))),
            expected = expected, observed = observed,
            checks = new { chinese = observed.Contains("测试"), english = observed.Contains("English line"), newline = observed.Contains("\n"), emoji = observed.Contains("\uD83D\uDE00") },
            foregroundGuard = wrongTarget == null ? null : ResultObject(wrongTarget),
            insertion = insertion == null ? null : ResultObject(insertion)
        });
        return passed ? 0 : 2;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            if (args.Length == 1 && args[0] == "--foreground") return Foreground();
            if (args.Length == 1 && args[0] == "--check") return Check();
            if (args.Length == 1 && args[0] == "--self-test-input") return SelfTestInput();
            if (args.Length == 3 && args[0] == "--insert" && args[1] == "--target")
            {
                long numeric;
                if (!Int64.TryParse(args[2], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out numeric) || numeric <= 0)
                {
                    Emit(Error("invalid-target"));
                    return 2;
                }
                InsertResult result = Insert(new IntPtr(numeric), Console.In.ReadToEnd());
                Emit(ResultObject(result));
                return result.ok ? 0 : 2;
            }
            Emit(Error("usage: --foreground | --check | --insert --target <decimal-hwnd> | --self-test-input"));
            return 2;
        }
        catch (Exception exception)
        {
            Emit(new { ok = false, reason = "helper-error", error = exception.GetType().Name, message = exception.Message });
            return 1;
        }
    }
}
