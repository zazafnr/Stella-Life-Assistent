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
    @State private var confirmDelete = false
    @State private var deletePassword = ""
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
                        TonePicker(selected: Tone(rawValue: me.settings.tone ?? "nett") ?? .nett) { tone in
                            await save(["tone": .string(tone.rawValue)])
                        }
                    } header: {
                        Text("Wie Stella schreibt")
                    }

                    Section {
                        Button { store.onboardingRequest = .situation } label: {
                            row("Profil", symbol: "person.crop.circle", tint: Theme.pink, detail: Self.profileSummary(me))
                        }
                        Button { store.onboardingRequest = .welcome } label: {
                            row("Einführung wiederholen", symbol: "sparkles", tint: Theme.blue, detail: nil)
                        }
                    } header: {
                        Text("Du & Stella")
                    } footer: {
                        Text("Hier stellst du Stella neu auf dich ein: Lebenssituation, Arbeitszeiten, wobei sie helfen soll.")
                    }

                    Section {
                        NavigationLink { PermissionsView() } label: {
                            row("Was Stella selbst darf", symbol: "checkmark.shield", tint: Theme.blue, detail: nil)
                        }
                        NavigationLink { MemoryView() } label: {
                            row("Was Stella über dich weiß", symbol: "brain.head.profile", tint: Theme.pink, detail: nil)
                        }
                        NavigationLink { ActionLogView() } label: {
                            row("Was Stella getan hat", symbol: "clock.arrow.circlepath", tint: Theme.greenBright,
                                detail: store.waitingForMe > 0 ? "\(store.waitingForMe) offen" : nil)
                        }
                    } header: {
                        Text("Stella als Assistentin")
                    } footer: {
                        Text("Stella lernt selbst dazu und erledigt Dinge für dich – hier legst du fest, was sie darf, und siehst alles, was sie weiß und getan hat.")
                    }

                    Section {
                        BriefingSetting(value: me.settings.briefing ?? "auto") { v in await save(["briefing": .string(v)]) }
                        Toggle(isOn: Binding(
                            get: { me.settings.weekPlan != "off" },
                            set: { on in Task { await save(["weekPlan": .string(on ? "sunday" : "off")]) } }
                        )) {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Wochenplan am Sonntag")
                                    Text("Sonntagabend schlägt Stella einen Plan vor").font(.system(size: 12)).foregroundStyle(Theme.muted)
                                }
                            } icon: { Image(systemName: "calendar.badge.clock") }
                        }
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
                        if me.isSchool {
                            connection("Schulbücher", symbol: "books.vertical", on: me.integrations.books.values.contains { $0.connected },
                                       detail: "digi4school · scook")
                            connection("WebUntis", symbol: "calendar.badge.clock", on: me.integrations.webuntis, detail: "Stundenplan & Entfall")
                        }
                        if me.has("mails") {
                            connection("E-Mail", symbol: "envelope", on: me.integrations.mailAccounts > 0,
                                       detail: me.integrations.mailAccounts == 1 ? "1 Postfach" : "\(me.integrations.mailAccounts) Postfächer")
                        }
                        if me.isSchool {
                            connection("Handschrift", symbol: "pencil.and.scribble", on: me.integrations.handwritingFont, detail: "eigene Schrift für das Heft")
                            connection("FreeNotes", symbol: "ipad.and.iphone", on: me.integrations.freeNotes ?? false, detail: "Heft auf dem iPad")
                        }
                        NavigationLink {
                            ConnectionsView()
                        } label: {
                            Label("Verbinden & anmelden", systemImage: "link.badge.plus")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Theme.blue)
                        }
                    } header: {
                        Text("Verbindungen")
                    } footer: {
                        Text("Gmail mit Google-Anmeldung, Schulbücher auf der echten Anbieter-Seite, WebUntis per QR-Code. Handschrift und FreeNotes richtest du auf der Website ein.")
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

                    if me.role == "owner" {
                        Section {
                            NavigationLink { ServerKeysView() } label: {
                                row("Schlüssel & Absender", symbol: "key.horizontal", tint: Theme.blue, detail: nil)
                            }
                        } header: {
                            Text("Server")
                        } footer: {
                            Text("Groq, OpenRouter und der Mail-Absender für Bestätigungs-Codes – nur für dich als Owner sichtbar.")
                        }
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
                        Button("Konto löschen …", role: .destructive) { deletePassword = ""; confirmDelete = true }
                    }

                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Stella by EVOLSIOR – Built to become")
                                .font(.system(size: 15, weight: .semibold))
                            Text("Der Name steckt in zwei Wörtern: Evolic (sich weiterentwickeln) und Excelsior (immer höher hinaus).")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.muted)
                        }
                    } header: {
                        Text("Über Stella")
                    } footer: {
                        Text("Version 2.0")
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
            .alert("Konto löschen", isPresented: $confirmDelete) {
                SecureField("Passwort", text: $deletePassword)
                Button("Endgültig löschen", role: .destructive) {
                    Task {
                        do {
                            try await store.deleteAccount(password: deletePassword)
                            dismiss()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
                Button("Abbrechen", role: .cancel) {}
            } message: {
                Text("Dein Konto und alle Daten – Chats, Einträge, Mails, Fotos, Aufnahmen und was Stella über dich weiß – werden unwiderruflich gelöscht. Zur Bestätigung dein Passwort.")
            }
            .task {
                notifications = await Notifier.shared.status()
                await store.refreshMe()
                ai = try? await API.shared.get("/api/ai/status", as: AIStatus.self)
            }
        }
    }

    private static func profileSummary(_ me: Me) -> String {
        guard let p = me.settings.profile else { return "noch nicht eingerichtet" }
        let names = ["school": "Schule", "university": "Studium", "work": "Job", "apprenticeship": "Lehre", "other": "Alltag"]
        let label = names[p.situation] ?? p.situation
        if let w = p.workHours { return "\(label) · \(w.start)–\(w.end)" }
        return label
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

/** Drei Karten: nett, frech, cool – mit Beispielsatz */
struct TonePicker: View {
    var selected: Tone
    var onPick: (Tone) async -> Void
    @State private var shown: Tone?

    var body: some View {
        let current = shown ?? selected
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ForEach(Tone.allCases) { tone in
                    let on = tone == current
                    Button {
                        guard tone != current else { return }
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) { shown = tone }
                        Task { await onPick(tone) }
                    } label: {
                        VStack(spacing: 6) {
                            Text(tone.emoji)
                                .font(.system(size: 30))
                                .scaleEffect(on ? 1.18 : 1)
                                .rotationEffect(.degrees(on ? -6 : 0))
                            Text(tone.label)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.text)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(on ? Theme.blueTint : Theme.bg, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(on ? Theme.blue : Theme.border, lineWidth: on ? 2 : 1))
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            Text("„\(current.example)“")
                .font(.system(size: 14).italic())
                .foregroundStyle(Theme.muted)
                .id(current)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
        .padding(.vertical, 6)
        .sensoryFeedback(.selection, trigger: current)
    }
}

/** Morning Briefing: automatisch vor der ersten Stunde, feste Zeit oder aus */
struct BriefingSetting: View {
    var value: String
    var save: (String) async -> Void

    private var mode: String { value == "auto" || value == "off" ? value : "fixed" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker(selection: Binding(get: { mode }, set: { m in Task { await save(m == "fixed" ? "07:00" : m) } })) {
                Text("Automatisch").tag("auto")
                Text("Feste Zeit").tag("fixed")
                Text("Aus").tag("off")
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "sun.horizon.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(Color(hex: 0xFFB86B), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Morning Briefing").foregroundStyle(Theme.text)
                        Text(mode == "auto" ? "45 min vor der ersten Stunde" : mode == "off" ? "kommt nicht" : "jeden Morgen um \(value)")
                            .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                }
            }
            if mode == "fixed" {
                DatePicker("Uhrzeit", selection: Binding(
                    get: { Self.date(value) },
                    set: { d in
                        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
                        Task { await save(String(format: "%02d:%02d", c.hour ?? 7, c.minute ?? 0)) }
                    }
                ), displayedComponents: .hourAndMinute)
                .environment(\.locale, Locale(identifier: "de_AT"))
            }
        }
    }

    private static func date(_ hhmm: String) -> Date {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: p.first ?? 7, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
    }
}
