import SafariServices
import SwiftUI

/** Artikel im Safari-Fenster der App öffnen (Antippen einer Meldung im Briefing) */
struct ReadingURL: Identifiable {
    var url: URL
    var id: String { url.absoluteString }
}

struct SafariView: UIViewControllerRepresentable {
    var url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/** Einstellungen → News: ein/aus, Themen, Länder, Lieblingszeitung (ab Pro) */
struct NewsSettingsView: View {
    @Environment(Store.self) private var store

    struct Fav: Codable, Hashable { var name: String; var feedUrl: String }
    struct Prefs: Codable { var enabled: Bool; var topics: [String]; var countries: [String]; var favorites: [Fav] }
    struct Limits: Codable { var count: Int; var favorites: Bool; var maxFavorites: Int }
    struct View_: Codable {
        var settings: Prefs
        var limits: Limits
        var topics: [String]
        var countries: [String]
        var defaultCountries: [String]
    }
    struct Found: Codable { var name: String; var feedUrl: String; var sample: [String] }
    struct SaveBody: Encodable {
        var enabled: Bool?
        var topics: [String]?
        var countries: [String]?
        var favorites: [Fav]?
        var asked = true
    }
    struct Query: Encodable { var query: String }

    @State private var data: View_?
    @State private var query = ""
    @State private var found: Found?
    @State private var error: String?

    var body: some View {
        Form {
            if let d = data {
                Section {
                    Toggle(L("settings.news.enable"), isOn: Binding(get: { d.settings.enabled }, set: { v in Task { await save(SaveBody(enabled: v)) } }))
                } footer: {
                    Text(L("settings.news.sub"))
                }
                if d.settings.enabled {
                    Section(L("settings.news.topics")) {
                        FlowLayout {
                            ForEach(d.topics, id: \.self) { x in
                                OnbChip(title: L("news.topic.\(x)"), on: d.settings.topics.contains(x)) { Task { await save(SaveBody(topics: toggled(d.settings.topics, x))) } }
                            }
                        }
                    }
                    Section(L("settings.news.countries")) {
                        let chosen = d.settings.countries.isEmpty ? d.defaultCountries : d.settings.countries
                        FlowLayout {
                            ForEach(d.countries, id: \.self) { c in
                                OnbChip(title: c == "INT" ? L("settings.news.international") : I18n.countryName(c, locale: I18n.shared.locale), on: chosen.contains(c)) {
                                    Task { await save(SaveBody(countries: toggled(chosen, c))) }
                                }
                            }
                        }
                    }
                    if d.limits.favorites {
                        Section {
                            ForEach(d.settings.favorites, id: \.feedUrl) { f in
                                HStack {
                                    Text(f.name)
                                    Spacer()
                                    Button(L("settings.news.remove"), role: .destructive) { Task { await save(SaveBody(favorites: d.settings.favorites.filter { $0.feedUrl != f.feedUrl })) } }
                                }
                            }
                            if d.settings.favorites.count < d.limits.maxFavorites {
                                TextField(L("settings.news.favorite"), text: $query)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                Button(L("settings.news.search")) { Task { await search() } }
                                    .disabled(query.trimmingCharacters(in: .whitespaces).isEmpty)
                            }
                            if let found {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(L("settings.news.found")): \(found.name)").font(.system(size: 15, weight: .semibold))
                                    ForEach(found.sample, id: \.self) { Text($0).font(.system(size: 13)).foregroundStyle(Theme.muted) }
                                }
                                Button(L("settings.news.use")) {
                                    Task { await save(SaveBody(favorites: d.settings.favorites + [Fav(name: found.name, feedUrl: found.feedUrl)])); self.found = nil; query = "" }
                                }
                            }
                        } header: {
                            Text(L("settings.news.favorite"))
                        } footer: {
                            Text(L("settings.news.favoriteHint"))
                        }
                    }
                }
            } else {
                Section { ProgressView() }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle(L("settings.news.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task { data = try? await API.shared.get("/api/news", as: View_.self) }
    }

    private func toggled(_ list: [String], _ x: String) -> [String] { list.contains(x) ? list.filter { $0 != x } : list + [x] }

    private func save(_ body: SaveBody) async {
        error = nil
        do {
            data = try await API.shared.send("PUT", "/api/news", body: body, as: View_.self)
            await store.refreshMe()
        } catch { self.error = error.localizedDescription }
    }

    private func search() async {
        error = nil; found = nil
        do { found = try await API.shared.send("POST", "/api/news/feed-search", body: Query(query: query), as: Found.self) } catch { self.error = error.localizedDescription }
    }
}

/** Karte unter der Frage am ersten Tag: „Ja, gern“ öffnet die Auswahl, „Nein danke“ merkt sich die Antwort */
struct NewsAskCardView: View {
    @Environment(Store.self) private var store
    @State private var showSheet = false
    @State private var done = false

    struct Answer: Encodable { var answer: String }

    var body: some View {
        if !done {
            HStack(spacing: 8) {
                Button(L("news.ask.yes")) {
                    Task {
                        _ = try? await API.shared.send("PUT", "/api/news", body: NewsSettingsView.SaveBody(enabled: true), as: NewsSettingsView.View_.self)
                        showSheet = true
                    }
                }
                .buttonStyle(SoftButton(filled: true))
                Button(L("news.ask.no")) {
                    Task {
                        _ = try? await API.shared.send("POST", "/api/news/answer", body: Answer(answer: "no"), as: OK.self)
                        done = true
                        await store.refreshMe()
                    }
                }
                .buttonStyle(SoftButton(filled: false))
            }
            .sheet(isPresented: $showSheet, onDismiss: { done = true }) {
                NavigationStack { NewsSettingsView() }.environment(store)
            }
        }
    }
}
