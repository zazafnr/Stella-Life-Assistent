import SwiftUI

/** Lesebildschirm einer Mail: Volltext, Antworten (selbst oder von Stella), Verschieben, Erledigt */
@MainActor
struct MailReaderSheet: View {
    var entry: InboxEntry
    var changed: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text: MailBody?
    @State private var loadError: String?
    @State private var reply: ReplyMode?

    struct MailBody: Decodable {
        var body: String
        var truncated: Bool
        var partial: Bool?
    }
    struct CategoryBody: Encodable { var category: String }
    struct MoveResult: Decodable {
        var ok: Bool
        var note: String?
    }

    enum ReplyMode: Int, Identifiable {
        case own, stella
        var id: Int { rawValue }
    }

    private struct Target: Identifiable {
        let id: String
        let label: String
    }

    private let targets = [Target(id: "important", label: "Wichtig"), Target(id: "normal", label: "Neutral"),
                           Target(id: "newsletter", label: "Unwichtig"), Target(id: "spam", label: "Papierkorb")]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let subject = entry.text {
                        Text(subject).font(.system(size: 19, weight: .bold)).foregroundStyle(Theme.text)
                    }
                    HStack(spacing: 6) {
                        if let acc = entry.account { Pill(text: acc) }
                        if let r = entry.reason, !r.isEmpty { Pill(text: r, tone: .blue) }
                        if let d = entry.deadline { Pill(text: "Frist \(Day.relative(d.date))\(d.time.map { " \($0)" } ?? "")", icon: "clock", tone: .pink) }
                        if entry.replied != nil { Pill(text: "beantwortet", icon: "checkmark", tone: .green) }
                    }
                    if let s = entry.summary, s != entry.text {
                        Text("Stella: \(s)").font(.system(size: 13)).foregroundStyle(Theme.muted)
                    }
                    bodyView
                    HStack(spacing: 10) {
                        Button { reply = .own } label: { Label("Antworten", systemImage: "arrowshape.turn.up.left") }
                            .buttonStyle(SoftButton(filled: true))
                        Button { reply = .stella } label: { Label("Stella antworten lassen", systemImage: "sparkles") }
                            .buttonStyle(SoftButton(filled: false))
                    }
                    HStack(spacing: 14) {
                        Menu {
                            ForEach(targets) { target in
                                Button(target.label) { Task { await move(to: target.id) } }
                            }
                        } label: {
                            Label("Verschieben nach …", systemImage: "folder")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        Button { Task { await done() } } label: {
                            Label("Erledigt", systemImage: "checkmark").font(.system(size: 14, weight: .semibold))
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.bg)
            .navigationTitle(entry.sender ?? "Mail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
        }
        .task { await load() }
        .sheet(item: $reply) { mode in
            ReplySheet(entry: entry, writeFirst: mode == .stella) {
                changed("Wird gesendet ✉️")
                dismiss()
            }
        }
    }

    @ViewBuilder private var bodyView: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let loadError {
                Text(loadError).font(.system(size: 14)).foregroundStyle(Theme.pinkText)
            } else if let text {
                Text(text.body)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                if text.partial == true {
                    Text("Nur ein Auszug – das Postfach hat gerade nicht geantwortet.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                } else if text.truncated {
                    Text("Gekürzt – der Rest steht im Original.").font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
            } else {
                HStack(spacing: 8) { ProgressView(); Text("Stella holt die Mail …").foregroundStyle(Theme.muted) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func load() async {
        do {
            text = try await API.shared.get("/api/inbox/\(entry.id)/body", as: MailBody.self)
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func move(to category: String) async {
        do {
            let r: MoveResult = try await API.shared.send("POST", "/api/inbox/\(entry.id)/category", body: CategoryBody(category: category))
            Haptics.soft()
            changed(r.note ?? "Verschoben – Stella merkt sich den Absender")
            dismiss()
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func done() async {
        _ = try? await API.shared.send("POST", "/api/inbox/\(entry.id)/handled", as: OK.self)
        Haptics.soft()
        changed("")
        dismiss()
    }
}
