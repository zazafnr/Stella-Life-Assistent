import Foundation
import Observation
import UIKit

/// Zustand der App. Alles wird im Gerät zwischengespeichert, damit Stella auch ohne Netz
/// sofort da ist. Nachrichten ohne Netz landen im Postausgang und gehen später raus.
@MainActor
@Observable
final class Store {
    var me: Me?
    var items: [String: Item] = [:]
    var messages: [ChatMessage] = []
    var busyItems: Set<String> = []
    /** Aktionen und Vorschläge von Stella */
    var actions: [String: ActionEntry] = [:]
    var lastSync: String?
    var online = true
    var thinking = false
    var loggedIn: Bool
    /** Cache wiederhergestellt bzw. erster Abgleich fertig – davor zeigt die App den Ladebildschirm */
    var ready = false

    @ObservationIgnored private var outbox: [Outbox] = []
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var lastReminderPlan = Date.distantPast
    @ObservationIgnored private let api = API.shared

    struct Outbox: Codable {
        var clientId: String
        var text: String
        var createdAt: String
    }

    private struct Cache: Codable {
        var me: Me?
        var items: [Item]
        var messages: [ChatMessage]
        var outbox: [Outbox]
        var lastSync: String?
        var actions: [ActionEntry]?
    }

    init() {
        loggedIn = API.shared.token != nil
        restore()
        ready = !loggedIn || me != nil
    }

    // MARK: Abgeleitete Listen

    var visibleItems: [Item] { items.values.filter { !$0.deleted } }

    func items(on day: String) -> [Item] {
        visibleItems.filter { $0.due == day }.sorted { ($0.time ?? "99", $0.title) < ($1.time ?? "99", $1.title) }
    }

    var openHomework: Int { visibleItems.filter { $0.kind == "homework" && $0.isOpen }.count }

    /** woran Stella gerade arbeitet ("löst gerade Mathe HÜ") */
    var busyLabel: String? {
        guard let id = busyItems.first, let item = items[id] else { return nil }
        return item.title
    }

    // MARK: Anmeldung

    func authenticate(register: Bool, name: String, email: String, password: String) async throws {
        struct Body: Encodable { var name: String; var email: String; var password: String; var device: String; var timeZone: String }
        let body = Body(name: name, email: email, password: password,
                        device: UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone",
                        timeZone: TimeZone.current.identifier)
        let res: AuthResponse = try await api.send("POST", register ? "/api/auth/register" : "/api/auth/login", body: body)
        api.token = res.token
        me = res.user
        items = [:]
        messages = []
        outbox = []
        lastSync = nil
        loggedIn = true
        persist()
        await sync()
        await Notifier.shared.requestPermission()
    }

    func logout() async {
        _ = try? await api.send("POST", "/api/auth/logout", as: OK.self)
        logoutLocal()
    }

    private func logoutLocal() {
        api.token = nil
        me = nil
        items = [:]
        messages = []
        outbox = []
        lastSync = nil
        busyItems = []
        actions = [:]
        loggedIn = false
        persist()
        Notifier.shared.clear()
    }

    func refreshMe() async {
        do { me = try await api.get("/api/me") } catch { handle(error) }
        persist()
    }

    // MARK: Abgleich

