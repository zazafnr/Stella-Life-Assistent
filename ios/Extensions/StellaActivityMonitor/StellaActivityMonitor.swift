import DeviceActivity
import FamilyControls
import ManagedSettings
import UserNotifications

/// Wird von iOS geweckt, sobald eine vorher festgelegte Schwelle erreicht ist (`eventDidReachThreshold`).
/// Läuft ohne die App: schickt eine lokale Mitteilung (Text aus dem Sprachkatalog im Ton der Person, von der App vorab abgelegt),
/// notiert das Ereignis in der App Group und sperrt bei 100 % auf Wunsch (Shield). Die Ereignisse holt die App später ab.
final class StellaActivityMonitor: DeviceActivityMonitor {
    /// Ereignisname: "<Ziel-Id>|<Minuten>"
    private func parse(_ event: DeviceActivityEvent.Name) -> (goalId: String, minutes: Int)? {
        let parts = event.rawValue.split(separator: "|")
        guard parts.count == 2, let minutes = Int(parts[1]) else { return nil }
        return (String(parts[0]), minutes)
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        guard let (goalId, minutes) = parse(event), let goal = ScreenTimeShared.goals().first(where: { $0.id == goalId }) else { return }

        let now = Date()
        let cal = Calendar.current
        let hour = cal.component(.hour, from: now)
        let day = cal.ordinality(of: .day, in: .era, for: now) ?? 0
        guard let kind = ScreenTimeRules.kind(minutes: minutes, limitMinutes: goal.limitMinutes, hourLocal: hour) else { return }

        ScreenTimeShared.appendEvent(ScreenEvent(goalId: goalId, minutes: minutes, at: ISO8601DateFormatter().string(from: now)))

        if let text = ScreenTimeShared.text(goalId: goalId, minutes: minutes, kind: kind, day: day) {
            let content = UNMutableNotificationContent()
            content.title = "Stella"
            content.body = text
            content.sound = .default
            let request = UNNotificationRequest(identifier: "screentime-\(goalId)-\(minutes)-\(day)", content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request)
        }

        // Ab Limit sperren: nur auf Wunsch (shield), gilt bis zum nächsten Tag
        if kind == .limit, goal.shield, let data = ScreenTimeShared.selection(goalId: goalId),
           let selection = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data) {
            let store = ManagedSettingsStore(named: ManagedSettingsStore.Name(goalId))
            store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
            store.shield.applicationCategories = selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
            store.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
        }
    }

    /// Neuer Tag: Sperren wieder aufheben
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        for goal in ScreenTimeShared.goals() where goal.shield {
            ManagedSettingsStore(named: ManagedSettingsStore.Name(goal.id)).clearAllSettings()
        }
    }
}
