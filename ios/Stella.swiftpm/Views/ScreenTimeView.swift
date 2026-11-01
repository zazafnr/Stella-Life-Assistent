import SwiftUI
#if canImport(FamilyControls) && STELLA_SCREENTIME
import DeviceActivity
import FamilyControls
#endif

#if canImport(FamilyControls) && STELLA_SCREENTIME

/// Ziele → Bildschirmzeit: Ziele anlegen (App-Auswahl über das System-Fenster), die Bildschirmzeit der Woche (Report-Erweiterung) und der Verlauf.
/// Nur im Xcode-Build. Keine Punkte, Serien oder Abzeichen.
struct ScreenTimeView: View {
    @Environment(Store.self) private var store
    @State private var manager = ScreenTimeManager.shared
    @State private var allowed = true
    @State private var adding = false

    struct Status: Decodable { var allowed: Bool }

    private var week: DeviceActivityFilter {
        DeviceActivityFilter(segment: .daily(during: Calendar.current.dateInterval(of: .weekOfYear, for: Date()) ?? DateInterval(start: Date(), duration: 7 * 86_400)),
                             users: .all, devices: .init([.iPhone]))
    }

    var body: some View {
        List {
            if !allowed {
                Section { Text(L("screentime.upgrade")).foregroundStyle(Theme.muted) }
            } else {
                if !manager.authorized {
                    Section { Button(L("screentime.authorize")) { Task { await manager.requestAuthorization() } } }
                }
                Section {
                    ForEach(manager.goals) { g in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(g.name).font(.system(size: 16, weight: .semibold))
                            Text(L("screentime.limitPerDay", ["minutes": g.limitMinutes])).font(.system(size: 13)).foregroundStyle(Theme.muted)
                        }
                    }
                    .onDelete { offsets in
                        let doomed = offsets.map { manager.goals[$0] }
                        Task { for g in doomed { await manager.remove(g) } }
                    }
                    Button { adding = true } label: { Label(L("screentime.new"), systemImage: "plus") }
                        .disabled(!manager.authorized)
                } footer: {
                    Text(L("screentime.privacy"))
                }
                if manager.authorized {
                    Section(L("screentime.report")) {
                        DeviceActivityReport(DeviceActivityReport.Context("stellaOverview"), filter: week).frame(minHeight: 260)
                    }
                }
                if let error = manager.error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle(L("screentime.title"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $adding) { NewScreenGoalView() }
        .task {
            manager.tone = store.me?.settings.tone ?? "nett"
            if let s = try? await API.shared.get("/api/screentime/goals", as: Status.self) { allowed = s.allowed }
            manager.refreshTexts()
            await manager.syncEvents()
        }
        .onChange(of: store.me?.settings.tone) { _, tone in manager.tone = tone ?? "nett"; manager.refreshTexts() }
        .onChange(of: I18n.shared.locale) { _, _ in manager.refreshTexts() }
    }
}

/// Neues Ziel: Name, Tageslimit, Auswahl der Apps im System-Fenster, optional „Ab Limit sperren“
struct NewScreenGoalView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var manager = ScreenTimeManager.shared
    @State private var name = ""
    @State private var minutes = 60
    @State private var shield = false
    @State private var selection = FamilyActivitySelection()
    @State private var picking = false
    @State private var busy = false

    private var hasSelection: Bool { !selection.applicationTokens.isEmpty || !selection.categoryTokens.isEmpty || !selection.webDomainTokens.isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("screentime.name"), text: $name)
                    Stepper(L("screentime.limitPerDay", ["minutes": minutes]), value: $minutes, in: 15...600, step: 15)
                    Button { picking = true } label: {
                        Label(L("screentime.pick"), systemImage: hasSelection ? "checkmark.circle.fill" : "apps.iphone")
                    }
                    Toggle(L("screentime.shield"), isOn: $shield)
                } footer: {
                    Text(L("screentime.privacy"))
                }
            }
            .navigationTitle(L("screentime.new"))
            .navigationBarTitleDisplayMode(.inline)
            .familyActivityPicker(isPresented: $picking, selection: $selection)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("common.save")) {
                        busy = true
                        Task { await manager.create(name: name.trimmingCharacters(in: .whitespaces), limitMinutes: minutes, shield: shield, selection: selection); dismiss() }
                    }
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || !hasSelection)
                }
            }
        }
    }
}

#else

/// In Swift Playgrounds (ohne Family Controls) gibt es keine Bildschirmzeit; der Bereich sagt das ehrlich
struct ScreenTimeView: View {
    var body: some View {
        List { Section { Text(L("screentime.notInBuild")).foregroundStyle(Theme.muted) } }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(L("screentime.title"))
            .navigationBarTitleDisplayMode(.inline)
    }
}

#endif
