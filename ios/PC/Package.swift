// swift-tools-version: 5.9
// Stella am PC: Ersatz für SwiftUI und die iPhone-Frameworks, damit die echte App
// (Stella.swiftpm bzw. StellaStudents.swiftpm) unverändert unter Windows und Linux läuft.
// Gebaut wird über scripts/stella-pc.ps1 bzw. scripts/stella-pc.sh, die ein App-Paket daneben erzeugen.
import PackageDescription

let frameworks = ["UIKit", "Charts", "PhotosUI", "UserNotifications", "CoreLocation", "CoreMotion",
                  "AVFoundation", "WebKit", "VisionKit", "SafariServices", "AuthenticationServices", "Security"]

let package = Package(
    name: "StellaPC",
    products: [.library(name: "StellaPC", targets: ["SwiftUI"] + frameworks)],
    targets: [
        .target(name: "SwiftUI", resources: [.copy("Web")]),
    ] + frameworks.map { .target(name: $0, dependencies: ["SwiftUI"]) }
)
