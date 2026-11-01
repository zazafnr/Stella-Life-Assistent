import Foundation

// Bildschirmzeit-Ziele: reine Logik, nur Foundation. Wird von der App UND den Erweiterungen (Monitor, Report) benutzt.
// Gleiche Regeln wie shared/src/screentime.ts (ein Test vergleicht die Zahlen).
//
// Was Apple erlaubt: die App darf Bildschirmzeit-Daten NICHT auslesen. Möglich ist, Schwellen vorab festzulegen (DeviceActivity),
// eine Erweiterung aufwecken zu lassen, wenn sie erreicht sind, und die Daten nur in einer Report-Erweiterung anzuzeigen.
// Zum Server gehen deshalb nur Ziel-Id, Schwelle und Zeitpunkt.

/// Art der Nachricht zu einer erreichten Schwelle
enum ScreenTimeKind: String, CaseIterable {
    case half, noon, eighty, limit, over

    /// Zahl der Textvarianten je Art (wie SCREEN_TIME_VARIANTS in shared)
    var variants: Int {
        switch self {
        case .half, .noon: return 1
        case .eighty, .limit, .over: return 2
        }
    }
}

enum ScreenTimeRules {
    /// Schwellen in Minuten: 50 %, 80 %, 100 % und danach jede volle Stunde darüber (höchstens 16 h)
    static func thresholds(limitMinutes: Int) -> [Int] {
        let limit = Double(max(5, limitMinutes))
        var all = [Int((limit * 0.5).rounded()), Int((limit * 0.8).rounded()), Int(limit)]
        for h in 1...16 where h * 60 > Int(limit) { all.append(h * 60) }
        return Array(Set(all)).filter { $0 > 0 }.sorted()
    }

    /// Welche Art gehört zu einer Schwelle? `hourLocal`: Ortszeit 0–23 (Mittags-Regel: 50 % vor 13 Uhr = „Auf Kurs?“)
    static func kind(minutes: Int, limitMinutes: Int, hourLocal: Int) -> ScreenTimeKind? {
        let limit = Double(max(5, limitMinutes))
        if minutes >= Int(limit) { return minutes == Int(limit) ? .limit : .over }
        if minutes == Int((limit * 0.8).rounded()) { return .eighty }
        if minutes == Int((limit * 0.5).rounded()) { return hourLocal < 13 ? .noon : .half }
        return nil
    }

    static func percent(minutes: Int, limitMinutes: Int) -> Int {
        Int((Double(minutes) / Double(max(5, limitMinutes)) * 100).rounded())
    }

    /// Katalogschlüssel im Ton der Person; die Variante wechselt nach Tag und Ziel
    static func messageKey(tone: String, kind: ScreenTimeKind, seed: Int) -> String {
        kind.variants == 1 ? "screentime.msg.\(tone).\(kind.rawValue)" : "screentime.msg.\(tone).\(kind.rawValue).\(abs(seed) % kind.variants + 1)"
    }
}

/// Ein Ziel, wie es in der App Group liegt (die Auswahl der Apps liegt getrennt, nur auf dem Gerät)
struct ScreenGoal: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var limitMinutes: Int
    var shield: Bool
}

/// Eine erreichte Schwelle, die die Monitor-Erweiterung notiert und die App später an den Server schickt
struct ScreenEvent: Codable, Hashable {
    var goalId: String
    var minutes: Int
    var at: String
}

/// Gemeinsamer Speicher von App und Erweiterungen (App Group). Ohne App Group (z. B. in Swift Playgrounds) gibt es nichts zu tun.
enum ScreenTimeShared {
    static let group = "group.app.stella.ios"
    static var defaults: UserDefaults? { UserDefaults(suiteName: group) }

    private static let goalsKey = "screentime.goals"
    private static let eventsKey = "screentime.events"
    private static let textsKey = "screentime.texts"

    static func goals() -> [ScreenGoal] {
        guard let data = defaults?.data(forKey: goalsKey) else { return [] }
        return (try? JSONDecoder().decode([ScreenGoal].self, from: data)) ?? []
    }

    static func saveGoals(_ goals: [ScreenGoal]) {
        defaults?.set(try? JSONEncoder().encode(goals), forKey: goalsKey)
    }

    /// Auswahl der Apps (FamilyActivitySelection als Daten) – bleibt auf dem Gerät
    static func selection(goalId: String) -> Data? { defaults?.data(forKey: "screentime.selection.\(goalId)") }
    static func saveSelection(_ data: Data?, goalId: String) { defaults?.set(data, forKey: "screentime.selection.\(goalId)") }

    // Ereignisse: die Erweiterung hängt an, die App holt sie ab und schickt sie zum Server
    static func appendEvent(_ event: ScreenEvent) {
        var list = pendingEvents()
        list.append(event)
        defaults?.set(try? JSONEncoder().encode(Array(list.suffix(400))), forKey: eventsKey)
    }

    static func pendingEvents() -> [ScreenEvent] {
        guard let data = defaults?.data(forKey: eventsKey) else { return [] }
        return (try? JSONDecoder().decode([ScreenEvent].self, from: data)) ?? []
    }

    static func clearEvents(_ sent: [ScreenEvent]) {
        let rest = pendingEvents().filter { !sent.contains($0) }
        defaults?.set(try? JSONEncoder().encode(rest), forKey: eventsKey)
    }

    // Texte: die App legt sie vorab ab (im Ton und in der Sprache der Person), die Erweiterung wählt nur noch aus.
    // Schlüssel: "<Ziel-Id>:<Minuten>:<Art>" → Varianten. Die Art (noon/half) entscheidet die Erweiterung zur Laufzeit nach der Uhrzeit.
    static func saveTexts(_ texts: [String: [String]]) { defaults?.set(texts, forKey: textsKey) }

    /// Beständiger Startwert aus der Ziel-Id (hashValue wechselt bei jedem Start)
    static func seed(_ id: String) -> Int { id.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0x7fffffff } }

    static func text(goalId: String, minutes: Int, kind: ScreenTimeKind, day: Int) -> String? {
        guard let all = defaults?.dictionary(forKey: textsKey) as? [String: [String]], let variants = all["\(goalId):\(minutes):\(kind.rawValue)"], !variants.isEmpty else { return nil }
        return variants[(seed(goalId) &+ abs(day)) % variants.count]
    }

    /// Texte für alle Ziele und Schwellen vorbereiten. `message(key, vars)` liefert den Katalogtext (in der App: L()).
    static func prepareTexts(goals: [ScreenGoal], tone: String, message: (String, [String: Any]) -> String) -> [String: [String]] {
        var out: [String: [String]] = [:]
        for g in goals {
            let half = Int((Double(max(5, g.limitMinutes)) * 0.5).rounded())
            for m in ScreenTimeRules.thresholds(limitMinutes: g.limitMinutes) {
                // 50 %: beide Arten ablegen (Mittags-Regel), sonst die eine passende
                let kinds: [ScreenTimeKind] = m == half ? [.noon, .half] : [ScreenTimeRules.kind(minutes: m, limitMinutes: g.limitMinutes, hourLocal: 14)].compactMap { $0 }
                for k in kinds {
                    out["\(g.id):\(m):\(k.rawValue)"] = (0..<k.variants).map { v in
                        message(ScreenTimeRules.messageKey(tone: tone, kind: k, seed: v), ["name": g.name, "hours": m / 60])
                    }
                }
            }
        }
        return out
    }
}
