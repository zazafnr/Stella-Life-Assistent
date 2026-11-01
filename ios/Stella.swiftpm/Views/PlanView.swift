import SwiftUI

/** Einstellungen → Abo: aktuelles Abo, Verbrauch und alle vier Stufen im Vergleich (Free, Plus, Pro, Max).
 Abgeschlossen wird im Web (stella.evolsior.com); die App zeigt Abo und Verbrauch. */
struct PlanSettingsView: View {
    struct Sub: Codable { var status: String; var provider: String; var currentPeriodEnd: String?; var cancelAt: String? }
    struct Usage: Codable { var aiToday: Int; var aiLimit: Int; var proMonth: Int; var proLimit: Int; var proHomeworkOnly: Bool }
    struct Limits: Codable {
        var aiMessagesPerDay: Int
        var proTasksPerMonth: Int
        var proTasksHomeworkOnly: Bool
        var mailboxes: Int
        var newsCount: Int
        var newsFavorites: Bool
        var screenTime: Bool
        var webTasks: Bool
        var priority: Bool
    }
    struct PlanInfo: Codable, Identifiable { var id: String; var priceCents: Int; var limits: Limits }
    struct Status: Codable {
        var plan: String
        var subscription: Sub?
        var usage: Usage
        var plans: [PlanInfo]
    }

    @State private var data: Status?
    @State private var yearly = false
    @State private var failed = false

    private static let unlimited = 999

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let d = data {
                    currentCard(d)
                    Picker(L("plan.title"), selection: $yearly) {
                        Text(L("plan.monthly")).tag(false)
                        Text(L("plan.yearly")).tag(true)
                    }
                    .pickerStyle(.segmented)
                    ForEach(d.plans) { p in planCard(p, current: p.id == d.plan) }
                    Text(L("plan.iosNote"))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                } else if failed {
                    Text(L("common.retry")).foregroundStyle(Theme.pinkText)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
        .background(Theme.bg)
        .navigationTitle(L("plan.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { data = try await API.shared.get("/api/billing/status", as: Status.self) } catch { failed = true }
        }
    }

    private func name(_ id: String) -> String {
        id == "free" ? L("plan.free") : id.prefix(1).uppercased() + String(id.dropFirst())
    }

    private func money(_ cents: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "EUR"
        f.locale = Locale(identifier: I18n.shared.locale.replacingOccurrences(of: "_", with: "-"))
        return f.string(from: NSNumber(value: cents / 100)) ?? "\(cents / 100) €"
    }

    private func price(_ p: PlanInfo) -> String {
        if p.priceCents == 0 { return L("plan.free") }
        let perMonth = yearly ? Double(p.priceCents) * 10 / 12 : Double(p.priceCents)
        return L("plan.perMonth", ["price": money(perMonth)])
    }

    private func date(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        guard let d = parser.date(from: iso) ?? plain.date(from: iso) else { return iso }
        let f = DateFormatter()
        f.locale = Locale(identifier: I18n.shared.locale.replacingOccurrences(of: "_", with: "-"))
        f.dateStyle = .long
        return f.string(from: d)
    }

    private func bar(_ used: Int, _ limit: Int) -> some View {
        let share = min(1.0, Double(used) / Double(max(limit, 1)))
        return GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.blueTint)
                Capsule().fill(Theme.blue).frame(width: g.size.width * share)
            }
        }
        .frame(height: 6)
    }

    private func currentCard(_ d: Status) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L("plan.current")).font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.muted).textCase(.uppercase)
            Text(name(d.plan)).font(.system(size: 26, weight: .heavy)).foregroundStyle(Theme.text)
            if let s = d.subscription {
                if let end = s.cancelAt {
                    Text(L("plan.endsOn", ["date": date(end)])).font(.system(size: 14)).foregroundStyle(Theme.muted)
                }
                if s.provider == "gift" {
                    Text(s.currentPeriodEnd.map { L("plan.giftUntil", ["date": date($0)]) } ?? L("plan.gift"))
                        .font(.system(size: 14)).foregroundStyle(Theme.muted)
                }
            }
            Text(L("plan.usageAi", ["used": d.usage.aiToday, "limit": d.usage.aiLimit])).font(.system(size: 14)).padding(.top, 6)
            bar(d.usage.aiToday, d.usage.aiLimit)
            Text(L("plan.usagePro", ["used": d.usage.proMonth, "limit": d.usage.proLimit])).font(.system(size: 14)).padding(.top, 4)
            bar(d.usage.proMonth, d.usage.proLimit)
            Text(L("plan.usageNote")).font(.system(size: 13)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }

    private func features(_ l: Limits) -> [String] {
        var out: [String] = []
        out.append("\(L("plan.f.ai")): \(l.aiMessagesPerDay)")
        let pro = l.proTasksHomeworkOnly ? L("plan.f.proHomework", ["count": l.proTasksPerMonth]) : "\(l.proTasksPerMonth)"
        out.append("\(L("plan.f.pro")): \(pro)")
        let boxes = l.mailboxes >= Self.unlimited ? L("plan.f.unlimited") : "\(l.mailboxes)"
        out.append("\(L("plan.f.mailboxes")): \(boxes)")
        let news = l.newsFavorites ? L("plan.f.newsFavorites", ["count": l.newsCount]) : "\(l.newsCount)"
        out.append("\(L("plan.f.news")): \(news)")
        out.append("\(L("plan.f.screenTime")): \(l.screenTime ? "✓" : "–")")
        out.append("\(L("plan.f.webTasks")): \(l.webTasks ? "✓" : "–")")
        if l.priority { out.append(L("plan.f.priority")) }
        return out
    }

    private func planCard(_ p: PlanInfo, current: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(name(p.id)).font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.text)
                Spacer()
                if current {
                    Text(L("plan.currentBadge"))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.green)
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(Theme.greenTint, in: Capsule())
                } else {
                    Text(price(p)).font(.system(size: 14)).foregroundStyle(Theme.muted)
                }
            }
            if current { Text(price(p)).font(.system(size: 14)).foregroundStyle(Theme.muted) }
            ForEach(features(p.limits), id: \.self) { f in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.blue).padding(.top, 4)
                    Text(f).font(.system(size: 14)).foregroundStyle(Theme.text)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(current ? Theme.blue : Color.clear, lineWidth: 2))
    }
}
