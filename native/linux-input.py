#!/usr/bin/env python3
"""Independent, optional X11 text input. Wayland always uses manual copy.

No clipboard access, focus activation, daemon, root permission, or shell command
interpolation. Input is passed to xdotool through stdin, never command arguments.
"""
import ctypes
import ctypes.util
import json
import os
import shutil
import signal
import subprocess
import sys
import time

ACTIVE_CHILD = None


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def capabilities(environment=None, find_tool=shutil.which, platform=None):
    env = os.environ if environment is None else environment
    platform = sys.platform if platform is None else platform
    if platform != "linux":
        return {"canInsert": False, "backend": "manual-copy", "reason": "unsupported-platform"}
    if env.get("WAYLAND_DISPLAY") or env.get("XDG_SESSION_TYPE", "").lower() == "wayland":
        return {"canInsert": False, "backend": "manual-copy", "reason": "wayland-manual-copy"}
    if not env.get("DISPLAY"):
        return {"canInsert": False, "backend": "manual-copy", "reason": "no-x11-display"}
    if not find_tool("xdotool"):
        return {"canInsert": False, "backend": "manual-copy", "reason": "xdotool-unavailable"}
    return {"canInsert": True, "backend": "x11-xdotool", "reason": None}


def run_tool(arguments, text=None, timeout=0.6):
    global ACTIVE_CHILD
    ACTIVE_CHILD = subprocess.Popen(["xdotool"] + arguments, stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    encoding="utf-8", errors="strict")
    try:
        stdout, stderr = ACTIVE_CHILD.communicate(text, timeout=timeout)
        if ACTIVE_CHILD.returncode:
            raise RuntimeError("xdotool-failed")
        return stdout.strip()
    except subprocess.TimeoutExpired:
        ACTIVE_CHILD.kill()
        ACTIVE_CHILD.communicate()
        raise RuntimeError("xdotool-timeout")
    finally:
        ACTIVE_CHILD = None


class X11Backend:
    def __init__(self):
        library = ctypes.util.find_library("X11")
        if not library:
            raise RuntimeError("x11-library-unavailable")
        self.x11 = ctypes.CDLL(library)
        self.x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x11.XOpenDisplay.restype = ctypes.c_void_p
        self.x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
        self.x11.XStringToKeysym.restype = ctypes.c_ulong
        self.x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x11.XKeysymToKeycode.restype = ctypes.c_ubyte
        self.x11.XQueryKeymap.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self.display = self.x11.XOpenDisplay(None)
        if not self.display:
            raise RuntimeError("x11-display-unavailable")
        self.modifier_codes = [self.x11.XKeysymToKeycode(self.display, self.x11.XStringToKeysym(name)) for name in
                               (b"Shift_L", b"Shift_R", b"Control_L", b"Control_R", b"Alt_L", b"Alt_R", b"Super_L", b"Super_R", b"Meta_L", b"Meta_R")]

    def close(self):
        if self.display:
            self.x11.XCloseDisplay(self.display)
            self.display = None

    def foreground(self):
        try:
            handle = run_tool(["getactivewindow"])
        except RuntimeError:
            handle = run_tool(["getwindowfocus"])
        if not handle.isdecimal() or int(handle) <= 0:
            raise RuntimeError("foreground-unavailable")
        try:
            pid = int(run_tool(["getwindowpid", handle]))
        except (RuntimeError, ValueError):
            pid = 0
        return {"handle": handle, "pid": pid, "processName": "", "title": "", "backend": "x11-xdotool"}

    def modifiers_held(self):
        mapping = (ctypes.c_ubyte * 32)()
        self.x11.XQueryKeymap(self.display, mapping)
        return any(code and mapping[code >> 3] & (1 << (code & 7)) for code in self.modifier_codes)

    def type_text(self, text):
        run_tool(["type", "--delay", "12", "--file", "-"], text, timeout=1.0)


def units(text):
    return len(text.encode("utf-16-le")) // 2


def insert_text(target, text, backend, clock=time.monotonic, sleep=time.sleep):
    count = 0
    if not target.isdecimal() or int(target) <= 0:
        return {"ok": False, "reason": "invalid-target", "count": 0}
    if len(text) > 1000000 or "\x00" in text:
        return {"ok": False, "reason": "invalid-text", "count": 0}
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    started = clock()
    try:
        initial = backend.foreground()
        if initial["handle"] != target:
            return {"ok": False, "reason": "focus-changed", "count": 0}
        while backend.modifiers_held():
            if backend.foreground()["handle"] != target:
                return {"ok": False, "reason": "focus-changed", "count": 0}
            if clock() - started >= 1.5:
                return {"ok": False, "reason": "modifiers-held", "count": 0}
            sleep(0.01)
        for offset in range(0, len(text), 16):
            current = backend.foreground()
            if current["handle"] != target or (initial["pid"] and current["pid"] != initial["pid"]):
                return {"ok": False, "reason": "focus-changed", "count": count}
            if backend.modifiers_held():
                return {"ok": False, "reason": "modifiers-held", "count": count}
            if clock() - started > 3.5:
                return {"ok": False, "reason": "input-time-budget", "count": count}
            chunk = text[offset:offset + 16]
            try:
                backend.type_text(chunk)
            except (RuntimeError, OSError):
                return {"ok": False, "reason": "input-uncertain", "count": count, "partial": True}
            count += units(chunk)
        return {"ok": True, "count": count, "backend": "x11-xdotool"}
    except (RuntimeError, OSError):
        return {"ok": False, "reason": "foreground-unavailable", "count": count}


def terminate(_signum, _frame):
    if ACTIVE_CHILD is not None:
        ACTIVE_CHILD.terminate()
    raise SystemExit(130)


def main(arguments):
    status = capabilities()
    if arguments == ["--check"]:
        emit({"ok": True, **status, "injectionAttempted": False})
        return 0
    if not status["canInsert"]:
        emit({"ok": False, **status, "handle": None, "pid": 0, "processName": "", "title": "", "count": 0})
        return 2
    backend = None
    try:
        backend = X11Backend()
        if arguments == ["--foreground"]:
            emit(backend.foreground())
            return 0
        if len(arguments) == 3 and arguments[:2] == ["--insert", "--target"]:
            text = sys.stdin.read(1000001)
            result = insert_text(arguments[2], text, backend)
            emit(result)
            return 0 if result["ok"] else 2
        emit({"ok": False, "reason": "invalid-arguments", "count": 0})
        return 2
    except (RuntimeError, OSError, UnicodeError) as error:
        emit({"ok": False, "reason": str(error) if isinstance(error, RuntimeError) else "helper-unavailable", "count": 0, "handle": None, "pid": 0})
        return 2
    finally:
        if backend:
            backend.close()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
