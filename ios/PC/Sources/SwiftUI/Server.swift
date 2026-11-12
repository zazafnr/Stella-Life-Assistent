// Winziger HTTP-Server auf 127.0.0.1: liefert die Fensterseite aus, schickt Bilder per
// Server-Sent Events und nimmt Eingaben per POST an. Nur dieser Rechner kommt dran,
// und nur mit dem zufälligen Schlüssel aus der Adresse.
#if os(Windows)
import WinSDK
typealias _Sock = SOCKET
let _badSock = SOCKET.max
#elseif canImport(Glibc)
import Glibc
typealias _Sock = Int32
let _badSock: Int32 = -1
#elseif canImport(Musl)
import Musl
typealias _Sock = Int32
let _badSock: Int32 = -1
#else
import Darwin
typealias _Sock = Int32
let _badSock: Int32 = -1
#endif

func _sockClose(_ s: _Sock) {
    #if os(Windows)
    closesocket(s)
    #else
    close(s)
    #endif
}

@discardableResult func _sockSend(_ s: _Sock, _ data: [UInt8]) -> Bool {
    var off = 0
    while off < data.count {
        let n: Int = data.withUnsafeBufferPointer { buf in
            #if os(Windows)
            return buf.baseAddress!.withMemoryRebound(to: CChar.self, capacity: data.count) { Int(send(s, $0 + off, Int32(data.count - off), 0)) }
            #elseif os(Linux)
            return send(s, buf.baseAddress! + off, data.count - off, Int32(MSG_NOSIGNAL))
            #else
            return send(s, buf.baseAddress! + off, data.count - off, 0)
            #endif
        }
        if n <= 0 { return false }
        off += n
    }
    return true
}

func _sockRecv(_ s: _Sock, _ buf: inout [UInt8]) -> Int {
    let cap = buf.count
    return buf.withUnsafeMutableBufferPointer { p in
        #if os(Windows)
        return p.baseAddress!.withMemoryRebound(to: CChar.self, capacity: cap) { Int(recv(s, $0, Int32(cap), 0)) }
        #else
        return recv(s, p.baseAddress!, cap, 0)
        #endif
    }
}

final class _Server: @unchecked Sendable {
    let token: String = (0..<4).map { _ in String(UInt32.random(in: 0...UInt32.max), radix: 36) }.joined()
    var onMessage: (_J) -> Void = { _ in }
    var onConnect: () -> Void = {}
    var title = "Stella"

    private let lock = NSLock()
    private var streams: [_Sock] = []
    private var last: [UInt8] = []
    private var listener: _Sock = _badSock

    /** Bilder der App (Fotos, Server-Bilder), abrufbar unter /res/<id> */
    static let resLock = NSLock()
    nonisolated(unsafe) static var resources: [String: (String, Data)] = [:]

    func start() -> Int {
        #if os(Windows)
        var wsa = WSADATA()
        _ = WSAStartup(WORD(0x0202), &wsa)
        #else
        signal(SIGPIPE, SIG_IGN)
        #endif
        let wanted = Int(ProcessInfo.processInfo.environment["STELLA_PC_PORT"] ?? "") ?? 47_810
        for port in wanted..<(wanted + 40) {
            #if os(Windows)
            let s = socket(AF_INET, Int32(SOCK_STREAM), Int32(IPPROTO_TCP.rawValue))
            #elseif os(Linux)
            let s = socket(AF_INET, Int32(SOCK_STREAM.rawValue), 0)
            #else
            let s = socket(AF_INET, SOCK_STREAM, 0)
            #endif
            if s == _badSock { continue }
            var addr = sockaddr_in()
            #if os(Windows)
            addr.sin_family = ADDRESS_FAMILY(AF_INET)
            #else
            addr.sin_family = sa_family_t(AF_INET)
            #endif
            addr.sin_port = UInt16(port).bigEndian
            withUnsafeMutableBytes(of: &addr.sin_addr) { $0.storeBytes(of: UInt32(0x7F00_0001).bigEndian, as: UInt32.self) }
            let ok = withUnsafePointer(to: &addr) { p in
                p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sp in
                    #if os(Windows)
                    return bind(s, sp, Int32(MemoryLayout<sockaddr_in>.size)) == 0
                    #else
                    return bind(s, sp, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
                    #endif
                }
            }
            if ok, listen(s, 16) == 0 {
                listener = s
                let t = Thread { [self] in acceptLoop() }
                t.start()
                return port
            }
            _sockClose(s)
        }
        return 0
    }

    private func acceptLoop() {
        while true {
            let c = accept(listener, nil, nil)
            if c == _badSock { continue }
            let t = Thread { [self] in handle(c) }
            t.start()
        }
    }

    func broadcast(_ frame: String) {
        let bytes = Array(("data: " + frame + "\n\n").utf8)
        lock.lock()
        last = bytes
        let list = streams
        lock.unlock()
        var dead: [_Sock] = []
        for s in list where !_sockSend(s, bytes) { dead.append(s) }
        if !dead.isEmpty {
            lock.lock()
            streams.removeAll { dead.contains($0) }
            lock.unlock()
            for s in dead { _sockClose(s) }
        }
    }

