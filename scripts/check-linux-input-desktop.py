#!/usr/bin/env python3
"""Actual input only into our own Tk window; run with xvfb-run -a python3 ..."""
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import tkinter as tk

project = pathlib.Path(__file__).resolve().parents[1]
helper = project / "native/linux-input.py"
expected = "InkVoice 测试\nEnglish line 😀"
root = tk.Tk()
root.title("INKVOICE-ISOLATED-INPUT-CHECK")
root.geometry("650x240+50+50")
text = tk.Text(root)
text.pack(fill="both", expand=True)
other_window = tk.Toplevel(root)
other_window.withdraw()
wrong_handle = str(other_window.winfo_id())
root.update()
root.focus_force()
text.focus_set()
outcome = {}
done = threading.Event()
environment = dict(os.environ)
environment.pop("WAYLAND_DISPLAY", None)
environment["XDG_SESSION_TYPE"] = "x11"


def invoke(arguments, value=""):
    child = subprocess.run([sys.executable, str(helper)] + arguments, input=value, text=True,
                           encoding="utf-8", capture_output=True, timeout=8, env=environment)
    return json.loads(child.stdout)


def worker():
    try:
        foreground = invoke(["--foreground"])
        handle = foreground.get("handle")
        name = subprocess.check_output(["xdotool", "getwindowname", handle], text=True).strip() if handle else ""
        if name != "INKVOICE-ISOLATED-INPUT-CHECK":
            outcome.update(blocked=True, reason="own-window-did-not-acquire-focus")
            return
        # A different, unmapped own test window id must be refused without input.
        outcome["foregroundGuard"] = invoke(["--insert", "--target", wrong_handle], "must never be typed")
        outcome["insertion"] = invoke(["--insert", "--target", handle], expected)
    except Exception as error:
        outcome.update(reason=str(error))
    finally:
        done.set()


started = time.monotonic()


def poll():
    if done.is_set() and time.monotonic() - started > 1:
        outcome["observed"] = text.get("1.0", "end-1c")
        root.destroy()
    elif time.monotonic() - started > 12:
        outcome["reason"] = "own-window-test-timeout"
        root.destroy()
    else:
        root.after(50, poll)


root.after(300, lambda: threading.Thread(target=worker, daemon=True).start())
root.after(50, poll)
root.mainloop()
passed = outcome.get("insertion", {}).get("ok") is True and outcome.get("observed") == expected and outcome.get("foregroundGuard", {}).get("reason") == "focus-changed"
record = {"kind": "actual-linux-x11-own-window-input", "passed": passed, "actualInputVerified": passed,
          "expected": expected, **outcome,
          "scope": "Unicode input and wrong-target refusal in our dedicated Tk control, intended for isolated Xvfb; no other user app or clipboard inspected.",
          "limitations": ["Does not prove arbitrary application compatibility, a real Wayland desktop, or physical microphone operation."]}
(project / "evidence").mkdir(exist_ok=True)
(project / "evidence/linux-input-desktop.json").write_text(json.dumps(record, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(json.dumps(record, ensure_ascii=False))
sys.exit(0 if passed else 1)
