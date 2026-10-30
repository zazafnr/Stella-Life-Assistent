import SwiftUI

/** Die Einkaufsliste zum Abhaken. Stella ergänzt im Chat („schreib Milch auf die Einkaufsliste“). */
@MainActor
struct ShoppingListSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var list: StellaList?
    @State private var text = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    private struct AddBody: Encodable { var text: String }
    private struct DoneBody: Encodable { var done: Bool }

    private var open: [ListEntry] { list?.items.filter { !$0.done } ?? [] }
    private var done: [ListEntry] { list?.items.filter(\.done) ?? [] }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 10) {
                        TextField("Was brauchst du? z. B. 2 Liter Milch", text: $text)
                            .focused($focused)
                            .submitLabel(.done)
                            .onSubmit { Task { await add() } }
                        Button { Task { await add() } } label: {
                            Image(systemName: "plus.circle.fill").font(.system(size: 24)).foregroundStyle(Theme.blue)
                        }
                        .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityLabel("Hinzufügen")
                    }
                }
                if list != nil && open.isEmpty && done.isEmpty {
                    Section {
                        Text("Nichts auf der Liste. Sag Stella einfach „wir brauchen Eier und Butter“.")
                            .font(.system(size: 14)).foregroundStyle(Theme.muted)
                    }
                }
                if !open.isEmpty {
                    Section {
                        ForEach(open) { entry in row(entry) }
                            .onDelete { offsets in
                                let ids = offsets.map { open[$0].id }
                                Task { for id in ids { await remove(id) } }
                            }
                    }
                }
                if !done.isEmpty {
                    Section {
                        ForEach(done) { entry in row(entry) }
                    } header: {
                        HStack {
                            Text("Erledigt (\(done.count))")
                            Spacer()
                            Button("Aufräumen") { Task { await tidy() } }
                                .font(.system(size: 13, weight: .semibold))
                                .textCase(nil)
                        }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Einkaufsliste")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
            .refreshable { await load() }
            .task {
                await load()
                // alle 20 Sekunden neu, damit Einträge aus dem Chat gleich auftauchen
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(20))
                    await load()
                }
            }
        }
    }

    private func row(_ entry: ListEntry) -> some View {
        Button {
            Task { await toggle(entry) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: entry.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(entry.done ? Theme.greenBright : Theme.blue.opacity(0.5))
                Text(entry.text)
                    .strikethrough(entry.done)
                    .foregroundStyle(entry.done ? Theme.muted : Theme.text)
                if let qty = entry.qty { Text("· \(qty)").font(.system(size: 13)).foregroundStyle(Theme.muted) }
                Spacer()
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(entry.done ? "\(entry.text) wieder öffnen" : "\(entry.text) abhaken")
    }

    private func load() async {
        do {
            let r: ListsResponse = try await API.shared.get("/api/lists")
            list = r.lists.first
            error = nil
        } catch {
            if list == nil { self.error = error.localizedDescription }
        }
    }

    private func add() async {
        guard let list, !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let value = text
        text = ""
        do {
            let r: ListResponse = try await API.shared.send("POST", "/api/lists/\(list.id)/items", body: AddBody(text: value))
            self.list = r.list
            Haptics.soft()
        } catch {
            text = value
            self.error = error.localizedDescription
        }
    }

    private func toggle(_ entry: ListEntry) async {
        guard var current = list, let i = current.items.firstIndex(where: { $0.id == entry.id }) else { return }
        // sofort umschalten, der Server bestätigt gleich danach
        current.items[i].done.toggle()
        list = current
        Haptics.soft()
        do {
            let r: ListResponse = try await API.shared.send("PATCH", "/api/list-items/\(entry.id)", body: DoneBody(done: !entry.done))
            list = r.list
        } catch {
            await load()
        }
    }

    private func remove(_ id: String) async {
        do {
            let r: ListResponse = try await API.shared.send("DELETE", "/api/list-items/\(id)")
            list = r.list
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func tidy() async {
        guard let list else { return }
        if let r: ListResponse = try? await API.shared.send("POST", "/api/lists/\(list.id)/clear-done") { self.list = r.list }
    }
}

/** Karte auf „Heute“: wie viel noch auf der Einkaufsliste steht */
@MainActor
struct ShoppingCardView: View {
    @State private var count: Int?
    @State private var show = false

    var body: some View {
        Button { show = true } label: {
            HStack(spacing: 12) {
                Image(systemName: "cart.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.blue)
                    .frame(width: 40, height: 40)
                    .background(Theme.blueTint, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Einkaufsliste").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.text)
                    Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.faint)
            }
            .card(padding: 14)
        }
        .buttonStyle(PressableStyle())
        .sheet(isPresented: $show, onDismiss: { Task { await load() } }) { ShoppingListSheet() }
        .task { await load() }
    }

    private var subtitle: String {
        guard let count else { return "antippen zum Öffnen" }
        return count == 0 ? "nichts zu besorgen" : count == 1 ? "1 Eintrag offen" : "\(count) Einträge offen"
    }

    private func load() async {
        if let r: ListsResponse = try? await API.shared.get("/api/lists") {
            count = r.lists.first(where: { $0.kind == "shopping" })?.items.filter { !$0.done }.count ?? 0
        }
    }
}

/** „Läden in der Nähe“ unter der Erinnerung an eine Erledigung. Der Standort wird nur hier und nur einmal abgefragt –
    von selbst, wenn er schon erlaubt ist, sonst erst nach einem Tipp. Er wird nirgends gespeichert. */
@MainActor
struct PlacesCardView: View {
    var card: MessageCard
    @Environment(\.openURL) private var openURL
    @State private var location = OneShotLocation()
    @State private var phase: Phase = .idle
    @State private var data: NearbyPlaces?
    @State private var shopping: StellaList?
    @State private var error: String?

    enum Phase { case idle, locating, loading, done, failed }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(data?.emoji ?? "📍") \((data?.plural ?? card.label).uppercased()) IN DER NÄHE")
                .font(.system(size: 12, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(Theme.muted)
            switch phase {
            case .idle:
                Button { Task { await find() } } label: { Label("Läden in der Nähe zeigen", systemImage: "location.fill") }
                    .buttonStyle(SoftButton(filled: true))
            case .locating, .loading:
                HStack(spacing: 8) { ProgressView(); Text(phase == .locating ? "Standort wird bestimmt …" : "Ich suche …").font(.system(size: 13)).foregroundStyle(Theme.muted) }
            case .failed:
                Text(error ?? "Das hat nicht geklappt.").font(.system(size: 13)).foregroundStyle(Theme.pinkText)
                Button("Nochmal versuchen") { Task { await find() } }.buttonStyle(SoftButton(filled: false))
            case .done:
                if let data, data.places.isEmpty {
                    Text("Im Umkreis von 3 km habe ich nichts gefunden.").font(.system(size: 13)).foregroundStyle(Theme.muted)
                }
                ForEach(data?.places ?? []) { p in placeRow(p) }
                if let shopping, shopping.items.contains(where: { !$0.done }) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("🛒 EINKAUFSLISTE").font(.system(size: 12, weight: .bold)).tracking(0.8).foregroundStyle(Theme.muted)
                        ForEach(shopping.items.filter { !$0.done }.prefix(8)) { i in
                            Text(bullet(i)).font(.system(size: 14)).foregroundStyle(Theme.text)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.blueTint.opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .task {
            if location.alreadyAllowed && phase == .idle { await find() }
        }
    }

    private func placeRow(_ p: NearbyPlace) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(p.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
                Text(distance(p.distanceM) + (p.address.map { " · \($0)" } ?? "")).font(.system(size: 13)).foregroundStyle(Theme.muted)
                if let open = p.openNow { Pill(text: open ? "offen" : "geschlossen", tone: open ? .green : .pink) }
            }
            Spacer(minLength: 0)
            Button("Route") { if let url = URL(string: p.appleMapsUrl) { openURL(url) } }
                .buttonStyle(SoftButton(filled: false))
        }
        .padding(10)
        .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func bullet(_ i: ListEntry) -> String {
        if let qty = i.qty { return "• \(i.text) · \(qty)" }
        return "• \(i.text)"
    }

    private func distance(_ m: Int) -> String {
        m < 1000 ? "\(m) m" : String(format: "%.1f km", Double(m) / 1000).replacingOccurrences(of: ".", with: ",")
    }

    private func find() async {
        phase = .locating
        do {
            let c = try await location.request()
            phase = .loading
            let path = "/api/places?category=\(card.category)&lat=\(c.latitude)&lon=\(c.longitude)"
            data = try await API.shared.get(path)
            // beim Einkaufen kommt die Einkaufsliste gleich mit
            if card.category == "supermarket", let r: ListsResponse = try? await API.shared.get("/api/lists") { shopping = r.lists.first }
            phase = .done
        } catch {
            self.error = error.localizedDescription
            phase = .failed
        }
    }
}
