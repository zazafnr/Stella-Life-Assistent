import SwiftUI

/** „Was Stella vorhat“: alles, was Stella von selbst tut – jeder Punkt lässt sich ändern oder abstellen,
    mit „Rückgängig“. Wird in einem NavigationStack gezeigt (aus „Heute“ oder den Einstellungen). */
@MainActor
struct StellaPlanView: View {
    /** springt zu einem Tab (nur aus „Heute“ heraus sinnvoll) */
    var go: ((Tab) -> Void)? = nil
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var data: PlanResponse?
    @State private var undoable: UndoInfo?
    @State private var removing: PlanEntry?
    @State private var error: String?

    private struct UndoInfo: Equatable { var id: String; var text: String }
    private struct ChangeBody: Encodable { var on: Bool?; var time: String?; var remove: Bool? }

    private struct PlanGroup: Identifiable {
        var id: String
        var title: String
        var hint: String
    }

    private let groups: [PlanGroup] = [
        PlanGroup(id: "week", title: "Diese Woche", hint: "Erinnerungen, Lerneinheiten und Vorschläge in den nächsten 7 Tagen"),
        PlanGroup(id: "regular", title: "Regelmäßig", hint: "Was Stella immer wieder von selbst macht"),
        PlanGroup(id: "longterm", title: "Langfristig (Ziele)", hint: "Deine Ziele und wann Stella nachfragt"),
    ]

