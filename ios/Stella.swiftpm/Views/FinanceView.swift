import SwiftUI

enum Money {
    static func format(_ cents: Int, _ currency: String = "EUR") -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.locale = Locale(identifier: "de_AT")
        return f.string(from: NSNumber(value: Double(cents) / 100)) ?? "\(cents / 100) \(currency)"
    }

    static let colors: [String: Color] = [
        "Lebensmittel": Color(hex: 0x34C77B), "Essen & Trinken": Color(hex: 0xFF9F43), "Transport": Color(hex: 0x1F6FEB),
        "Shopping": Color(hex: 0xFF7EB3), "Freizeit": Color(hex: 0x8B6FE8), "Abos": Color(hex: 0x0E8F8A),
        "Gesundheit": Color(hex: 0x5BC0EB), "Sonstiges": Color(hex: 0x8DA0BA),
    ]
    static let categories = ["Lebensmittel", "Essen & Trinken", "Transport", "Shopping", "Freizeit", "Abos", "Gesundheit", "Sonstiges"]
    static func color(_ category: String) -> Color { colors[category] ?? Theme.faint }
}

/** Ausgaben des Monats: Summe, Kategorien mit Budget, Abos, Buchungen. Die Zahlungen meldet ein Apple-Kurzbefehl. */
@MainActor
struct FinanceSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var month = String(Day.today.prefix(7))
    @State private var data: FinanceMonth?
    @State private var picking: Payment?
    @State private var budgetFor: String?
    @State private var showSetup = false
    @State private var error: String?

    private struct CategoryBody: Encodable { var category: String }

    private var current: String { String(Day.today.prefix(7)) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Button { shift(-1) } label: { Image(systemName: "chevron.left") }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Vorheriger Monat")
                        Spacer()
                        Text(monthLabel).font(.system(size: 16, weight: .semibold))
                        Spacer()
                        Button { shift(1) } label: { Image(systemName: "chevron.right") }
                            .buttonStyle(.borderless)
                            .disabled(month >= current)
                            .accessibilityLabel("Nächster Monat")
                    }
                }
                if data == nil && error == nil {
                    Section { Text("Einen Moment …").foregroundStyle(Theme.muted) }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
                if let d = data {
                    if d.count == 0 {
                        Section {
                            Text("In diesem Monat gibt es noch keine Zahlungen. Mit einem Apple-Kurzbefehl meldet dein iPhone jede Kartenzahlung an Stella – nur Betrag, Händler und Kartenname.")
                                .font(.system(size: 14)).foregroundStyle(Theme.muted)
                            Button("Einrichten") { showSetup = true }.buttonStyle(SoftButton(filled: true))
                        }
                    } else {
                        Section {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Ausgegeben").font(.system(size: 13)).foregroundStyle(Theme.muted)
                                Text(Money.format(d.totalCents, d.currency)).font(.system(size: 34, weight: .heavy)).foregroundStyle(Theme.text)
                                Text(summaryLine(d)).font(.system(size: 13)).foregroundStyle(Theme.muted)
                                if d.otherCurrency > 0 {
                                    Text("\(d.otherCurrency) Zahlung(en) in anderer Währung sind nicht eingerechnet.").font(.system(size: 12)).foregroundStyle(Theme.muted)
                                }
                            }
                        }
                        Section {
                            ForEach(d.categories) { c in categoryRow(c, d) }
                        } header: {
                            Text("Nach Kategorie")
                        } footer: {
                            Text("Tippe auf eine Kategorie, um ein Monatsbudget zu setzen. Stella meldet sich bei 80 %.")
                        }
                    }
                    if !d.subscriptions.isEmpty {
                        Section {
                            ForEach(d.subscriptions) { s in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(s.merchant).font(.system(size: 15, weight: .semibold))
                                        Text("nächste Abbuchung um den \(Day.relative(s.nextDay))").font(.system(size: 12.5)).foregroundStyle(Theme.muted)
                                    }
                                    Spacer()
                                    Text(Money.format(s.amountCents, s.currency)).font(.system(size: 15, weight: .semibold))
                                }
                            }
                        } header: {
                            Text("Abos")
                        } footer: {
                            Text("Zusammen etwa \(Money.format(d.subscriptions.reduce(0) { $0 + $1.amountCents }, d.currency)) im Monat.")
                        }
                    }
                    if !d.transactions.isEmpty {
                        Section("Buchungen") {
                            ForEach(d.transactions) { t in paymentRow(t) }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Ausgaben")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Einrichten") { showSetup = true } }
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
            .refreshable { await load() }
            .task(id: month) { await load() }
            .sheet(isPresented: $showSetup) { NavigationStack { FinanceSetupView() } }
            .sheet(item: Binding(get: { budgetFor.map { BudgetTarget(category: $0) } }, set: { if $0 == nil { budgetFor = nil } })) { target in
                BudgetSheet(category: target.category, current: data?.budgets.first(where: { $0.category == target.category })?.limitCents ?? 0) {
                    Task { await load() }
                }
            }
            .confirmationDialog(picking.map { "Wohin gehört „\($0.merchant)“?" } ?? "", isPresented: Binding(get: { picking != nil }, set: { if !$0 { picking = nil } }), titleVisibility: .visible, presenting: picking) { t in
                ForEach(Money.categories, id: \.self) { c in
                    Button(c) { Task { await choose(t, c) } }
                }
                Button("Buchung löschen", role: .destructive) { Task { await remove(t) } }
                Button("Abbrechen", role: .cancel) {}
            } message: { _ in
                Text("Stella merkt sich das für diesen Händler.")
            }
        }
    }

    private struct BudgetTarget: Identifiable { var category: String; var id: String { category } }

    private var monthLabel: String {
        guard let date = Day.parse("\(month)-15") else { return month }
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_AT")
        f.dateFormat = "LLLL yyyy"
        return f.string(from: date)
    }

    private func summaryLine(_ d: FinanceMonth) -> String {
        var line = d.count == 1 ? "1 Zahlung" : "\(d.count) Zahlungen"
        if d.previousTotalCents > 0 {
            let diff = d.totalCents - d.previousTotalCents
            line += " · \(Money.format(abs(diff), d.currency)) \(diff >= 0 ? "mehr" : "weniger") als im Vormonat"
        }
        return line
    }

    private func categoryRow(_ c: CategorySum, _ d: FinanceMonth) -> some View {
        let budget = d.budgets.first(where: { $0.category == c.category })
        let over = (budget?.limitCents ?? Int.max) <= c.cents
        let top = max(1, budget.map { max($0.limitCents, c.cents) } ?? (d.categories.map(\.cents).max() ?? 1))
        return Button { budgetFor = c.category } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Circle().fill(Money.color(c.category)).frame(width: 10, height: 10)
                    Text(c.category).foregroundStyle(Theme.text)
                    Spacer()
                    Text(Money.format(c.cents, d.currency)).font(.system(size: 15, weight: .semibold)).foregroundStyle(over ? Theme.pinkText : Theme.text)
                    if let budget { Text("/ \(Money.format(budget.limitCents, d.currency))").font(.system(size: 12.5)).foregroundStyle(Theme.muted) }
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.blueTint)
                        Capsule().fill(over ? Theme.pinkText : Money.color(c.category)).frame(width: geo.size.width * CGFloat(Double(c.cents) / Double(top)))
                    }
                }
                .frame(height: 8)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(c.category): \(Money.format(c.cents, d.currency)). Budget ändern")
    }

    private func paymentRow(_ t: Payment) -> some View {
        Button { picking = t } label: {
            HStack(spacing: 10) {
                Circle().fill(Money.color(t.category)).frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(t.merchant).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
                    Text("\(Day.relative(t.day)) · \(t.category)" + (t.cardLabel.map { " · \($0)" } ?? ""))
                        .font(.system(size: 12.5)).foregroundStyle(Theme.muted)
                }
                Spacer()
                Text(Money.format(t.amountCents, t.currency)).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(t.merchant), \(Money.format(t.amountCents, t.currency)), \(t.category). Kategorie ändern")
    }

    private func shift(_ by: Int) {
        guard let date = Day.parse("\(month)-01"), let moved = Calendar(identifier: .gregorian).date(byAdding: .month, value: by, to: date) else { return }
        month = String(Day.string(moved).prefix(7))
    }

    private func load() async {
        do {
            data = try await API.shared.get("/api/finance?month=\(month)")
            error = nil
        } catch {
            if data == nil { self.error = error.localizedDescription }
        }
    }

    private func choose(_ t: Payment, _ category: String) async {
        do {
            let _: PaymentResponse = try await API.shared.send("PATCH", "/api/finance/transactions/\(t.id)", body: CategoryBody(category: category))
            Haptics.soft()
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ t: Payment) async {
        do {
            let _: OkResponse = try await API.shared.send("DELETE", "/api/finance/transactions/\(t.id)")
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/** Monatsbudget für eine Kategorie */
@MainActor
struct BudgetSheet: View {
    var category: String
    var current: Int
    var onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var value = ""
    @State private var error: String?

    private struct Payload: Encodable { var amount: String }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("z. B. 200", text: $value).keyboardType(.decimalPad)
                } header: {
                    Text("Monatsbudget in Euro")
                } footer: {
                    Text("Leer lassen, wenn es kein Budget geben soll.")
                }
                if let error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Budget: \(category)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Speichern") { Task { await save() } } }
            }
            .onAppear { if value.isEmpty && current > 0 { value = String(current / 100) } }
        }
    }

    private func save() async {
        do {
            let _: BudgetsResponse = try await API.shared.send("PUT", "/api/finance/budgets/\(category.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? category)", body: Payload(amount: value))
            onChanged()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct BudgetsResponse: Codable { var budgets: [BudgetLine] }

/** Anleitung: Apple-Kurzbefehl, der jede Kartenzahlung an Stella meldet – mit Probebuchung */
@MainActor
struct FinanceSetupView: View {
    @Environment(Store.self) private var store
    @State private var copied = false
    @State private var result: String?
    @State private var failed = false
    @State private var busy = false

    private var url: String { (store.me?.ingestUrl ?? "") + "/payment" }

    var body: some View {
        List {
            Section {
                step("1", "App **Kurzbefehle** → **Automation** → **+** → **Transaktion** (Wallet).")
                step("2", "Deine **Karte** wählen, Händler und Betrag auf „beliebig“ lassen.")
                step("3", "**Sofort ausführen** einschalten, damit nichts nachfragt.")
                step("4", "Aktion **Inhalte von URL abrufen**: Methode **POST**, Anfragetext **JSON** mit den Feldern `amount` (Betrag), `merchant` (Händler) und `card` (Karte) – jeweils die passende Variable aus „Transaktion“.")
                step("5", "Als Adresse diese URL einfügen:")
                Text(url).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.text).textSelection(.enabled)
                Button(copied ? "Kopiert ✓" : "URL kopieren") {
                    UIPasteboard.general.string = url
                    copied = true
                }
                .buttonStyle(SoftButton(filled: true))
            } header: {
                Text("So meldet dein iPhone Zahlungen an Stella")
            } footer: {
                Text("Stella speichert nur Betrag, Händler und Kartenname – nie Kartennummern. Die Adresse ist geheim wie ein Passwort. Meldet Wallet eine Zahlung doppelt, zählt sie nur einmal.")
            }
            Section {
                Button { Task { await test() } } label: { Label("Probebuchung senden", systemImage: "paperplane") }
                    .disabled(busy)
                if let result { Text(result).font(.system(size: 14)).foregroundStyle(failed ? Theme.pinkText : Theme.green) }
            } header: {
                Text("Funktioniert es?")
            } footer: {
                Text("Schickt 1,00 € auf demselben Weg wie der Kurzbefehl. Du findest die Buchung danach unter „Ausgaben“ und kannst sie dort löschen.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("Ausgaben einrichten")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func step(_ number: String, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(number).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.blue)
                .frame(width: 24, height: 24).background(Theme.blueTint, in: Circle())
            Text(text).font(.system(size: 14)).foregroundStyle(Theme.text)
        }
    }

    private func test() async {
        busy = true
        defer { busy = false }
        do {
            let r: TestPaymentResponse = try await API.shared.send("POST", "/api/finance/test")
            failed = r.duplicate
            result = r.message
        } catch {
            failed = true
            result = error.localizedDescription
        }
    }
}

/** Karte auf „Heute“: Ausgaben diesen Monat */
@MainActor
struct FinanceCardView: View {
    var open: () -> Void
    @State private var month: FinanceMonth?

    var body: some View {
        Button { open() } label: {
            HStack(spacing: 12) {
                Image(systemName: "creditcard.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.green)
                    .frame(width: 40, height: 40)
                    .background(Theme.greenTint, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ausgaben diesen Monat").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.text)
                    Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.faint)
            }
            .card(padding: 14)
        }
        .buttonStyle(PressableStyle())
        .task {
            let loaded: FinanceMonth? = try? await API.shared.get("/api/finance")
            month = loaded
        }
    }

    private var subtitle: String {
        guard let m = month else { return "antippen zum Öffnen" }
        if m.count == 0 { return "noch keine Zahlungen – Einrichtung in den Einstellungen" }
        return "\(Money.format(m.totalCents, m.currency)) · \(m.count == 1 ? "1 Zahlung" : "\(m.count) Zahlungen")"
    }
}

/** Karte im Chat: „Wie viel hab ich diese Woche ausgegeben?“ */
struct SpendingCardView: View {
    var card: MessageCard

    var body: some View {
        let lines = card.categories ?? []
        let top = max(1, lines.map(\.cents).max() ?? 1)
        let currency = card.currency ?? "EUR"
        if (card.count ?? 0) > 0 {
            VStack(alignment: .leading, spacing: 8) {
                Text(card.label.uppercased()).font(.system(size: 12, weight: .bold)).tracking(0.8).foregroundStyle(Theme.muted)
                Text(Money.format(card.totalCents ?? 0, currency)).font(.system(size: 26, weight: .heavy)).foregroundStyle(Theme.text)
                ForEach(lines.prefix(5), id: \.category) { line in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Circle().fill(Money.color(line.category)).frame(width: 9, height: 9)
                            Text(line.category).font(.system(size: 13)).foregroundStyle(Theme.text)
                            Spacer()
                            Text(Money.format(line.cents, currency)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.text)
                        }
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.white.opacity(0.7))
                                Capsule().fill(Money.color(line.category)).frame(width: geo.size.width * CGFloat(Double(line.cents) / Double(top)))
                            }
                        }
                        .frame(height: 6)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Theme.blueTint.opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}
