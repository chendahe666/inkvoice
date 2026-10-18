#!/usr/bin/env python3
"""Offline helper logic checks: no display, subprocess or input injection."""
import importlib.util
import json
import pathlib

spec = importlib.util.spec_from_file_location("inkvoice_linux_input", pathlib.Path(__file__).resolve().parents[1] / "native/linux-input.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class Backend:
    def __init__(self, change_after=None, fail=False):
        self.calls = 0
        self.typed = []
        self.change_after = change_after
        self.fail = fail

    def foreground(self):
        self.calls += 1
        return {"handle": "9" if self.change_after and self.calls > self.change_after else "7", "pid": 77}

    def modifiers_held(self):
        return False

    def type_text(self, text):
        if self.fail:
            raise RuntimeError("synthetic-input-failure")
        self.typed.append(text)


cases = []
for name, environment, available, expected in [
    ("wayland-refuses-even-with-xwayland-display", {"WAYLAND_DISPLAY": "synthetic", "DISPLAY": ":99"}, True, False),
    ("wayland-session-type-refuses", {"XDG_SESSION_TYPE": "wayland", "DISPLAY": ":99"}, True, False),
    ("headless-refuses", {}, True, False),
    ("missing-xdotool-refuses", {"DISPLAY": ":99"}, False, False),
    ("x11-tool-capability", {"DISPLAY": ":99", "XDG_SESSION_TYPE": "x11"}, True, True)
]:
    result = helper.capabilities(environment, lambda tool: "/synthetic/xdotool" if available else None, "linux")
    assert result["canInsert"] == expected, name
    cases.append({"name": name, "passed": True})

backend = Backend()
assert helper.insert_text("0", "must not type", backend)["reason"] == "invalid-target"
assert not backend.typed and backend.calls == 0
cases.append({"name": "invalid-target-does-not-inspect-or-type", "passed": True})
backend = Backend()
text = "InkVoice 测试\nEnglish line 😀"
result = helper.insert_text("7", text, backend)
assert result["ok"] and result["count"] == helper.units(text) and "".join(backend.typed) == text
cases.append({"name": "unicode-preserved-and-counted-as-utf16", "passed": True})
backend = Backend(change_after=2)
result = helper.insert_text("7", "a" * 32, backend)
assert not result["ok"] and result["reason"] == "focus-changed" and result["count"] == 16
assert backend.typed == ["a" * 16]
cases.append({"name": "focus-change-stops-further-batches", "passed": True})
backend = Backend(fail=True)
result = helper.insert_text("7", "synthetic", backend)
assert not result["ok"] and result["partial"] and result["count"] == 0
cases.append({"name": "uncertain-delivery-never-reports-complete-success", "passed": True})
backend = Backend()
backend.modifiers_held = lambda: True
ticks = iter([0, 1, 2])
result = helper.insert_text("7", "synthetic", backend, clock=lambda: next(ticks), sleep=lambda delay: None)
assert result["reason"] == "modifiers-held" and not backend.typed
cases.append({"name": "held-modifiers-refuse-without-changing-key-state", "passed": True})
print(json.dumps({"kind": "offline-linux-helper-logic", "passed": True, "cases": cases, "actualInputUsed": False}))
