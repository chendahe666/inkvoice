# iOS keyboard prototype

## Implemented contract

`mobile/ios` contains a SwiftUI host and a UIKit system keyboard extension. The
host owns microphone access and on-device Apple Speech recognition. The keyboard
owns text insertion through `textDocumentProxy.insertText`; it does not record.

The user explicitly enables a **5- or 15-minute continuous microphone session**
in the main app, then manually returns to their destination app. During that live
session, keyboard buttons control multiple independent dictation segments without
bringing the host to the foreground. Idle microphone buffers are immediately
discarded, not retained or submitted for recognition. A segment is limited to
45 seconds and final recognition waits at most 15 seconds. These are our product
bounds, not Apple's universal limits.

The microphone remains active between segments. The app and keyboard say this
plainly and provide stop controls; the operating system also displays its mic
indicator. Expiry, interruption, material route change, engine failure, or mailbox
failure stops the host session. The first version does not automatically resume
after interruption or launch itself from the keyboard. Session, segment and
processing deadlines use Swift `ContinuousClock`, which advances through sleep;
changing the wall clock cannot extend the microphone session. The host refreshes
the UI's wall-clock expiry from that deadline. Cross-process heartbeat/command
freshness still fails closed on stale or future wall-clock timestamps. Clock-change
behavior needs device testing; timers are not a background execution guarantee.

Speech and microphone permissions are first requested by a user action in the
host. The OS normally remembers the response. Keyboard Full Access is a separate
setup permission. The extension retains lowercase typed characters, punctuation,
space, return, delete, and next-keyboard controls without Full Access. This is a
basic layout, not a complete Chinese/pinyin or full commercial typing keyboard.

## On-device means on-device

The selected `SFSpeechRecognizer` must report `supportsOnDeviceRecognition` and
`isAvailable`. Every request sets `requiresOnDeviceRecognition = true`. If these
checks fail, the host refuses to start; runtime recognition failure produces an
error, never a server retry. There is no app network client, API key, analytics,
or cloud transcription path in this target. OS language asset downloads and
device/language support are outside this source's control and must be verified.
The current language picker is Mandarin (`zh-CN`) or US English (`en-US`).
No accuracy, latency, bilingual, or offline-device-coverage result is claimed.
The documented audio background mode permits continued recording, but it is not
a blanket guarantee of background `SFSpeechRecognizer` scheduling/availability.
Starting a new on-device Speech task while the recording host is backgrounded is
a critical unverified device test for this prototype. If the OS refuses it, the
current implementation reports failure; it does not foreground itself, upload
audio, or pretend that the entire cross-app workflow has passed.

Whisper is not included. A future native Whisper engine would need real arm64
integration, licensed model distribution, memory/thermal/accuracy measurements,
and background tests. Merely adding a model filename would not make it work.

## Cross-process protocol

Both targets use the same signed App Group, configured by `INKVOICE_APP_GROUP`.
The default `group.org.example.inkvoice` must be replaced/provisioned by the builder.

| File | Writer | Purpose |
| --- | --- | --- |
| `commands/<command-UUID>.json` | Keyboard | Immutable start/finish/cancel/stop command |
| `state.json` | Host only | Session ID, expiry, phase, active request and heartbeat; no transcript |
| `lease-<context-UUID>.json` | That keyboard context | Context liveness and opaque document UUID |
| `result-<request-UUID>.json` | Host only | Final result or error with session/context/request identity |

`NSFileCoordinator` coordinates reads, writes and deletion across processes;
`Data.write(.atomic)` prevents partially read JSON. Commands are separate files,
not a shared read-modify-write array. A live host polls every 0.5 seconds, validates
session ID and a fresh lease, rejects duplicate IDs/old sequence numbers, and
deletes acknowledged commands. A 3-second host heartbeat/keyboard lease TTL fails
closed; commands expire after 10 seconds. Darwin notifications contain no content
and only prompt a poll. They cannot launch or revive a suspended/killed host.

The extension rotates its context nonce on document/selection changes and when
the keyboard disappears. It compares the public document identifier and a
memory-only snapshot of the text proxy context before inserting. Surrounding
document text never goes to the mailbox or recognition engine. Changing input
targets or manually editing while a segment is pending invalidates that segment.
The host also cancels segments after a lost keyboard lease. Final callbacks must
still match the active request. The keyboard consumes a matching result once;
late/mismatched/expired results are not inserted into a new target.

This is intentionally conservative. UIKit callbacks and proxy behavior differ
between hosts; real-device tests must verify both cancellation and false-positive
cancellation. This is not a claim that a keyboard can identify arbitrary host
apps or guarantee insertion into a field that disappeared.

## Local data and privacy

