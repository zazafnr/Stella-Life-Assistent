import SwiftUI

// Was Stella selbst darf · was sie über dich weiß · was sie getan hat

private let levelShort = ["auto": "Selbst", "notify": "Melden", "ask": "Fragen", "never": "Nie"]
private let levelLong = ["auto": "Macht es einfach", "notify": "Macht es und sagt Bescheid", "ask": "Fragt vorher", "never": "Tut es nie"]

@MainActor
struct PermissionsView: View {
    @Environment(Store.self) private var store
    @State private var rows: [PermissionRow] = []
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Text("Gilt für alles, was Stella von sich aus tut. Worum du sie im Chat bittest, macht sie – außer der Bereich steht auf „Nie“. Erledigtes kannst du 7 Tage lang rückgängig machen.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
            }
            ForEach(rows) { row in
                Section {
                    Picker(row.label, selection: Binding(
                        get: { row.level },
                        set: { level in Task { await set(row.group, level) } }
                    )) {
                        ForEach(row.levels, id: \.self) { Text(levelShort[$0] ?? $0).tag($0) }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text(row.label)
                } footer: {
                    Text("\(row.help) · \(levelLong[row.level] ?? "")")
                }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("Was Stella selbst darf")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        rows = (try? await API.shared.get("/api/permissions", as: [PermissionRow].self)) ?? rows
    }

    private func set(_ group: String, _ level: String) async {
        if let i = rows.firstIndex(where: { $0.group == group }) { rows[i].level = level }
        struct Body: Encodable { var permissions: [String: String] }
        do {
            store.me = try await API.shared.send("PATCH", "/api/settings", body: Body(permissions: [group: level]), as: Me.self)
            error = nil
        } catch {
            self.error = error.localizedDescription
            await load()
        }
    }
}

@MainActor
struct MemoryView: View {
    @State private var data: MemoryList?
    @State private var editing: Memory?
    @State private var draft = ""
    @State private var newText = ""
    @State private var newCategory = "other"

    private let order = ["person", "routine", "school", "preference", "goal", "health", "other"]
    private let weekdays = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

    var body: some View {
        Form {
            Section {
                Text("Stella lernt aus euren Gesprächen selbst dazu und nutzt das zum Planen und Mitdenken. Ändern oder löschen geht jederzeit – auch im Chat mit „vergiss …“.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
            }
            if let data {
                if data.memories.isEmpty {
                    Section { Text("Noch nichts gemerkt. Erzähl Stella einfach von dir – z. B. wann du Training hast.").foregroundStyle(Theme.muted) }
                }
                ForEach(order.filter { c in data.memories.contains { $0.category == c } }, id: \.self) { category in
                    Section(data.categories[category] ?? category) {
                        ForEach(data.memories.filter { $0.category == category }) { m in
                            Button { editing = m; draft = m.text } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(m.text).foregroundStyle(Theme.text)
                                    Text(subtitle(m)).font(.system(size: 13)).foregroundStyle(Theme.muted)
                                }
                            }
                            .swipeActions {
                                Button("Vergessen", role: .destructive) { Task { await delete(m) } }
                            }
                        }
                    }
                }
                Section("Selbst eintragen") {
                    Picker("Bereich", selection: $newCategory) {
                        ForEach(order, id: \.self) { Text(data.categories[$0] ?? $0).tag($0) }
                    }
                    TextField("Stella soll sich merken …", text: $newText)
                    Button("Merken") { Task { await add() } }
                        .disabled(newText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else {
                ProgressView()
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("Was Stella über dich weiß")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Ändern", isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
            TextField("Text", text: $draft)
            Button("Speichern") { Task { await save() } }
            Button("Abbrechen", role: .cancel) { editing = nil }
        }
        .task { await load() }
    }

    private func subtitle(_ m: Memory) -> String {
        var parts: [String] = []
        if let s = m.schedule { parts.append("\(s.days.map { weekdays[$0] }.joined(separator: "/")) \(s.start)–\(s.end)") }
        parts.append(m.source == "user" ? "von dir" : "selbst gelernt")
        return parts.joined(separator: " · ")
    }

    private func load() async {
        data = (try? await API.shared.get("/api/memories", as: MemoryList.self)) ?? data
    }

    private func delete(_ m: Memory) async {
        _ = try? await API.shared.send("DELETE", "/api/memories/\(m.id)", as: OK.self)
        await load()
    }

    private func save() async {
        guard let m = editing else { return }
        struct Body: Encodable { var text: String }
        _ = try? await API.shared.send("PATCH", "/api/memories/\(m.id)", body: Body(text: draft), as: Memory.self)
        editing = nil
        await load()
    }

    private func add() async {
        struct Body: Encodable { var category: String; var text: String }
        _ = try? await API.shared.send("POST", "/api/memories", body: Body(category: newCategory, text: newText), as: Memory.self)
        newText = ""
        await load()
    }
}

@MainActor
struct ActionLogView: View {
    @Environment(Store.self) private var store
    @State private var list: [ActionEntry] = []
    @State private var loaded = false

    var body: some View {
        List {
            if loaded && list.isEmpty {
                Text("Stella hat noch nichts für dich erledigt.").foregroundStyle(Theme.muted)
            }
            ForEach(groupedDays) { group in
                Section(group.day) {
                    ForEach(group.entries) { a in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(time(a.createdAt)).font(.system(size: 12, design: .rounded)).foregroundStyle(Theme.muted)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a.summary.prefix(1).uppercased() + String(a.summary.dropFirst()))
                                        .foregroundStyle(a.status == "undone" || a.status == "rejected" ? Theme.muted : Theme.text)
                                        .strikethrough(a.status == "undone" || a.status == "rejected")
                                    Text(ActionCardView.label(a.status) + (a.source == "auto" ? " · von selbst" : ""))
                                        .font(.system(size: 12))
                                        .foregroundStyle(Theme.muted)
                                }
                            }
                            if a.proposed {
                                HStack {
                                    Button("Ja") { Task { await decide(a.id, "approve") } }.buttonStyle(.borderedProminent)
                                    Button("Nein") { Task { await decide(a.id, "reject") } }.buttonStyle(.bordered)
                                }
                                .font(.system(size: 14, weight: .semibold))
                            }
                        }
                        .swipeActions {
                            if a.canUndo { Button("Rückgängig") { Task { await decide(a.id, "undo") } }.tint(Theme.blue) }
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("Was Stella getan hat")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private struct DayGroup: Identifiable {
        var day: String
        var entries: [ActionEntry]
        var id: String { day }
    }

    private var groupedDays: [DayGroup] {
        var out: [DayGroup] = []
        for a in list {
            let day = ISO.parse(a.createdAt)?.formatted(.dateTime.locale(Locale(identifier: "de_AT")).weekday(.wide).day().month(.wide)) ?? ""
            if out.last?.day == day { out[out.count - 1].entries.append(a) } else { out.append(DayGroup(day: day, entries: [a])) }
        }
        return out
    }

    private func time(_ iso: String) -> String {
        ISO.parse(iso)?.formatted(date: .omitted, time: .shortened) ?? ""
    }

    private func load() async {
        list = (try? await API.shared.get("/api/actions?limit=150", as: [ActionEntry].self)) ?? list
        loaded = true
    }

    private func decide(_ id: String, _ d: String) async {
        try? await store.decide(id, d)
        await load()
    }
}
