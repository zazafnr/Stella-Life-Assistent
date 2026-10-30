import SwiftUI

/** Alle Chats, nach Tag gruppiert, mit Titel. Ein alter Chat ist lesbar und kann fortgesetzt werden. */
@MainActor
struct ChatHistorySheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    private struct DayGroup: Identifiable {
        let day: String
        let items: [Conversation]
        var id: String { day }
    }

    private var groups: [DayGroup] {
        var order: [String] = []
        var byDay: [String: [Conversation]] = [:]
        for c in store.conversations {
            if byDay[c.day] == nil { order.append(c.day) }
            byDay[c.day, default: []].append(c)
        }
        return order.map { DayGroup(day: $0, items: byDay[$0] ?? []) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        Task {
                            await store.newConversation()
                            dismiss()
                        }
                    } label: {
                        Label("Neuer Chat", systemImage: "plus")
                            .font(.system(size: 16, weight: .semibold))
                    }
                }
                if store.conversations.isEmpty {
                    Section {
                        Text("Noch keine Chats – schreib Stella, dann taucht der erste hier auf.")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.muted)
                    }
                }
                ForEach(groups) { group in
                    Section(Self.heading(group.day)) {
                        ForEach(group.items) { c in
                            Button {
                                Task {
                                    await store.openConversation(c.id)
                                    dismiss()
                                }
                            } label: { row(c) }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Chats")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
        }
    }

    private func row(_ c: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(c.title ?? c.lastMessage ?? "Chat")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Spacer()
                if c.id == store.conversationId {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.blue)
                }
            }
            if c.title != nil, let last = c.lastMessage {
                Text(last).font(.system(size: 14)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Text("\(c.count) Nachrichten").font(.system(size: 12)).foregroundStyle(Theme.faint)
        }
        .padding(.vertical, 2)
    }

    /** „Heute“, „Gestern“ oder „Mi, 4.11.“ */
    static func heading(_ day: String) -> String {
        guard let date = Day.parse(day) else { return day }
        if Calendar.current.isDateInToday(date) { return "Heute" }
        if Calendar.current.isDateInYesterday(date) { return "Gestern" }
        return date.formatted(.dateTime.weekday(.abbreviated).day().month(.defaultDigits))
    }
}
