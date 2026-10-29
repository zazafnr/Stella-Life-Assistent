import SwiftUI
import UserNotifications

@MainActor
struct SettingsView: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var ai: AIStatus?
    @State private var notifications: UNAuthorizationStatus = .notDetermined
    @State private var error: String?
    @State private var confirmLogout = false
    @State private var server = API.shared.server

    var body: some View {
        NavigationStack {
            Form {
                if let me = store.me {
                    Section {
                        HStack(spacing: 14) {
                            ZStack {
                                Circle().fill(Theme.pinkTint)
                                Text(InboxRow.initials(me.name)).font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.pinkText)
                            }
                            .frame(width: 52, height: 52)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(me.name).font(.system(size: 18, weight: .semibold))
                                Text(me.email).font(.system(size: 14)).foregroundStyle(Theme.muted)
                            }
                        }
                        .padding(.vertical, 4)
                    }

                    Section {
                        toggle("HÜs selbst lösen", "Stella löst Hausübungen und schreibt sie in deiner Handschrift ins FreeNotes-Heft.",
                               symbol: "wand.and.stars", tint: Theme.pink, value: me.settings.homeworkAutopilot ?? false) { v in
                            await save(["homeworkAutopilot": .bool(v)])
                        }
                        toggle("Werbung löschen", "Spam und Werbung landen automatisch im Papierkorb – zurückholen geht in der Inbox.",
                               symbol: "trash", tint: Theme.blue, value: me.settings.mailAutoTrash ?? false) { v in
                            await save(["mailAutoTrash": .bool(v)])
                        }
                    } header: {
                        Text("Stella macht das für dich")
                    }

                    Section {
                        timeRow("Abend-Erinnerung", symbol: "moon.stars", value: me.settings.eveningTime ?? "19:00") { t in
                            await save(["eveningTime": .string(t)])
                        }
                        timeRow("Lernzeit", symbol: "book", value: me.settings.studyTime ?? "16:00") { t in
                            await save(["studyTime": .string(t)])
                        }
                        Stepper(value: Binding(
                            get: { me.settings.stepGoal ?? 8000 },
                            set: { v in Task { await save(["stepGoal": .int(v)]) } }
                        ), in: 2000...30000, step: 1000) {
                            row("Schritte-Ziel", symbol: "figure.walk", tint: Theme.greenBright,
                                detail: (me.settings.stepGoal ?? 8000).formatted(.number.locale(Locale(identifier: "de_AT"))))
                        }
                    } header: {
                        Text("Zeiten & Ziele")
                    }

                    Section {
                        connection("Schulbücher", symbol: "books.vertical", on: me.integrations.books.values.contains { $0.connected },
                                   detail: "digi4school · scook")
                        connection("WebUntis", symbol: "calendar.badge.clock", on: me.integrations.webuntis, detail: "Stundenplan & Entfall")
                        connection("E-Mail", symbol: "envelope", on: me.integrations.mailAccounts > 0,
                                   detail: me.integrations.mailAccounts == 1 ? "1 Postfach" : "\(me.integrations.mailAccounts) Postfächer")
                        connection("Handschrift", symbol: "pencil.and.scribble", on: me.integrations.handwritingFont, detail: "eigene Schrift für das Heft")
                        connection("FreeNotes", symbol: "ipad.and.iphone", on: me.integrations.freeNotes ?? false, detail: "Heft auf dem iPad")
                        Button {
                            if let url = URL(string: API.shared.server + "/#settings") { openURL(url) }
                        } label: {
                            Label("Verbindungen im Browser einrichten", systemImage: "safari")
                        }
                    } header: {
                        Text("Verbindungen")
                    } footer: {
                        Text("Passwörter und App-Passwörter gibst du einmal auf der Website ein – sie liegen verschlüsselt auf deinem Server.")
                    }

                    Section {
                        HStack {
                            row("Mitteilungen", symbol: "bell.badge", tint: Theme.pink, detail: notificationLabel)
                            if notifications != .authorized {
                                Button("Erlauben") {
                                    Task {
                                        if notifications == .denied {
                                            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                                        } else {
                                            await Notifier.shared.requestPermission()
                                            notifications = await Notifier.shared.status()
                                            await store.replanReminders()
                                        }
                                    }
                                }
                                .font(.system(size: 14, weight: .semibold))
                            }
                        }
                        if Steps.shared.available {
                            row("Schritte vom iPhone", symbol: "shoeprints.fill", tint: Theme.greenBright,
                                detail: Steps.shared.denied ? "in den iOS-Einstellungen erlauben" : "automatisch")
                        }
                    } header: {
                        Text("Dieses Gerät")
                    } footer: {
                        Text("Erinnerungen werden auf dem Gerät eingeplant und kommen auch ohne Internet pünktlich.")
                    }

                    if let ai {
                        Section {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    row("KI heute", symbol: "sparkles", tint: Theme.blue, detail: "\(ai.usedToday) von \(ai.dailyLimit)")
                                }
                                ProgressView(value: Double(ai.usedToday), total: Double(max(ai.dailyLimit, 1)))
                                    .tint(Double(ai.usedToday) / Double(max(ai.dailyLimit, 1)) > 0.8 ? Theme.pink : Theme.blue)
                            }
                        } header: {
                            Text("Kostenlose KI")
                        } footer: {
                            Text(ai.configured ? "Kurznotizen wie „Mathe HÜ Freitag“ versteht Stella ohne KI – die zählen nicht." : "Auf dem Server ist noch kein OpenRouter-Schlüssel eingetragen.")
                        }
                    }

                    Section {
                        HStack {
                            row("Server", symbol: "server.rack", tint: Theme.muted, detail: nil)
                            TextField("Adresse", text: $server)
                                .multilineTextAlignment(.trailing)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .foregroundStyle(Theme.muted)
                                .onSubmit {
                                    API.shared.server = server
                                    server = API.shared.server
                                }
                        }
                        Button("Abmelden", role: .destructive) { confirmLogout = true }
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(Theme.pinkText) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Einstellungen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
            .confirmationDialog("Wirklich abmelden?", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("Abmelden", role: .destructive) {
                    Task { await store.logout() }
                    dismiss()
                }
            }
            .task {
                notifications = await Notifier.shared.status()
                await store.refreshMe()
                ai = try? await API.shared.get("/api/ai/status", as: AIStatus.self)
            }
        }
    }

    private var notificationLabel: String {
        switch notifications {
        case .authorized, .provisional, .ephemeral: return "an"
        case .denied: return "aus – in iOS erlauben"
        default: return "noch nicht erlaubt"
        }
    }

    // MARK: Bausteine

    private func row(_ title: String, symbol: String, tint: Color, detail: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(tint, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(title).foregroundStyle(Theme.text)
            Spacer()
            if let detail { Text(detail).foregroundStyle(Theme.muted).font(.system(size: 15)) }
        }
    }

    private func toggle(_ title: String, _ help: String, symbol: String, tint: Color, value: Bool,
                        save: @escaping (Bool) async -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: Binding(get: { value }, set: { v in Task { await save(v) } })) {
                row(title, symbol: symbol, tint: tint, detail: nil)
            }
            .tint(Theme.blue)
            Text(help)
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
                .padding(.leading, 42)
        }
        .padding(.vertical, 2)
    }

    private func connection(_ title: String, symbol: String, on: Bool, detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(on ? Theme.green : Theme.muted)
                .frame(width: 30, height: 30)
                .background(on ? Theme.greenTint : Color(hex: 0xEEF3FA), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).foregroundStyle(Theme.text)
                Text(detail).font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
            Spacer()
            Pill(text: on ? "verbunden" : "aus", icon: on ? "checkmark" : nil, tone: on ? .green : .gray)
        }
    }

    private func timeRow(_ title: String, symbol: String, value: String, save: @escaping (String) async -> Void) -> some View {
        let date = Self.date(from: value)
        return DatePicker(selection: Binding(get: { date }, set: { d in Task { await save(Self.string(from: d)) } }),
                          displayedComponents: .hourAndMinute) {
            row(title, symbol: symbol, tint: Color(hex: 0xA78BFA), detail: nil)
        }
        .environment(\.locale, Locale(identifier: "de_AT"))
    }

    private static func date(from hhmm: String) -> Date {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: p.first ?? 19, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
    }

    private static func string(from d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    private func save(_ patch: [String: SettingValue]) async {
        do {
            try await store.updateSettings(patch)
            error = nil
            await store.replanReminders()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/** Schritte der letzten zwei Wochen */
@MainActor
struct HealthSheet: View {
    var goal: Int
    @Environment(\.dismiss) private var dismiss
    @State private var days: [HealthDay] = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    let avg = days.compactMap(\.steps).isEmpty ? 0 : days.compactMap(\.steps).reduce(0, +) / days.compactMap(\.steps).count
                    HStack(spacing: 14) {
                        stat("Ø Schritte", avg.formatted(.number.locale(Locale(identifier: "de_AT"))))
                        stat("Ziel erreicht", "\(days.filter { ($0.steps ?? 0) >= goal }.count)×")
                    }
                    StepsChart(days: days, goal: goal)
                        .frame(height: 220)
                        .card()
                    if !Steps.shared.available {
                        Text("Auf diesem Gerät gibt es keinen Schrittzähler – die Zahlen kommen vom iPhone.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .padding(20)
            }
            .background(Theme.bg)
            .navigationTitle("Schritte")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
            .task {
                if let d: [HealthDay] = try? await API.shared.get("/api/health?days=14") { days = d }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 13)).foregroundStyle(Theme.muted)
            Text(value).font(.system(size: 24, weight: .bold, design: .rounded)).foregroundStyle(Theme.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}
