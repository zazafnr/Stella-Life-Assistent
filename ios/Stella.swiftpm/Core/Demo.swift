import Foundation

/// Startargumente für die Klick-Vorschau (CI-Screenshots im Simulator), z. B.
/// `-server http://localhost:8790 -demoToken … -tab inbox -open weekplan`.
/// Startargumente landen automatisch in UserDefaults – im normalen Betrieb ist alles leer.
enum Demo {
    static var token: String? { UserDefaults.standard.string(forKey: "demoToken") }
    static var tab: String? { UserDefaults.standard.string(forKey: "tab") }
    static func opens(_ screen: String) -> Bool { UserDefaults.standard.string(forKey: "open") == screen }
}
