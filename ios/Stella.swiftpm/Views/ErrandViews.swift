import SwiftUI

/** Drei Restaurant-Vorschläge mit „Reservieren“ (Link oder Anruf), „Route“ und „In den Planer“. Stella bucht nicht selbst – das steht auch auf der Karte. */
struct RestaurantsCardView: View {
    var card: MessageCard
    @Environment(\.openURL) private var openURL
    @State private var planned: [String: String] = [:]   // Restaurant-Id → Aktions-Id (für „Rückgängig“)
    @State private var busy: Set<String> = []
    @State private var error: String?

    struct PlanBody: Encodable { var name: String; var when: String; var people: Int?; var address: String?; var phone: String? }
    struct PlanResult: Decodable { var actionId: String? }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("errand.card.restaurants")).font(.system(size: 13, weight: .semibold))
            ForEach(card.restaurants ?? []) { r in
                VStack(alignment: .leading, spacing: 6) {
                    Text(r.name).font(.system(size: 15, weight: .semibold))
                    Text("\(r.cuisine.isEmpty ? r.kind : r.cuisine.joined(separator: ", ")) · \(distance(r.distanceM)) · \(openText(r))")
                        .font(.system(size: 12)).opacity(0.8)
                    HStack(spacing: 8) {
                        if let urlText = r.bookingUrl, let url = URL(string: urlText) {
                            chip(L("errand.reserve") + (r.bookingService.map { " · \($0)" } ?? ""), "calendar.badge.plus") { openURL(url) }
                        } else if let phone = r.phone, let url = URL(string: "tel:" + phone.filter { "+0123456789".contains($0) }) {
                            chip(L("errand.call"), "phone.fill") { openURL(url) }
                        } else if let site = r.website, let url = URL(string: site) {
                            chip(L("errand.website"), "safari") { openURL(url) }
                        }
                        if let url = URL(string: r.appleMapsUrl) { chip(L("errand.route"), "map") { openURL(url) } }
                        if let when = card.when {
                            if planned[r.id] != nil {
                                chip(L("telegram.undo"), "arrow.uturn.backward") { Task { await undo(r) } }
                            } else {
                                chip(L("errand.plan"), "plus") { Task { await plan(r, when: when) } }
                                    .disabled(busy.contains(r.id))
                            }
                        }
                    }
                }
            }
            Text(L("errand.card.notBooked")).font(.system(size: 12)).opacity(0.7)
            if let error { Text(error).font(.system(size: 12)).foregroundStyle(Theme.pinkText) }
        }
        .padding(10)
        .background(Theme.blueTint.opacity(0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func chip(_ title: String, _ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Label(title, systemImage: symbol).font(.system(size: 12, weight: .semibold)) }
            .buttonStyle(.bordered)
            .controlSize(.small)
    }

    private func distance(_ m: Int) -> String { m < 1000 ? "\((m / 10) * 10) m" : String(format: "%.1f km", Double(m) / 1000) }

    private func openText(_ r: RestaurantItem) -> String {
        r.openNow == true ? L("errand.openNow") : (r.openNow == false ? L("errand.closed") : L("errand.hoursUnknown"))
    }

    private func plan(_ r: RestaurantItem, when: String) async {
        busy.insert(r.id); error = nil
        defer { busy.remove(r.id) }
        do {
            let res: PlanResult = try await API.shared.send("POST", "/api/errands/plan", body: PlanBody(name: r.name, when: when, people: card.people, address: r.address, phone: r.phone), as: PlanResult.self)
            planned[r.id] = res.actionId ?? ""
        } catch { self.error = error.localizedDescription }
    }

    private func undo(_ r: RestaurantItem) async {
        if let id = planned[r.id], !id.isEmpty { _ = try? await API.shared.send("POST", "/api/actions/\(id)/undo", as: OK.self) }
        planned[r.id] = nil
    }
}

/** Händler, Filiale, Status (lagernd / bestellbar / unklar) mit Quelle, Link und Uhrzeit der Prüfung */
struct AvailabilityCardView: View {
    var card: MessageCard
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(L("errand.card.availability")): \(card.product ?? "")").font(.system(size: 13, weight: .semibold))
            ForEach(card.availability ?? []) { r in
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.retailer + (r.store.map { " · \($0)" } ?? "")).font(.system(size: 15, weight: .semibold))
                    HStack(spacing: 4) {
                        Text(statusText(r.status)).font(.system(size: 12, weight: .semibold)).foregroundStyle(r.status == "unclear" ? Theme.pinkText : Theme.green)
                        if let urlText = r.url, let url = URL(string: urlText) {
                            Button(r.source) { openURL(url) }.font(.system(size: 12)).buttonStyle(.plain).underline()
                        } else {
                            Text(r.source).font(.system(size: 12)).opacity(0.8)
                        }
                        if r.status == "unclear", let phone = r.phone, let url = URL(string: "tel:" + phone.filter { "+0123456789".contains($0) }) {
                            Button("\(L("errand.call")): \(phone)") { openURL(url) }.font(.system(size: 12)).buttonStyle(.plain).underline()
                        }
                    }
                }
            }
            if let at = card.checkedAt, let d = ISO.parse(at) {
                Text(L("errand.checkedAt", ["time": d.formatted(date: .omitted, time: .shortened)])).font(.system(size: 12)).opacity(0.7)
            }
        }
        .padding(10)
        .background(Theme.blueTint.opacity(0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func statusText(_ s: String) -> String { L(s == "in_stock" ? "errand.inStock" : (s == "orderable" ? "errand.orderable" : "errand.unclear")) }
}

/** Frage nach dem Standort mit derselben Erklärung wie in der Einführung; iOS fragt nur einmal, danach bleibt es in den iOS-Einstellungen */
struct LocationAskCardView: View {
    @Environment(Store.self) private var store
    @State private var done = false
    @State private var locator = OneShotLocation()

    struct PlaceBody: Encodable { var lat: Double; var lon: Double }

    var body: some View {
        if !done {
            HStack(spacing: 8) {
                Button(L("onboarding.location.allow")) { Task { await allow() } }.buttonStyle(SoftButton(filled: true))
                Button(L("onboarding.location.later")) { Task { await answer("later") } }.buttonStyle(SoftButton(filled: false))
            }
        }
    }

    private func allow() async {
        do {
            let c = try await locator.request()
            _ = try? await API.shared.send("POST", "/api/weather/place", body: PlaceBody(lat: (c.latitude * 100).rounded() / 100, lon: (c.longitude * 100).rounded() / 100), as: OK.self)
            await answer("granted")
        } catch { await answer("denied") }
    }

    private func answer(_ permission: String) async {
        try? await store.updateSettings(["locationPermission": .string(permission)])
        done = true
    }
}
