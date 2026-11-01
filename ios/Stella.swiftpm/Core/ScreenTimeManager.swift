// Bildschirmzeit auf dem Gerät: Ziele anlegen, Schwellen bei iOS anmelden, Ereignisse zum Server schicken.
// Nur im Xcode-Projekt (ios/project.yml, Bedingung STELLA_SCREENTIME): braucht Family Controls und die Erweiterungen.
// In Swift Playgrounds (Stella.swiftpm) gibt es diesen Teil nicht, die App baut dort ohne Bildschirmzeit weiter.

#if canImport(FamilyControls) && STELLA_SCREENTIME
import DeviceActivity
import FamilyControls
import ManagedSettings
import Foundation
import Observation

@MainActor
@Observable
final class ScreenTimeManager {
    static let shared = ScreenTimeManager()

    var goals: [ScreenGoal] = ScreenTimeShared.goals()
    var error: String?
    /// Ton der Person (die Ansicht setzt ihn); die Mitteilungen der Erweiterung nutzen ihn
    var tone = "nett"

    private struct CreateBody: Encodable { var id: String; var name: String; var limitMinutes: Int; var shield: Bool }
    private struct EventsBody: Encodable { var events: [ScreenEvent] }
    private struct Stored: Decodable { var stored: Int? }

    var authorized: Bool { AuthorizationCenter.shared.authorizationStatus == .approved }

    /// Einmalige Systemabfrage (Family Controls, nur für die eigene Bildschirmzeit)
    func requestAuthorization() async {
        do { try await AuthorizationCenter.shared.requestAuthorization(for: .individual) } catch { self.error = error.localizedDescription }
    }

    /// Neues Ziel: zum Server gehen nur Id, Name und Limit – die Auswahl der Apps bleibt auf dem Gerät (App Group)
    func create(name: String, limitMinutes: Int, shield: Bool, selection: FamilyActivitySelection) async {
        error = nil
        let goal = ScreenGoal(id: UUID().uuidString.lowercased(), name: name, limitMinutes: limitMinutes, shield: shield)
        do {
            _ = try await API.shared.send("POST", "/api/screentime/goals", body: CreateBody(id: goal.id, name: name, limitMinutes: limitMinutes, shield: shield), as: ScreenGoal.self)
            ScreenTimeShared.saveSelection(try PropertyListEncoder().encode(selection), goalId: goal.id)
            goals.append(goal)
            ScreenTimeShared.saveGoals(goals)
            try startMonitoring(goal, selection: selection)
            refreshTexts()
        } catch { self.error = error.localizedDescription }
    }

    func remove(_ goal: ScreenGoal) async {
        _ = try? await API.shared.send("DELETE", "/api/screentime/goals/\(goal.id)", as: OK.self)
        DeviceActivityCenter().stopMonitoring([DeviceActivityName("stella.\(goal.id)")])
        ManagedSettingsStore(named: ManagedSettingsStore.Name(goal.id)).clearAllSettings()
        ScreenTimeShared.saveSelection(nil, goalId: goal.id)
        goals.removeAll { $0.id == goal.id }
        ScreenTimeShared.saveGoals(goals)
    }

    /// Schwellen bei iOS anmelden: täglich 0:00–23:59, Ereignisse bei 50 %, 80 %, 100 % und danach jede volle Stunde
    func startMonitoring(_ goal: ScreenGoal, selection: FamilyActivitySelection) throws {
        let schedule = DeviceActivitySchedule(intervalStart: DateComponents(hour: 0, minute: 0), intervalEnd: DateComponents(hour: 23, minute: 59), repeats: true)
        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        for m in ScreenTimeRules.thresholds(limitMinutes: goal.limitMinutes) {
            events[DeviceActivityEvent.Name("\(goal.id)|\(m)")] = DeviceActivityEvent(
                applications: selection.applicationTokens, categories: selection.categoryTokens, webDomains: selection.webDomainTokens,
                threshold: DateComponents(hour: m / 60, minute: m % 60))
        }
        try DeviceActivityCenter().startMonitoring(DeviceActivityName("stella.\(goal.id)"), during: schedule, events: events)
    }

    /// Nach einem Sprach- oder Tonwechsel die Texte für die Erweiterung neu ablegen (sie hat keinen Zugriff auf den Katalog der App)
    func refreshTexts() {
        ScreenTimeShared.saveTexts(ScreenTimeShared.prepareTexts(goals: goals, tone: tone) { key, vars in L(key, vars) })
    }

    /// Gesammelte Ereignisse zum Server (nur Ziel-Id, Schwelle, Zeit) – beim Start und im Hintergrund
    func syncEvents() async {
        let pending = ScreenTimeShared.pendingEvents()
        guard !pending.isEmpty else { return }
        if (try? await API.shared.send("POST", "/api/screentime/events", body: EventsBody(events: pending), as: Stored.self)) != nil {
            ScreenTimeShared.clearEvents(pending)
        }
    }
}
#endif
