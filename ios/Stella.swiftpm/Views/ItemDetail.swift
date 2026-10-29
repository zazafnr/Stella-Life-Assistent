import SwiftUI

@MainActor
struct ItemDetail: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    let item: Item
    @State private var viewing: String?
    @State private var burst = 0
    @State private var confirmDelete = false

    /** immer den aktuellen Stand aus dem Store zeigen */
    private var current: Item { store.items[item.id] ?? item }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 14) {
                        KindIcon(kind: current.kind)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(current.title)
                                .font(.system(size: 24, weight: .bold))
                                .foregroundStyle(Theme.text)
                            Text(subtitle)
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        ItemStatusPill(item: current, busy: store.busyItems.contains(current.id))
                    }
                    .rise(0)

                    if let detail = current.detail, !detail.isEmpty { section("Aufgabe", detail).rise(1) }
                    if let material = current.material, !material.isEmpty { section("Stoff", material).rise(2) }
                    if let notes = current.notes, !notes.isEmpty { section("Notizen", notes).rise(3) }

                    if !current.attachments.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("BILDER").eyebrow()
                            ForEach(current.attachments) { a in
                                Button { viewing = a.id } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        AuthImage(id: a.id, contentMode: .fit)
                                            .frame(maxWidth: .infinity)
                                            .frame(minHeight: 160)
                                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                        if let c = a.caption {
                                            Text(c).font(.system(size: 13)).foregroundStyle(Theme.muted)
                                        }
                                    }
                                }
                                .buttonStyle(PressableStyle())
                            }
                        }
                        .rise(4)
                    }

                    ZStack {
                        Button {
                            if !current.isDone { burst += 1 }
                            Task { await store.setDone(current, !current.isDone) }
                        } label: {
                            Label(current.isDone ? "Wieder öffnen" : "Erledigt", systemImage: current.isDone ? "arrow.uturn.backward" : "checkmark")
                        }
                        .buttonStyle(PrimaryButton(tint: current.isDone ? Theme.muted : Theme.greenBright))
                        Confetti(trigger: burst)
                    }
                    .padding(.top, 8)

                    if current.kind == "homework" && store.me?.settings.homeworkAutopilot == true && current.isOpen {
                        Button {
                            Task {
                                await store.send(text: "Löse bitte nochmal \(current.title)\(current.detail.map { " \($0)" } ?? "")")
                                dismiss()
                            }
                        } label: {
                            Label("Stella soll das lösen", systemImage: "sparkles")
                        }
                        .buttonStyle(PrimaryButton(tint: Theme.pink))
                    }

                    Button("Löschen", role: .destructive) { confirmDelete = true }
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 4)
                }
                .padding(22)
            }
            .background(Theme.bg)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
            .confirmationDialog("Eintrag löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Löschen", role: .destructive) {
                    Task { await store.delete(current) }
                    dismiss()
                }
            }
            .sheet(item: Binding(get: { viewing.map(ViewingImage.init) }, set: { viewing = $0?.id })) { ImageViewer(id: $0.id) }
        }
        .presentationDragIndicator(.visible)
    }

    private var subtitle: String {
        var parts: [String] = []
        if let s = current.subject { parts.append(s) }
        if let d = current.due { parts.append(Day.long(d)) }
        if let t = current.time { parts.append(t) }
        return parts.joined(separator: " · ")
    }

    private func section(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased()).eyebrow()
            Text(Bubble.markdown(text))
                .font(.system(size: 16))
                .foregroundStyle(Theme.text)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

struct ViewingImage: Identifiable { var id: String }