    private func handle(_ c: _Sock) {
        var data = [UInt8]()
        var buf = [UInt8](repeating: 0, count: 65_536)
        var headerEnd = -1
        // Kopf lesen
        while headerEnd < 0 {
            let n = _sockRecv(c, &buf)
            if n <= 0 { _sockClose(c); return }
            data += buf[0..<n]
            if let r = _find(data, [13, 10, 13, 10]) { headerEnd = r }
            if data.count > 1_000_000 { _sockClose(c); return }
        }
        let head = String(decoding: data[0..<headerEnd], as: UTF8.self)
        let lines = head.components(separatedBy: "\r\n")
        let parts = lines.first?.split(separator: " ") ?? []
        guard parts.count >= 2 else { _sockClose(c); return }
        let method = String(parts[0]), target = String(parts[1])
        var headers: [String: String] = [:]
        for l in lines.dropFirst() {
            if let i = l.firstIndex(of: ":") { headers[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces) }
        }
        let path = String(target.split(separator: "?", maxSplits: 1).first ?? "")
        let query = target.contains("?") ? String(target.split(separator: "?", maxSplits: 1)[1]) : ""
        let authed = query.split(separator: "&").contains("t=\(token)") || headers["x-stella"] == token

        if method == "POST" {
            let len = Int(headers["content-length"] ?? "0") ?? 0
            var body = Array(data[(headerEnd + 4)...])
            while body.count < len {
                let n = _sockRecv(c, &buf)
                if n <= 0 { break }
                body += buf[0..<n]
            }
            guard authed else { reply(c, 403, "text/plain", Array("nein".utf8)); return }
            let text = String(decoding: body.prefix(len), as: UTF8.self)
            if path == "/ev", let msg = _JSONReader.parse(text) {
                if case .a(let list) = msg { for m in list { onMessage(m) } } else { onMessage(msg) }
            }
            reply(c, 204, "text/plain", [])
            return
        }

        switch path {
        case "/events":
            guard authed else { reply(c, 403, "text/plain", Array("nein".utf8)); return }
            let h = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n"
            guard _sockSend(c, Array(h.utf8)) else { _sockClose(c); return }
            lock.lock()
            streams.append(c)
            let snapshot = last
            lock.unlock()
            if !snapshot.isEmpty { _sockSend(c, snapshot) }
            onConnect()
            // Verbindung bleibt offen; broadcast schreibt hinein
        case let p where p.hasPrefix("/res/"):
            let id = String(p.dropFirst(5))
            _Server.resLock.lock()
            let r = _Server.resources[id]
            _Server.resLock.unlock()
            if let r { reply(c, 200, r.0, Array(r.1), cache: true) } else { reply(c, 404, "text/plain", []) }
        default:
            let name = path == "/" ? "index.html" : String(path.dropFirst())
            if let (mime, body) = _webFile(name) {
                var b = body
                if name == "index.html" {
                    let page = String(decoding: body, as: UTF8.self)
                        .replacingOccurrences(of: "__TOKEN__", with: token)
                        .replacingOccurrences(of: "__TITLE__", with: title)
                    b = Array(page.utf8)
                }
                reply(c, 200, mime, b)
            } else {
                reply(c, 404, "text/plain", Array("nicht gefunden".utf8))
            }
        }
    }

    private func reply(_ c: _Sock, _ status: Int, _ mime: String, _ body: [UInt8], cache: Bool = false) {
        let text = status == 200 ? "OK" : status == 204 ? "No Content" : status == 403 ? "Forbidden" : "Not Found"
        let h = "HTTP/1.1 \(status) \(text)\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\nCache-Control: \(cache ? "max-age=86400" : "no-store")\r\nConnection: close\r\n\r\n"
        _ = _sockSend(c, Array(h.utf8) + body)
        _sockClose(c)
    }
}

func _find(_ hay: [UInt8], _ needle: [UInt8]) -> Int? {
    guard hay.count >= needle.count else { return nil }
    var i = 0
    while i <= hay.count - needle.count {
        if hay[i] == needle[0], Array(hay[i..<(i + needle.count)]) == needle { return i }
        i += 1
    }
    return nil
}

/** Dateien der Fensterseite: aus STELLA_PC_WEB (zum Entwickeln) oder aus dem Paket */
func _webFile(_ name: String) -> (String, [UInt8])? {
    guard !name.contains(".."), !name.contains("\\") else { return nil }
    let mime: String
    switch (name as NSString).pathExtension {
    case "html": mime = "text/html; charset=utf-8"
    case "js": mime = "text/javascript; charset=utf-8"
    case "css": mime = "text/css; charset=utf-8"
    case "svg": mime = "image/svg+xml"
    case "png": mime = "image/png"
    case "json": mime = "application/json"
    case "woff2": mime = "font/woff2"
    default: mime = "application/octet-stream"
    }
    if let dir = ProcessInfo.processInfo.environment["STELLA_PC_WEB"], let d = FileManager.default.contents(atPath: dir + "/" + name) { return (mime, Array(d)) }
    if let url = Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Web"), let d = try? Data(contentsOf: url) { return (mime, Array(d)) }
    return nil
}
