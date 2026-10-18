// swift-tools-version: 5.9
import PackageDescription

// Foundation-only protocol checks; this does NOT build UIKit/AVAudioEngine targets.
let package = Package(
    name: "InkVoiceProtocol",
    products: [.library(name: "InkVoiceProtocol", targets: ["InkVoiceProtocol"])],
    targets: [
        .target(name: "InkVoiceProtocol", path: "Shared", exclude: ["Mailbox.swift"]),
        .testTarget(name: "InkVoiceProtocolTests", dependencies: ["InkVoiceProtocol"], path: "Tests")
    ]
)
