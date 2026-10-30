import SwiftUI

/** „Woche planen“: Stellas Vorschlag ansehen, Blöcke abwählen, übernehmen */
struct WeekPlanSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(Store.self) private var store
    @State private var plan: WeekPlan?
    @State private var off: Set<String> = []
    @State private var busy = false
    @State private var error: String?

    private struct ApplyBody: Encodable { var blocks: [PlanBlock] }

    private var chosen: [PlanBlock] { (plan?.blocks ?? []).filter { !off.contains($0.key) } }
    private struct PlanDay: Identifiable {
        var date: String
        var blocks: [PlanBlock]
        var id: String { date }
    }
    private var days: [PlanDay] {
        Dictionary(grouping: plan?.blocks ?? [], by: { $0.date }).sorted { $0.key < $1.key }.map { PlanDay(date: $0.key, blocks: $0.value) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.bg.ignoresSafeArea()
                if let plan {
                    if plan.blocks.isEmpty {
                        VStack(spacing: 12) {
                            Cloud(width: 90)
                            Text("Diese Woche gibt es nichts zu planen – keine Tests, keine offenen HÜs.")
                                .multilineTextAlignment(.center)
                                .foregroundStyle(Theme.muted)
                        }
                        .padding(30)
                    } else {
                        list(plan)
                    }
                } else {
                    VStack(spacing: 10) {
                        ProgressView()
                        Text("Stella schaut sich deine Woche an …").foregroundStyle(Theme.muted)
                    }
                }
            }
            .navigationTitle("Woche planen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            }
        }
        .task { await load() }
    }

    private func list(_ plan: WeekPlan) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Lernen für Tests, HÜs und Abgaben – in deinen freien Zeiten, mit Pausen und höchstens zwei Stunden an einem Schultag. Tipp auf einen Block, um ihn wegzulassen.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
                ForEach(days) { d in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(Day.relative(d.date).uppercased()).eyebrow()
                        ForEach(d.blocks) { b in row(b) }
                    }
                }
                if !plan.notes.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(plan.notes, id: \.self) { Text("⚠️ \($0)") }
                    }
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: 0x8A5300))
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: 0xFFF4E5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                if let error { Text(error).font(.system(size: 13)).foregroundStyle(Theme.pinkText) }
                Button { Task { await apply() } } label: {
                    Label(busy ? "Trägt ein …" : "\(chosen.count) \(chosen.count == 1 ? "Block" : "Blöcke") eintragen", systemImage: "calendar.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButton())
                .disabled(busy || chosen.isEmpty)
                Text("Lässt sich unter „Was Stella getan hat“ rückgängig machen.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.faint)
                    .frame(maxWidth: .infinity)
            }
            .padding(20)
        }
    }

    private func row(_ b: PlanBlock) -> some View {
        let on = !off.contains(b.key)
        let color = b.why == "exam" ? Theme.pinkText : b.why == "assignment" ? Theme.green : Theme.blue
        return Button {
            withAnimation(.spring(response: 0.3)) {
                if on { off.insert(b.key) } else { off.remove(b.key) }
            }
            Haptics.soft()
        } label: {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 4)
                VStack(alignment: .leading, spacing: 1) {
                    Text(b.start).font(.system(size: 15, weight: .bold)).monospacedDigit()
                    Text(b.end).font(.system(size: 12)).foregroundStyle(Theme.muted).monospacedDigit()
                }
                .frame(width: 48, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(b.title).font(.system(size: 15, weight: .semibold)).strikethrough(!on)
                    if let f = b.focus { Text(f).font(.system(size: 13)).foregroundStyle(Theme.muted) }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(on ? Theme.blue : Theme.faint)
            }
            .foregroundStyle(Theme.text)
            .padding(12)
            .background(.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: Theme.blue.opacity(0.06), radius: 8, y: 3)
            .opacity(on ? 1 : 0.5)
        }
        .buttonStyle(PressableStyle())
    }

    private func load() async {
        do {
            plan = try await API.shared.get("/api/weekplan")
        } catch {
            self.error = error.localizedDescription
            plan = WeekPlan(from: "", to: "", blocks: [], notes: [])
        }
    }

    private func apply() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await API.shared.send("POST", "/api/weekplan/apply", body: ApplyBody(blocks: chosen), as: OK.self)
            Haptics.success()
            await store.sync()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
