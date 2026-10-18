# InkVoice for iOS — native prototype

This is a native SwiftUI app plus a UIKit keyboard extension, targeting iOS 17+.
It is source code, **not a signed or device-validated release**. The Windows
desktop application is not embedded in this keyboard.

The app explicitly starts a 5- or 15-minute real microphone session. The user
then returns to another app once. While that session remains alive, the keyboard
can start, finish, cancel, and insert multiple dictation segments without opening
the main app each time. **The microphone remains active between segments.**
Idle audio buffers are discarded immediately. This is not an always-off idle mic
or an unlimited background guarantee. The main app and keyboard both show the
active microphone state; iOS also supplies its recording indicator.

Only Apple's on-device `SFSpeechRecognizer` is used. Both
`supportsOnDeviceRecognition` and `isAvailable` must pass, and every request sets
`requiresOnDeviceRecognition = true`. Unsupported devices/languages fail visibly;
there is no network fallback. OS-managed language assets and availability still
need checking on the chosen iPhone. The UI supports Mandarin and US English;
each session selects one recognizer language, not automatic bilingual detection.
Apple's on-device setting guarantees the requested processing mode when supported;
it is not a promise that every new Speech task can start successfully while the
host is backgrounded. That central session workflow still requires iPhone testing.

## Generate and build on a Mac

Prerequisites: a current Xcode with the required iOS SDK, XcodeGen, and a signing
team/provisioning setup that supports App Groups. None is installed by this repo.

1. Choose your own bundle prefix and matching App Group in `project.yml`:
   `INKVOICE_BUNDLE_PREFIX` and `INKVOICE_APP_GROUP`. The checked-in identifiers
   are placeholders, not credentials or pre-provisioned capabilities.
2. Register/enable the same App Group for both app and keyboard targets. Select
   your team for both targets in Xcode. Do not commit personal signing files.
3. Run from this directory:

   ```sh
   xcodegen generate
   open InkVoice.xcodeproj
   ```

4. Select the `InkVoice` scheme and an iPhone. Build/install using Xcode.
   For an unsigned simulator compilation check on a Mac:

   ```sh
   xcodebuild -project InkVoice.xcodeproj -scheme InkVoice \
     -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
   ```

5. In the app, tap a session duration to request Speech and microphone permission.
   Add the InkVoice keyboard in Settings → General → Keyboard → Keyboards, and
   enable Full Access for its App Group communication. Full Access is separate
   from microphone permission; it never lets the extension record directly.

`project.yml` is authoritative for Info/entitlement settings. XcodeGen regenerates
the supplied plists. No keyboard code opens another application: when a session
is absent it tells the user to manually open InkVoice. There is no private
responder-chain trick, URL-launch workaround, silent playback, or fake calling API.

## Tests and limits

```sh
swift test
```

This tests the Foundation-only protocol: stale heartbeat/session, old/duplicate
commands, context leases, result identity and serialization. It does **not** build
the iOS app or exercise audio, file coordination, system keyboard callbacks,
permissions, or background execution. Tests use synthetic strings only.

The repository was authored in Windows. An Apple SDK build, signing, iPhone
microphone test, cross-app insertion test, and App Review have not been performed.
Do not describe this source as a tested iPhone application based on protocol tests.

See [the iOS architecture and device checklist](../../docs/IOS.md) for lifecycle,
privacy, public API sources, and required device acceptance checks.