    var body: some View {
        List {
            Section {
                Text("Alles, was Stella von selbst tut. Jeder Punkt lässt sich ändern oder abstellen – und mit „Rückgängig“ wieder zurückholen.")
                    .font(.system(size: 14)).foregroundStyle(Theme.muted)
            }
            if data == nil && error == nil { Section { Text("Einen Moment …").foregroundStyle(Theme.muted) } }
            if let error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
            if let data {
                ForEach(groups) { group in
                    let entries = data.entries.filter { $0.group == group.id }
                    if !entries.isEmpty {
                        Section {
                            ForEach(entries) { entry in row(entry) }
                        } header: {
                            Text(group.title)
                        } footer: {
                            Text(group.hint)
                        }
                    } else if group.id == "week" {
                        Section(group.title) {
                            Text("In den nächsten 7 Tagen hat Stella nichts Einzelnes vor.").font(.system(size: 14)).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("Was Stella vorhat")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .safeAreaInset(edge: .bottom) {
            if let undoable {
                HStack {
                    Text(undoable.text).font(.system(size: 14)).foregroundStyle(.white).lineLimit(2)
                    Spacer(minLength: 8)
                    Button { Task { await undoLast() } } label: { Label("Rückgängig", systemImage: "arrow.uturn.backward") }
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color(hex: 0xBFD9FF))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Theme.text, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: undoable)
        .confirmationDialog(removing.map { "„\($0.title)“ entfernen?" } ?? "", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { entry in
            Button("Entfernen", role: .destructive) { Task { await change(entry, ChangeBody(on: nil, time: nil, remove: true), "„\(entry.title)“ entfernt") } }
            Button("Abbrechen", role: .cancel) {}
        }
    }

    private func row(_ entry: PlanEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.text)
                Text(entry.when).font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
            .opacity(entry.enabled ? 1 : 0.55)
            ForEach(entry.controls.indices, id: \.self) { index in
                controlView(entry, entry.controls[index])
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func controlView(_ entry: PlanEntry, _ c: PlanControl) -> some View {
        switch c.type {
        case "toggle":
            Toggle(isOn: Binding(
                get: { c.on ?? false },
                set: { on in Task { await change(entry, ChangeBody(on: on, time: nil, remove: nil), "\(entry.title): \(on ? "eingeschaltet" : "ausgeschaltet")") } }
            )) {
                Text(c.on == true ? (c.label ?? "An") : "Aus").font(.system(size: 14)).foregroundStyle(Theme.muted)
            }
            .accessibilityLabel("\(entry.title): \(c.label ?? "An")")
        case "time":
            DatePicker(c.label ?? "Uhrzeit", selection: Binding(
                get: { Self.date(from: c.value ?? "09:00") },
                set: { value in
                    let text = Self.hhmm(value)
                    Task { await change(entry, ChangeBody(on: nil, time: text, remove: nil), "\(entry.title): \(text) Uhr") }
                }
            ), displayedComponents: .hourAndMinute)
            .font(.system(size: 14))
            .foregroundStyle(Theme.muted)
        case "remove":
            Button(role: .destructive) { removing = entry } label: { Label(c.label ?? "Löschen", systemImage: "trash") }
                .font(.system(size: 14, weight: .semibold))
                .buttonStyle(.borderless)
        case "decision":
            HStack(spacing: 8) {
                Button("Ja") { Task { await decide(entry, "approve") } }.buttonStyle(SoftButton(filled: true))
                Button("Nein") { Task { await decide(entry, "reject") } }.buttonStyle(SoftButton(filled: false))
            }
        case "link":
            link(c)
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private func link(_ c: PlanControl) -> some View {
        if c.target == "permissions" {
            NavigationLink { PermissionsView() } label: { Text(c.label ?? "Was Stella selbst darf").font(.system(size: 14, weight: .semibold)) }
        } else if let go, let target = Self.tab(c.target) {
            Button(c.label ?? "Öffnen") { dismiss(); go(target) }
                .font(.system(size: 14, weight: .semibold))
                .buttonStyle(.borderless)
        }
    }

    private static func tab(_ name: String?) -> Tab? {
        switch name {
        case "goals": return .goals
        case "planner": return .planner
        case "inbox": return .inbox
        default: return nil
        }
    }

    private static func date(from hhmm: String) -> Date {
        let parts = hhmm.split(separator: ":")
        let h = parts.count > 0 ? Int(parts[0]) ?? 9 : 9
        let m = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
        return Calendar.current.date(from: DateComponents(hour: h, minute: m)) ?? Date()
    }

    private static func hhmm(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    private func load() async {
        do {
            data = try await API.shared.get("/api/stella/plan")
            error = nil
        } catch {
            if data == nil { self.error = error.localizedDescription }
        }
    }

    private func change(_ entry: PlanEntry, _ body: ChangeBody, _ text: String) async {
        do {
            let encoded = entry.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)?.replacingOccurrences(of: ":", with: "%3A") ?? entry.id
            let r: PlanChangeResponse = try await API.shared.send("POST", "/api/stella/plan/\(encoded)", body: body)
            data = PlanResponse(entries: r.entries, soon: r.soon)
            undoable = UndoInfo(id: r.actionId, text: text)
            Haptics.soft()
            await store.sync()
        } catch {
            self.error = error.localizedDescription
            await load()
        }
    }

    private func undoLast() async {
        guard let undoable else { return }
        do {
            try await store.decide(undoable.id, "undo")
            self.undoable = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func decide(_ entry: PlanEntry, _ decision: String) async {
        do {
            try await store.decide(String(entry.id.dropFirst("proposal:".count)), decision)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/** Karte auf „Heute“: die nächsten drei Dinge, die Stella vorhat */
@MainActor
struct StellaPlanCardView: View {
    var open: () -> Void
    @State private var soon: [PlanEntry]?

    var body: some View {
        Button { open() } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Stella diese Woche").font(.system(size: 17, weight: .bold)).foregroundStyle(Theme.text)
                    Spacer()
                    Text("Alle ansehen").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.blue)
                }
                if let soon, soon.isEmpty {
                    Text("Gerade ist nichts geplant. Sag Stella z. B. „erinnere mich jeden Montag an den Müll“.")
                        .font(.system(size: 13)).foregroundStyle(Theme.muted).multilineTextAlignment(.leading)
                }
                ForEach(soon ?? []) { entry in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(entry.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text)
                        Text(entry.when).font(.system(size: 12.5)).foregroundStyle(Theme.muted)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card(padding: 16)
        }
        .buttonStyle(PressableStyle())
        .task {
            let r: PlanResponse? = try? await API.shared.get("/api/stella/plan")
            soon = r?.soon ?? []
        }
    }
}