Audio is passed in memory from `AVAudioEngine` to the on-device request and is
never written by this app. Temporary plaintext final results are stored only in
the App Group, with iOS file protection until first unlock. They have a 60-second
validity window; the running host removes expired results and stale leases. If
the host is killed, expired files can remain beyond their TTL until its next
launch, where initialization runs cleanup again. The mailbox directory is marked
`isExcludedFromBackup = true` so transient text is not included in device/iCloud
backups. This is a transient
mailbox, not a history feature, but short TTL does not mean OS-enforced deletion.
No content is logged. Stale commands are rejected and removed on the next live
session. Verify file protection and backup exclusion in the signed build.

Both bundles include `PrivacyInfo.xcprivacy`, currently declaring no tracking,
no off-device collected data, and timer purpose `35F9.1` for monotonic time used
by session/segment/command deadlines (`ContinuousClock`). No clock information is
sent off-device. The source uses no UserDefaults, active-keyboard enumeration,
disk capacity, or file timestamp APIs. Re-evaluate the generated archive privacy
report and all frameworks if the implementation changes; this manifest is not
an App Store privacy-label submission or an approval certificate.

## Public API basis and review boundary

- Apple [keyboard open access](https://developer.apple.com/documentation/uikit/configuring-open-access-for-a-custom-keyboard): Full Access enables shared-container/network abilities; it does not grant keyboard microphone access.
- Apple [recording audio category](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/record) and [audio guidance](https://developer.apple.com/library/archive/documentation/Audio/Conceptual/AudioSessionProgrammingGuide/AudioGuidelinesByAppType/AudioGuidelinesByAppType.html): a host can continue real recording with the audio background mode. Declaring a mode alone is not permission for arbitrary background work.
- Apple [on-device support](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition) and [required on-device request](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition): both checks are necessary to prohibit recognition network fallback.
- Apple [custom keyboards](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/CustomKeyboard.html): insertion uses the text proxy; secure fields and host opt-outs restrict third-party keyboards.
- Apple [text/selection callbacks](https://developer.apple.com/documentation/uikit/handling-text-interactions-in-custom-keyboards) documents overriding the four delegate callbacks in a `UIInputViewController` subclass. [CFNotificationName](https://developer.apple.com/documentation/corefoundation/cfnotificationname) publicly exposes both initializers; this code uses `init(rawValue:)`.
- Apple [ContinuousClock](https://developer.apple.com/documentation/swift/continuousclock) documents sleep-inclusive monotonic time; [required-reason API purposes](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype) identifies `35F9.1` for elapsed-time/timer calculations.
- Apple [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) 2.5 and 4.4.1: public APIs, intended background uses, explicit recording indication, basic keyboard operation without Full Access, and restrictions on keyboard app launching. This implementation asks for manual host opening; a shipped competitor's behavior is not proof of approval for our code.
- Typeless [app-switch states](https://www.typeless.com/help/release-notes/ios/when-does-app-switching-happen): its official UX distinguishes in-place recording from a required app switch. It does not publish an implementation that this project can claim to reproduce.

No private APIs, `UIApplication` responder-chain opening, artificial silent audio,
or repurposed CallKit are used. `UIApplication.shared` appears only in the host to
ensure session activation begins while foreground. Public APIs and truthful
recording behavior still require ordinary App Review; no approval is claimed.

## Required iPhone acceptance checks — all pending

1. Build both targets with an Apple SDK; confirm correct App Group entitlements,
   extension-safe API compilation, embedded extension, privacy manifests, and
   signed installation. A simulator build is only a compile check.
2. First install: exercise allow/deny Speech, mic and Full Access separately;
   without Full Access verify typed letters, delete, space, return and globe.
3. With network disabled and local language resources present, open one session;
   complete ten short segments in Notes, Safari and a messaging field without
   reentering the host. Check insertion exactly once and visible microphone state.
4. Test both 5/15-minute expiry and manual stop from the host and keyboard. Check
   the real OS indicator and confirm microphone release, not just changed UI.
5. Change fields/cursor/selection, type manually, dismiss the keyboard, or switch
   apps during capture and processing. Old results must not appear elsewhere.
6. Test a 45-second segment, no speech, recognition errors, processing timeout,
   missing language support and unavailable service. No cloud fallback or stale
   text insertion is acceptable.
7. Test calls, Siri/audio interruptions, wired/Bluetooth route changes, screen
   locking, low memory, host force-quit, restart, and wall-clock changes. Show a
   truthful expired-session message and recover through manual host activation.
8. Observe memory/energy and privacy behavior for a full 15-minute session; inspect
   transient mailbox cleanup after normal stop and after host termination. Verify
   keyboard TTL behavior under real app switching/load, not only a unit test.

Source implementation is complete for this prototype scope; Apple SDK build,
signing, real microphone/keyboard execution, and store review are **unverified**.
