// Kleiner JSON-Leser für Nachrichten aus dem Fenster (Zahlen bleiben Zahlen, true bleibt true)

struct _JSONReader {
    let b: [UInt8]
    var i = 0

    static func parse(_ s: String) -> _J? {
        var r = _JSONReader(b: Array(s.utf8))
        return r.value()
    }

    mutating func ws() { while i < b.count, b[i] == 0x20 || b[i] == 0x0A || b[i] == 0x0D || b[i] == 0x09 { i += 1 } }

    mutating func value() -> _J? {
        ws()
        guard i < b.count else { return nil }
        switch b[i] {
        case 0x7B: // {
            i += 1
            var o: [String: _J] = [:]
            ws()
            if i < b.count, b[i] == 0x7D { i += 1; return .o(o) }
            while i < b.count {
                ws()
                guard case .s(let k)? = string() else { return nil }
                ws()
                guard i < b.count, b[i] == 0x3A else { return nil }
                i += 1
                guard let v = value() else { return nil }
                o[k] = v
                ws()
                if i < b.count, b[i] == 0x2C { i += 1; continue }
                if i < b.count, b[i] == 0x7D { i += 1; return .o(o) }
                return nil
            }
            return nil
        case 0x5B: // [
            i += 1
            var a: [_J] = []
            ws()
            if i < b.count, b[i] == 0x5D { i += 1; return .a(a) }
            while i < b.count {
                guard let v = value() else { return nil }
                a.append(v)
                ws()
                if i < b.count, b[i] == 0x2C { i += 1; continue }
                if i < b.count, b[i] == 0x5D { i += 1; return .a(a) }
                return nil
            }
            return nil
        case 0x22: return string()
        case 0x74: i += 4; return .b(true)
        case 0x66: i += 5; return .b(false)
        case 0x6E: i += 4; return .null
        default:
            let start = i
            while i < b.count, (0x30...0x39).contains(b[i]) || b[i] == 0x2D || b[i] == 0x2B || b[i] == 0x2E || b[i] == 0x65 || b[i] == 0x45 { i += 1 }
            return Double(String(decoding: b[start..<i], as: UTF8.self)).map { .n($0) }
        }
    }

    mutating func string() -> _J? {
        guard i < b.count, b[i] == 0x22 else { return nil }
        i += 1
        var out = [UInt8]()
        while i < b.count {
            let c = b[i]
            if c == 0x22 { i += 1; return .s(String(decoding: out, as: UTF8.self)) }
            if c == 0x5C, i + 1 < b.count {
                i += 1
                switch b[i] {
                case 0x6E: out.append(0x0A)
                case 0x72: out.append(0x0D)
                case 0x74: out.append(0x09)
                case 0x62: out.append(0x08)
                case 0x66: out.append(0x0C)
                case 0x75:
                    guard i + 4 < b.count, var code = UInt32(String(decoding: b[(i + 1)...(i + 4)], as: UTF8.self), radix: 16) else { return nil }
                    i += 4
                    if (0xD800..<0xDC00).contains(code), i + 6 < b.count, b[i + 1] == 0x5C, b[i + 2] == 0x75,
                       let low = UInt32(String(decoding: b[(i + 3)...(i + 6)], as: UTF8.self), radix: 16) {
                        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                        i += 6
                    }
                    out.append(contentsOf: Array(String(Character(Unicode.Scalar(code) ?? "?")).utf8))
                default: out.append(b[i])
                }
                i += 1
                continue
            }
            out.append(c)
            i += 1
        }
        return nil
    }
}