    func start() {
        if !ready {
            // spätestens nach 4 s aufhören zu warten, auch wenn der Server nicht antwortet
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(4))
                self?.ready = true
            }
        }
        loop?.cancel()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.sync()
                try? await Task.sleep(for: .seconds(self?.busyItems.isEmpty == false ? 6 : 20))
            }
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
    }

    func sync() async {
        guard loggedIn else { return }
        defer { ready = true }
        await flushOutbox()
        let path = lastSync.map { "/api/sync?since=\($0.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0)" } ?? "/api/sync"
        do {
            let res: SyncResponse = try await api.get(path)
            if me == nil { await refreshMe() }
            merge(items: res.items)
            merge(messages: res.messages)
            if lastSync == nil { actions = [:] }
            for a in res.actions ?? [] { actions[a.id] = a }
            busyItems = Set(res.busyItems ?? [])
            lastSync = res.serverTime
            online = true
            persist()
            await planReminders()
        } catch {
            handle(error)
        }
    }

    private func merge(items incoming: [Item]) {
        for i in incoming {
            if i.deleted { items[i.id] = nil } else { items[i.id] = i }
        }
    }

    private func merge(messages incoming: [ChatMessage]) {
        guard !incoming.isEmpty else { return }
        var byId = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for m in incoming {
            // lokale Platzhalter durch die Server-Version ersetzen
            if let c = m.clientId { byId["local-\(c)"] = nil }
            byId[m.id] = m
        }
        messages = Array(byId.values.sorted { $0.createdAt < $1.createdAt }.suffix(300))
    }

    private func handle(_ error: Error) {
        if let e = error as? APIError {
            if e.isAuth { logoutLocal(); return }
            if e.isOffline { online = false }
        }
    }

    /** Erinnerungen höchstens alle 2 Minuten neu einplanen */
    private func planReminders() async {
        guard Date().timeIntervalSince(lastReminderPlan) > 120 else { return }
        lastReminderPlan = Date()
        if let list: [UpcomingReminder] = try? await api.get("/api/reminders/upcoming") {
            await Notifier.shared.schedule(list)
        }
    }

    func replanReminders() async {
        lastReminderPlan = .distantPast
        await planReminders()
    }

    // MARK: Chat

    func send(text: String, images: [Data] = []) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !images.isEmpty else { return }
        let clientId = UUID().uuidString
        let now = ISO.string(Date())
        let local = ChatMessage(id: "local-\(clientId)", clientId: clientId, role: "user", text: trimmed,
                                attachments: [], createdAt: now, pending: true)
        messages.append(local)
        thinking = true
        defer { thinking = false }

        struct Body: Encodable { var text: String; var clientId: String; var images: [String] }
        let body = Body(text: trimmed, clientId: clientId,
                        images: images.map { "data:image/jpeg;base64,\($0.base64EncodedString())" })
        do {
            let res: ChatResponse = try await api.send("POST", "/api/chat", body: body)
            if let u = res.userMessage { merge(messages: [u]) }
            merge(messages: res.messages)
            merge(items: res.items)
            online = true
            persist()
            Haptics.soft()
        } catch let e as APIError where e.isOffline && images.isEmpty {
            // ohne Netz: später schicken
            online = false
            outbox.append(Outbox(clientId: clientId, text: trimmed, createdAt: now))
            persist()
        } catch {
            messages.removeAll { $0.id == local.id }
            messages.append(ChatMessage(id: "err-\(clientId)", clientId: nil, role: "assistant",
                                        text: "😕 \(error.localizedDescription)", attachments: [], createdAt: ISO.string(Date())))
        }
    }

    private func flushOutbox() async {
        guard !outbox.isEmpty else { return }
        struct Body: Encodable { var text: String; var clientId: String }
        while let next = outbox.first {
            do {
                let res: ChatResponse = try await api.send("POST", "/api/chat", body: Body(text: next.text, clientId: next.clientId))
                outbox.removeFirst()
                if let u = res.userMessage { merge(messages: [u]) }
                merge(messages: res.messages)
                merge(items: res.items)
            } catch {
                break
            }
        }
        persist()
    }

    // MARK: Vorschläge, Rückgängig

    /** decision: approve, reject oder undo */
    func decide(_ id: String, _ decision: String) async throws {
        let res: ActionDecision = try await api.send("POST", "/api/actions/\(id)/\(decision)", as: ActionDecision.self)
        actions[res.action.id] = res.action
        merge(items: res.items)
        if decision == "approve" { Haptics.success() }
        persist()
        await sync()
    }

    var waitingForMe: Int { actions.values.filter(\.proposed).count }

    // MARK: Planer

    func setDone(_ item: Item, _ done: Bool) async {
        var copy = item
        copy.status = done ? "done" : "open"
        items[item.id] = copy
        if done { Haptics.success() }
        struct Body: Encodable { var status: String }
        do {
            let updated: Item = try await api.send("PATCH", "/api/items/\(item.id)", body: Body(status: copy.status))
            items[updated.id] = updated
            persist()
            await replanReminders()
        } catch {
            items[item.id] = item
            handle(error)
        }
    }

    func delete(_ item: Item) async {
        items[item.id] = nil
        do {
            _ = try await api.send("DELETE", "/api/items/\(item.id)", as: OK.self)
            persist()
            await replanReminders()
        } catch {
            items[item.id] = item
            handle(error)
        }
    }

    // MARK: Einstellungen

    func updateSettings(_ patch: [String: SettingValue]) async throws {
        me = try await api.send("PATCH", "/api/settings", body: patch, as: Me.self)
        persist()
    }

    // MARK: Zwischenspeicher

    private var cacheURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("stella-cache.json")
    }

    private func persist() {
        let waiting = Set(outbox.map { "local-\($0.clientId)" })
        let kept = messages.filter { m in m.pending != true || waiting.contains(m.id) }
        let cache = Cache(me: me, items: Array(items.values), messages: kept, outbox: outbox, lastSync: lastSync,
                          actions: Array(actions.values))
        if let data = try? JSONEncoder().encode(cache) { try? data.write(to: cacheURL, options: .atomic) }
    }

    private func restore() {
        guard loggedIn, let data = try? Data(contentsOf: cacheURL), let cache = try? JSONDecoder().decode(Cache.self, from: data) else { return }
        me = cache.me
        items = Dictionary(cache.items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        messages = cache.messages
        outbox = cache.outbox
        lastSync = cache.lastSync
        actions = Dictionary((cache.actions ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }
}

/** Werte für PATCH /api/settings */
enum SettingValue: Encodable {
    case string(String)
    case int(Int)
    case bool(Bool)

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        }
    }
}

enum Haptics {
    @MainActor static func soft() { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
    @MainActor static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}
