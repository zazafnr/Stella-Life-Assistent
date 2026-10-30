import SwiftUI

/** Eine wichtige Mail oben in der Inbox: warum wichtig, Frist, Antwort – mit Knöpfen zum Erledigen */
struct FocusCard: View {
    var entry: InboxEntry
    var changed: (String) -> Void
    @Environment(Store.self) private var store
    @State private var busy = false
    @State private var replying = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text(InboxRow.initials(entry.sender ?? "?"))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.pinkText)
                    .frame(width: 40, height: 40)
                    .background(Theme.pinkTint, in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(entry.sender ?? "Unbekannt")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text(entry.summary ?? entry.text ?? "")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .fixedSize(horizontal: false, vertical: true)
                    FlowPills(entry: entry)
                }
            }
            HStack(spacing: 10) {
                if entry.deadline != nil, entry.deadlineActionId == nil {
                    Button("Frist eintragen") { Task { await addDeadline() } }
                        .buttonStyle(SmallButton())
                        .disabled(busy)
                }
                if entry.replied == nil {
                    Button("Antwort schreiben") { replying = true }
                        .buttonStyle(SoftButton(filled: entry.needsReply == true && entry.deadline == nil))
                }
                Button {
                    Task { await done() }
                } label: {
                    Label("Erledigt", systemImage: "checkmark").font(.system(size: 13, weight: .semibold))
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(hex: 0xF7C9DC), lineWidth: 1.5))
        .shadow(color: Theme.blue.opacity(0.06), radius: 12, y: 4)
        .sheet(isPresented: $replying) {
            ReplySheet(entry: entry, writeFirst: true) { changed("Wird gesendet ✉️") }
        }
    }

    private func addDeadline() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await API.shared.send("POST", "/api/inbox/\(entry.id)/deadline", as: OK.self)
            Haptics.success()
            changed("Eingetragen")
            await store.sync()
        } catch {
            changed(error.localizedDescription)
        }
    }

    private func done() async {
        _ = try? await API.shared.send("POST", "/api/inbox/\(entry.id)/handled", as: OK.self)
        Haptics.soft()
        changed("")
    }
}

private struct FlowPills: View {
    var entry: InboxEntry

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { pills }
            VStack(alignment: .leading, spacing: 6) { pills }
        }
        .padding(.top, 2)
    }

    @ViewBuilder private var pills: some View {
        if let r = entry.reason, !r.isEmpty { Pill(text: r, tone: .blue) }
        if let d = entry.deadline { Pill(text: "Frist \(Day.relative(d.date))\(d.time.map { " \($0)" } ?? "")", icon: "clock", tone: .pink) }
        if entry.needsReply == true, entry.replied == nil { Pill(text: "Antwort nötig", icon: "arrowshape.turn.up.left", tone: .pink) }
        if entry.replied != nil { Pill(text: "beantwortet", icon: "checkmark", tone: .green) }
    }
}

/** Antwort: Stella schreibt einen Entwurf, du änderst ihn, gesendet wird nur auf „Senden“ */
struct ReplySheet: View {
    var entry: InboxEntry
    /** true: Stella schreibt gleich einen Entwurf; false: leerer Editor zum Selbstschreiben */
    var writeFirst = true
    var sent: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(Store.self) private var store
    @State private var text = ""
    @State private var instruction = ""
    @State private var writing = false
    @State private var sending = false
    @State private var error: String?

    private struct DraftBody: Encodable { var instruction: String }
    private struct Draft: Decodable { var subject: String; var body: String }
    private struct SendBody: Encodable { var body: String }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("An \(entry.sender ?? "Absender")").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.muted)
                    ZStack(alignment: .topLeading) {
                        TextEditor(text: $text)
                            .font(.system(size: 16))
                            .frame(minHeight: 220)
                            .scrollContentBackground(.hidden)
                            .padding(10)
                            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .disabled(writing)
                        if writing {
                            HStack(spacing: 8) { ProgressView(); Text("Stella schreibt …").foregroundStyle(Theme.muted) }
                                .padding(18)
                        }
                    }
                    HStack(spacing: 8) {
                        TextField("Was soll drinstehen? z. B. „bin morgen krank“", text: $instruction)
                            .textFieldStyle(.roundedBorder)
                        Button(text.isEmpty ? "Stella" : "Neu") { Task { await write() } }
                            .buttonStyle(SoftButton(filled: false))
                            .disabled(writing)
                    }
                    if let error { Text(error).font(.system(size: 13)).foregroundStyle(Theme.pinkText) }
                    Text("Gesendet wird nur, wenn du auf „Senden“ tippst.")
                        .font(.system(size: 12)).foregroundStyle(Theme.faint)
                }
                .padding(20)
            }
            .navigationTitle("Antwort")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "Sendet …" : "Senden") { Task { await send() } }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending || writing)
                }
            }
        }
        .task {
            if let d = entry.draft?.body, !d.isEmpty { text = d } else if writeFirst { await write() }
        }
    }

    private func write() async {
        writing = true
        error = nil
        defer { writing = false }
        do {
            let d = try await API.shared.send("POST", "/api/inbox/\(entry.id)/draft", body: DraftBody(instruction: instruction), as: Draft.self)
            text = d.body
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func send() async {
        sending = true
        defer { sending = false }
        do {
            _ = try await API.shared.send("POST", "/api/inbox/\(entry.id)/send", body: SendBody(body: text), as: OK.self)
            Haptics.success()
            sent()
            dismiss()
            await store.sync()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/** heller oder blauer Knopf, gleiche Größe wie SmallButton */
struct SoftButton: ButtonStyle {
    var filled: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(filled ? .white : Theme.blue)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(filled ? Theme.blue : Theme.blueTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}
