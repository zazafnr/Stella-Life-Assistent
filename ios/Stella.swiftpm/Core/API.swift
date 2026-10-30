import Foundation
import Security

struct APIError: LocalizedError {
    var message: String
    var status: Int
    var errorDescription: String? { message }
    var isAuth: Bool { status == 401 }
    var isOffline: Bool { status == 0 }
}

/** Zugang zum Stella-Server. Der Login-Token liegt im Schlüsselbund. */
final class API: @unchecked Sendable {
    static let shared = API()
    static let defaultServer = "https://stella.5-189-157-214.sslip.io"

    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 30
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    var server: String {
        get { UserDefaults.standard.string(forKey: "server") ?? API.defaultServer }
        set { UserDefaults.standard.set(API.normalize(newValue) ?? API.defaultServer, forKey: "server") }
    }

    var token: String? {
        get { Demo.token ?? Keychain.read("token") }
        set { if let v = newValue { Keychain.write("token", v) } else { Keychain.delete("token") } }
    }

    static func normalize(_ raw: String) -> String? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        if s.isEmpty { return nil }
        if !s.lowercased().hasPrefix("http") { s = "https://" + s }
        guard let u = URL(string: s), let host = u.host, host.contains(".") || host == "localhost" else { return nil }
        return s
    }

    func url(_ path: String) -> URL { URL(string: server + path)! }

    func request(_ method: String, _ path: String, body: Encodable? = nil) -> URLRequest {
        var r = URLRequest(url: url(path))
        r.httpMethod = method
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONEncoder().encode(AnyEncodable(body))
        }
        return r
    }

    func send<T: Decodable>(_ method: String, _ path: String, body: Encodable? = nil, as type: T.Type = T.self) async throws -> T {
        let data = try await raw(request(method, path, body: body))
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(message: "Antwort vom Server nicht verstanden", status: -1)
        }
    }

    func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try await send("GET", path, as: type)
    }

    func raw(_ req: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError(message: "Keine Verbindung zu Stella", status: 0)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw APIError(message: msg ?? "Fehler \(status)", status: status)
        }
        return data
    }

    /** Bilder vom Server brauchen den Login – AsyncImage kann das nicht */
    func file(_ id: String) async throws -> Data {
        try await raw(request("GET", "/api/files/\(id)"))
    }
}

/** JSONEncoder braucht einen konkreten Typ */
struct AnyEncodable: Encodable {
    let value: Encodable
    init(_ value: Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

enum Keychain {
    private static let service = "app.stella.ios"

    static func read(_ key: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func write(_ key: String, _ value: String) {
        delete(key)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key,
            kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func delete(_ key: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        SecItemDelete(q as CFDictionary)
    }
}
