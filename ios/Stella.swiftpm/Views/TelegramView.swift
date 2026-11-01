import SwiftUI

/** Einstellungen → Telegram: verbinden (Einmal-Link, 10 Minuten), wählen, wohin Stella von sich aus schreibt, trennen */
struct TelegramView: View {
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL

    struct Status: Codable {
        var configured: Bool
        var bot: String?
        var linked: Bool
        var notifyVia: [String]
    }
    struct LinkInfo: Codable {
        var token: String
        var url: String?
        var expiresAt: String
    }
    struct ViaBody: Encodable { var notifyVia: [String] }

    @State private var status: Status?
    @State private var link: LinkInfo?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        Form {
            if let status {
                if !status.configured {
                    Section { Text(L("settings.telegram.notConfigured")).foregroundStyle(Theme.muted) }
                } else {
                    Section {
                        if status.linked {
                            Label(L("settings.telegram.connected") + (status.bot.map { " · @\($0)" } ?? ""), systemImage: "checkmark.circle.fill")
                                .foregroundStyle(Theme.green)
                            Button(L("settings.telegram.disconnect"), role: .destructive) { Task { await disconnect() } }
                        } else if let link, let urlText = link.url, let url = URL(string: urlText) {
                            Button(L("settings.telegram.open")) { openURL(url) }
                            Text(L("settings.telegram.linkHint")).font(.system(size: 13)).foregroundStyle(Theme.muted)
                        } else {
                            Button(L("settings.telegram.connect")) { Task { await connect() } }
                        }
                    } header: {
                        Text(L("settings.telegram.title"))
                    } footer: {
                        Text(L("settings.telegram.sub"))
                    }
                    if status.linked {
                        Section {
                            Toggle(L("settings.telegram.push"), isOn: binding("push"))
                            Toggle("Telegram", isOn: binding("telegram"))
                        } header: {
                            Text(L("settings.telegram.notifyVia"))
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
        .navigationTitle(L("settings.telegram.title"))
        .navigationBarTitleDisplayMode(.inline)
        .disabled(busy)
        .task { await load() }
        // nach „Verbinden“ alle 3 Sekunden nachsehen, ob der Chat verknüpft wurde
        .task(id: link?.token) {
            guard let link else { return }
            let until = ISO.parse(link.expiresAt) ?? Date().addingTimeInterval(600)
            while !Task.isCancelled, Date() < until {
                try? await Task.sleep(for: .seconds(3))
                await load()
                if status?.linked == true { self.link = nil; await store.refreshMe(); return }
            }
            self.link = nil
        }
    }

    private func binding(_ channel: String) -> Binding<Bool> {
        Binding(
            get: { status?.notifyVia.contains(channel) ?? false },
            set: { on in
                guard var s = status else { return }
                var via = s.notifyVia.filter { $0 != channel }
                if on { via.append(channel) }
                guard !via.isEmpty else { return } // mindestens ein Kanal
                s.notifyVia = via
                status = s
                Task { try? await store.updateSettings(["notifyVia": .strings(via)]) }
            })
    }

    private func load() async {
        status = try? await API.shared.get("/api/channels/telegram", as: Status.self)
    }

    private func connect() async {
        busy = true; error = nil
        defer { busy = false }
        do { link = try await API.shared.send("POST", "/api/channels/telegram/link", as: LinkInfo.self) } catch { self.error = error.localizedDescription }
    }

    private func disconnect() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            status = try await API.shared.send("DELETE", "/api/channels/telegram", as: Status.self)
            await store.refreshMe()
        } catch { self.error = error.localizedDescription }
    }
}
