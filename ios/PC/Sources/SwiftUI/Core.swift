// Stella am PC: Ersatz für Apples SwiftUI, damit der unveränderte App-Code unter Windows und Linux läuft.
// Die Views werden wie auf dem iPhone ausgewertet (State, Environment, Observation) und als Baum aus
// Knoten ausgegeben; das Fenster (host/web) zeichnet daraus HTML im iPhone-Rahmen.
@_exported import Foundation
#if canImport(FoundationNetworking)
@_exported import FoundationNetworking
#endif
@_exported import Observation

// MARK: View

@MainActor public protocol View {
    associatedtype Body: View
    @ViewBuilder var body: Body { get }
}

extension Never: View {
    public var body: Never { fatalError() }
}

extension View where Body == Never {
    public var body: Never { fatalError("Grundbaustein hat keinen body") }
}

/** Grundbausteine zeichnen sich selbst */
@MainActor public protocol _Primitive {
    func _render() -> [_Node]
}

// MARK: JSON

public enum _J: Equatable {
    case s(String), n(Double), b(Bool), a([_J]), o([String: _J]), null

    func write(_ out: inout String) {
        switch self {
        case .s(let v): _jsonString(v, &out)
        case .n(let v):
            if v.isNaN || v.isInfinite { out += "0" }
            else if v == v.rounded(), abs(v) < 1e15 { out += String(Int64(v)) }
            else { out += String((v * 1000).rounded() / 1000) }
        case .b(let v): out += v ? "true" : "false"
        case .null: out += "null"
        case .a(let arr):
            out += "["
            var first = true
            for x in arr { if !first { out += "," }; first = false; x.write(&out) }
            out += "]"
        case .o(let obj):
            out += "{"
            var first = true
            for (k, v) in obj { if !first { out += "," }; first = false; _jsonString(k, &out); out += ":"; v.write(&out) }
            out += "}"
        }
    }

    var string: String? { if case .s(let v) = self { return v }; return nil }
    var number: Double? { if case .n(let v) = self { return v }; return nil }
    var bool: Bool? { if case .b(let v) = self { return v }; return nil }
    subscript(_ k: String) -> _J? { if case .o(let o) = self { return o[k] }; return nil }
    var array: [_J]? { if case .a(let v) = self { return v }; return nil }

    static func from(_ any: Any) -> _J {
        switch any {
        case let v as String: return .s(v)
        case let v as Bool: return .b(v)
        case let v as NSNumber:
            return .n(v.doubleValue)
        case let v as [Any]: return .a(v.map(from))
        case let v as [String: Any]: return .o(v.mapValues(from))
        default: return .null
        }
    }
}

extension _J: ExpressibleByStringLiteral, ExpressibleByFloatLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral {
    nonisolated public init(stringLiteral value: String) { self = .s(value) }
    nonisolated public init(floatLiteral value: Double) { self = .n(value) }
    nonisolated public init(integerLiteral value: Int) { self = .n(Double(value)) }
    nonisolated public init(booleanLiteral value: Bool) { self = .b(value) }
}

func _jsonString(_ s: String, _ out: inout String) {
    out += "\""
    for u in s.unicodeScalars {
        switch u {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if u.value < 0x20 { out += String(format: "\\u%04x", u.value) } else { out.unicodeScalars.append(u) }
        }
    }
    out += "\""
}

func _px(_ v: CGFloat) -> String {
    let d = Double(v)
    if d.isNaN || d.isInfinite { return "0px" }
    if d == d.rounded() { return "\(Int(d))px" }
    return "\((d * 100).rounded() / 100)px"
}

func _num(_ d: Double) -> String {
    if d.isNaN || d.isInfinite { return "0" }
    if d == d.rounded(), abs(d) < 1e12 { return "\(Int(d))" }
    return "\((d * 1000).rounded() / 1000)"
}

// MARK: Knoten

/** Schichten eines CSS-Knotens von innen nach außen: geerbt, Innenabstand, Größe, Farbe, Effekt */
enum _Layer: Int, Comparable {
    case inherit = 0, pad, frame, paint, effect
    static func < (a: _Layer, b: _Layer) -> Bool { a.rawValue < b.rawValue }
}

@MainActor public final class _Node {
    var t: String
    var p: [String: _J] = [:]
    var c: [_Node] = []
    /** nimmt in der Breite / Höhe allen Platz */
    var gw = false, gh = false
    var css: [(String, String)] = []
    var layer: _Layer = .inherit

    init(_ t: String, _ p: [String: _J] = [:], _ c: [_Node] = []) {
        self.t = t; self.p = p; self.c = c
        if let a = _R.curAnim { self.p["an"] = a._json }
    }

    func cssGet(_ k: String) -> String? { css.first { $0.0 == k }?.1 }
    func cssSet(_ k: String, _ v: String) {
        if let i = css.firstIndex(where: { $0.0 == k }) { css[i].1 = v } else { css.append((k, v)) }
    }

    func write(_ out: inout String) {
        out += "{\"t\":"
        _jsonString(t, &out)
        if gw || gh { out += ",\"g\":\((gw ? 1 : 0) + (gh ? 2 : 0))" }
        if !css.isEmpty {
            out += ",\"s\":"
            var s = ""
            for (k, v) in css { s += k; s += ":"; s += v; s += ";" }
            _jsonString(s, &out)
        }
        if !p.isEmpty {
            out += ",\"p\":"
            _J.o(p).write(&out)
        }
        if !c.isEmpty {
            out += ",\"c\":["
            var first = true
            for n in c { if !first { out += "," }; first = false; n.write(&out) }
            out += "]"
        }
        out += "}"
    }
}

/** Hängt CSS an die Knoten: in einen passenden CSS-Knoten hinein oder als neue Hülle */
@MainActor func _css(_ nodes: [_Node], _ layer: _Layer, _ props: [(String, String)], gw: Bool? = nil, gh: Bool? = nil, extra: [String: _J] = [:]) -> [_Node] {
    nodes.map { n in
        var target = n
        let conflict = props.contains { (k, _) in n.cssGet(k) != nil && !_composable.contains(k) }
        let frameClash = layer == .frame && n.layer >= .frame
        let padClash = layer == .pad && n.layer >= .pad && n.cssGet("padding") != nil
        if n.t != "css" || n.layer > layer || conflict || frameClash || padClash || !extra.isEmpty && !n.p.isEmpty || !_R.merge {
            target = _Node("css", [:], [n])
            target.gw = n.gw; target.gh = n.gh
        }
        for (k, v) in props {
            if let old = target.cssGet(k) {
                switch k {
                case "opacity": target.cssSet(k, _num((Double(old) ?? 1) * (Double(v) ?? 1)))
                case "transform": target.cssSet(k, v + " " + old)
                case "filter": target.cssSet(k, old + " " + v)
                default: break // innen gewinnt (näher am Inhalt)
                }
            } else {
                target.css.append((k, v))
            }
        }
        if layer > target.layer { target.layer = layer }
        if let gw { target.gw = gw }
        if let gh { target.gh = gh }
        for (k, v) in extra { target.p[k] = v }
        if let a = _R.curAnim, target.p["an"] == nil { target.p["an"] = a._json }
        return target
    }
}

let _composable: Set<String> = ["opacity", "transform", "filter"]

// MARK: Pfad (Identität einer View im Baum)

@inline(__always) func _mix(_ h: UInt64, _ c: UInt64) -> UInt64 {
    var x = (h ^ c) &* 0x100000001b3
    x ^= x >> 29
    return x &* 0xbf58476d1ce4e5b9
}

func _hash<H: Hashable>(_ v: H) -> UInt64 { UInt64(bitPattern: Int64(v.hashValue)) }

/** Kennung für das Fenster: 53 Bit, passt in eine JavaScript-Zahl */
func _k53(_ h: UInt64) -> UInt64 { h & 0x1F_FFFF_FFFF_FFFF }
func _id(_ h: UInt64) -> Double { Double(_k53(h)) }

// MARK: Laufzeit

final class _Slot {
    var value: Any
    var anim: Animation?
    init(_ v: Any) { value = v }
}

final class _Life {
    var task: Task<Void, Never>?
    var taskId: AnyHashable?
    var last: Any?
    var onDisappear: (() -> Void)?
    var appeared = false
}

public enum _Axis { case v, h, z }

@MainActor public final class _Runtime {
    public static let shared = _Runtime()

    var env = EnvironmentValues()
    var path: UInt64 = 1
    var axis: _Axis = .z
    var curAnim: Animation?
    var merge = ProcessInfo.processInfo.environment["STELLA_PC_NOMERGE"] == nil

    var slots: [UInt64: _Slot] = [:]
    var touched = Set<UInt64>()
    // Tabs und Navigationsstufen behalten ihren Zustand, auch wenn sie gerade nicht gezeichnet werden
    var keep: [UInt64: Set<UInt64>] = [:]      // Besitzer → seine Zustände
    var ownerKids: [UInt64: Set<UInt64>] = [:]  // Besitzer → Besitzer darin (gezeichnet oder gehalten)
    var owners: [UInt64] = [0]
    var lives: [UInt64: _Life] = [:]
    var liveTouched = Set<UInt64>()
    var handlers: [UInt64: (_J) -> Void] = [:]
    var sizes: [UInt64: CGSize] = [:]
    var post: [() -> Void] = []
    var portals: [_Node] = []
    var animSlots: [_Slot] = []
    var txAnim: Animation?
    var globalAnim: Animation?
    var timeline = false
    var outbox: [_J] = []
    var resources: [String: Bool] = [:]
    var frame = 0

    var root: (() -> [_Node])?
    var needsRender = false
    var scheduled = false
    var rendering = false
    var send: (String) -> Void = { _ in }
    var screen = CGSize(width: 393, height: 852)

    // MARK: Zustand

    func slot(_ key: UInt64, _ initial: () -> Any) -> _Slot {
        touched.insert(key)
        if owners.count > 1 { for o in owners.dropFirst() { keep[o]?.insert(key) } }
        if let s = slots[key] { return s }
        let s = _Slot(initial())
        slots[key] = s
        return s
    }

    func life(_ key: UInt64) -> _Life {
        liveTouched.insert(key)
        if let l = lives[key] { return l }
        let l = _Life()
        lives[key] = l
        return l
    }

    func handler(_ name: String, _ f: @escaping (_J) -> Void) -> _J {
        let key = _k53(_mix(path, _hash(name)))
        handlers[key] = f
        return .n(Double(key))
    }

    func handler(_ name: String, _ f: @escaping () -> Void) -> _J {
        handler(name) { (_: _J) in f() }
    }

    /** Kennung zum Messen: das Fenster meldet die Größe zurück */
    func measure(_ name: String = "m") -> (id: _J, size: CGSize?) {
        let key = _k53(_mix(path, _hash(name)))
        return (.n(Double(key)), sizes[key])
    }

    func invalidate() {
        needsRender = true
        guard !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async { [self] in
            scheduled = false
            if needsRender { renderNow() }
        }
    }

    func message(_ m: [String: _J]) { outbox.append(.o(m)); invalidate() }

    // MARK: Zeichnen

    func renderNow() {
        guard let root, !rendering else { return }
        rendering = true
        needsRender = false
        frame += 1
        touched.removeAll(keepingCapacity: true)
        liveTouched.removeAll(keepingCapacity: true)
        handlers.removeAll(keepingCapacity: true)
        portals.removeAll()
        post.removeAll()
        timeline = false
        owners = [0]
        ownerKids[0] = []
        path = 1
        axis = .z
        env = EnvironmentValues()
        curAnim = nil

        let nodes: [_Node] = withObservationTracking {
            root()
        } onChange: {
            DispatchQueue.main.async { _Runtime.shared.invalidate() }
        }

        // Zustand von Views, die es nicht mehr gibt, wegräumen (außer in gehaltenen Tabs und Stufen)
        var alive = Set<UInt64>(), queue: [UInt64] = [0]
        while let o = queue.popLast() {
            for k in ownerKids[o] ?? [] where alive.insert(k).inserted { queue.append(k) }
        }
        for k in keep.keys where !alive.contains(k) { keep[k] = nil; ownerKids[k] = nil }
        var kept = Set<UInt64>()
        for (_, set) in keep { kept.formUnion(set) }
        if slots.count != touched.count {
            for k in slots.keys where !touched.contains(k) && !kept.contains(k) { slots[k] = nil }
        }
        for (k, l) in lives where !liveTouched.contains(k) {
            l.task?.cancel()
            if let d = l.onDisappear { post.append(d) }
            lives[k] = nil
        }
        for s in animSlots { s.anim = nil }
        animSlots.removeAll()

        var out = "{\"frame\":\(frame),\"tree\":"
        let rootNode = _Node("root", [:], nodes + portals)
        rootNode.p["an"] = nil
        rootNode.write(&out)
        if let g = globalAnim { out += ",\"anim\":"; g._json.write(&out) }
        globalAnim = nil
        if !outbox.isEmpty { out += ",\"msgs\":"; _J.a(outbox).write(&out); outbox.removeAll() }
        if timeline { out += ",\"tick\":true" }
        out += "}"
        send(out)
        rendering = false

        let todo = post
        post.removeAll()
        for f in todo { f() }
        if timeline { scheduleTick() }
    }

    private var tickScheduled = false
    private func scheduleTick() {
        guard !tickScheduled else { return }
        tickScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + _Runtime.tickInterval) { [self] in
            tickScheduled = false
            invalidate()
        }
    }
    static var tickInterval: Double = 1.0 / (Double(ProcessInfo.processInfo.environment["STELLA_PC_FPS"] ?? "") ?? 20)

    /** Ein Tab oder eine Navigationsstufe wird gezeichnet: Zustand darin gehört diesem Besitzer */
    func owned<T>(_ id: UInt64, _ f: () -> T) -> T {
        ownerKids[owners.last!, default: []].insert(id)
        owners.append(id); keep[id] = []; ownerKids[id] = []
        defer { owners.removeLast() }
        return f()
    }
    /** … wird gerade nicht gezeichnet, soll aber seinen Zustand behalten */
    func retain(_ id: UInt64) { ownerKids[owners.last!, default: []].insert(id) }

    // MARK: Ereignisse vom Fenster

    func handle(_ msg: _J) {
        guard let kind = msg["k"]?.string else { return }
        switch kind {
        case "ev":
            guard let id = msg["id"]?.number else { return }
            if let f = handlers[UInt64(id)] { f(msg["v"] ?? .null) }
        case "size":
            guard let list = msg["l"]?.array else { return }
            var changed = false
            for e in list {
                guard let a = e.array, a.count == 3, let id = a[0].number, let w = a[1].number, let h = a[2].number else { continue }
                let s = CGSize(width: w, height: h)
                if sizes[UInt64(id)] != s { sizes[UInt64(id)] = s; changed = true }
            }
            if changed { invalidate() }
        case "screen":
            if let w = msg["w"]?.number, let h = msg["h"]?.number { screen = CGSize(width: w, height: h); invalidate() }
        case "phase":
            if let v = msg["v"]?.string { _Scene.setPhase(v) }
        case "render":
            invalidate()
        default:
            _hostHooks[kind]?(msg)
        }
    }
}

/** Antworten des Fensters an einzelne Bausteine (Fotos, Zwischenablage …) */
@MainActor var _hostHooks: [String: (_J) -> Void] = [:]

@MainActor var _R: _Runtime { _Runtime.shared }

// MARK: Auswerten

@MainActor func _render<V: View>(_ v: V) -> [_Node] {
    if let p = v as? _Primitive { return p._render() }
    let R = _R
    let saved = R.path, savedAnim = R.curAnim
    R.path = _mix(saved, _hash(ObjectIdentifier(V.self)))
    defer { R.path = saved; R.curAnim = savedAnim }
    _link(v)
    return _render(v.body)
}

@MainActor func _renderAny(_ v: any View) -> [_Node] { _render(v) }

/** State, Environment usw. einer View mit dem gespeicherten Zustand an dieser Stelle verbinden */
@MainActor func _link(_ v: Any) {
    var i: UInt64 = 0
    for ch in Mirror(reflecting: v).children {
        i += 1
        if let d = ch.value as? _DynProp { d._link(_mix(_R.path, i &+ 0x9e37)) }
    }
}

protocol _DynProp {
    @MainActor func _link(_ key: UInt64)
}

/** Pfad für ein Kind erweitern */
@MainActor @inline(__always) func _at<T>(_ c: UInt64, _ f: () -> T) -> T {
    let R = _R
    let saved = R.path
    R.path = _mix(saved, c)
    defer { R.path = saved }
    return f()
}

@MainActor func _withEnv<T>(_ change: (inout EnvironmentValues) -> Void, _ f: () -> T) -> T {
    let R = _R
    let saved = R.env
    change(&R.env)
    defer { R.env = saved }
    return f()
}

@MainActor func _withAxis<T>(_ a: _Axis, _ f: () -> T) -> T {
    let R = _R
    let saved = R.axis
    R.axis = a
    defer { R.axis = saved }
    return f()
}

// MARK: ViewBuilder

@resultBuilder public struct ViewBuilder {
    public static func buildBlock() -> EmptyView { EmptyView() }
    public static func buildBlock<C: View>(_ c: C) -> C { c }
    public static func buildBlock<each C: View>(_ c: repeat each C) -> _Tuple {
        var list: [any View] = []
        repeat list.append(each c)
        return _Tuple(list)
    }
    public static func buildExpression<C: View>(_ c: C) -> C { c }
    public static func buildIf<C: View>(_ c: C?) -> C? { c }
    public static func buildEither<T: View, F: View>(first: T) -> _Cond<T, F> { _Cond(a: first, b: nil) }
    public static func buildEither<T: View, F: View>(second: F) -> _Cond<T, F> { _Cond(a: nil, b: second) }
    public static func buildLimitedAvailability<C: View>(_ c: C) -> AnyView { AnyView(c) }
}

public struct _Tuple: View, _Primitive {
    public typealias Body = Never
    let list: [any View]
    nonisolated init(_ l: [any View]) { list = l }
    public func _render() -> [_Node] {
        var out: [_Node] = []
        for (i, v) in list.enumerated() { out += _at(UInt64(i) &+ 11) { _renderAny(v) } }
        return out
    }
}

public struct _Cond<T: View, F: View>: View, _Primitive {
    public typealias Body = Never
    let a: T?
    let b: F?
    public func _render() -> [_Node] {
        if let a { return _at(101) { SwiftUI._render(a) } }
        if let b { return _at(102) { SwiftUI._render(b) } }
        return []
    }
}

extension Optional: View where Wrapped: View {
    public typealias Body = Never
}

extension Optional: _Primitive where Wrapped: View {
    public func _render() -> [_Node] {
        if let v = self { return _at(103) { SwiftUI._render(v) } }
        return []
    }
}

public struct EmptyView: View, _Primitive {
    public typealias Body = Never
    nonisolated public init() {}
    public func _render() -> [_Node] { [] }
}

public struct AnyView: View, _Primitive {
    public typealias Body = Never
    let v: any View
    nonisolated public init<V: View>(_ v: V) { self.v = v }
    nonisolated public init<V: View>(erasing v: V) { self.v = v }
    init(any v: any View) { self.v = v }
    public func _render() -> [_Node] { _at(_hash(ObjectIdentifier(type(of: v)))) { _renderAny(v) } }
}

public struct Group<Content> {
    let content: Content
}

extension Group: View, _Primitive where Content: View {
    public typealias Body = Never
    nonisolated public init(@ViewBuilder content: () -> Content) { self.content = content() }
    public func _render() -> [_Node] { SwiftUI._render(content) }
}

// MARK: Kinder einzeln mit Merkmalen (Tabs, Listen, Auswahl)

struct _Child {
    var view: any View
    var traits: [String: Any] = [:]
    var key: UInt64
}

@MainActor protocol _Flattenable {
    func _flatten(_ key: UInt64, _ traits: [String: Any], _ out: inout [_Child])
}

@MainActor func _children(_ v: any View, key: UInt64 = 7, traits: [String: Any] = [:]) -> [_Child] {
    var out: [_Child] = []
    _flattenInto(v, key, traits, &out)
    return out
}

@MainActor func _flattenInto(_ v: any View, _ key: UInt64, _ traits: [String: Any], _ out: inout [_Child]) {
    if let f = v as? _Flattenable { f._flatten(key, traits, &out) }
    else { out.append(_Child(view: v, traits: traits, key: key)) }
}

extension _Tuple: _Flattenable {
    func _flatten(_ key: UInt64, _ traits: [String: Any], _ out: inout [_Child]) {
        for (i, v) in list.enumerated() { _flattenInto(v, _mix(key, UInt64(i) &+ 11), traits, &out) }
    }
}

extension _Cond: _Flattenable {
    func _flatten(_ key: UInt64, _ traits: [String: Any], _ out: inout [_Child]) {
        if let a { _flattenInto(a, _mix(key, 101), traits, &out) }
        if let b { _flattenInto(b, _mix(key, 102), traits, &out) }
    }
}

extension Optional: _Flattenable where Wrapped: View {
    func _flatten(_ key: UInt64, _ traits: [String: Any], _ out: inout [_Child]) {
        if let v = self { _flattenInto(v, _mix(key, 103), traits, &out) }
    }
}

extension EmptyView: _Flattenable {
    func _flatten(_ key: UInt64, _ traits: [String: Any], _ out: inout [_Child]) {}
}

extension Group: _Flattenable where Content: View {
    func _flatten(_ key: UInt64, _ traits: [String: Any], _ out: inout [_Child]) { _flattenInto(content, key, traits, &out) }
}

extension AnyView: _Flattenable {
    func _flatten(_ key: UInt64, _ traits: [String: Any], _ out: inout [_Child]) { _flattenInto(v, key, traits, &out) }
}

/** Merkmal an einem Kind (tag, tabItem, badge …) */
struct _Trait<C: View>: View, _Primitive, _Flattenable {
    typealias Body = Never
    let content: C
    let key: String
    let value: Any
    func _render() -> [_Node] { SwiftUI._render(content) }
    func _flatten(_ k: UInt64, _ traits: [String: Any], _ out: inout [_Child]) {
        var t = traits
        if t[key] == nil { t[key] = value }
        _flattenInto(content, k, t, &out)
    }
}

@MainActor func _renderChild(_ c: _Child) -> [_Node] { _at(c.key) { _renderAny(c.view) } }

// MARK: ForEach

public struct ForEach<Data: RandomAccessCollection, ID: Hashable, Content> {
    let data: Data
    let idOf: (Data.Element) -> ID
    let content: (Data.Element) -> Content
    var onDeleteAction: ((IndexSet) -> Void)?
    var onMoveAction: ((IndexSet, Int) -> Void)?
}

extension ForEach: View, _Primitive, _Flattenable where Content: View {
    public typealias Body = Never

    nonisolated public init(_ data: Data, id: KeyPath<Data.Element, ID>, @ViewBuilder content: @escaping (Data.Element) -> Content) {
        self.data = data; self.idOf = { $0[keyPath: id] }; self.content = content
    }

    nonisolated public init(_ data: Data, @ViewBuilder content: @escaping (Data.Element) -> Content) where Data.Element: Identifiable, ID == Data.Element.ID {
        self.data = data; self.idOf = { $0.id }; self.content = content
    }

    nonisolated public init(_ data: Range<Int>, @ViewBuilder content: @escaping (Int) -> Content) where Data == Range<Int>, ID == Int {
        self.data = data; self.idOf = { $0 }; self.content = content
    }

    public func onDelete(perform action: ((IndexSet) -> Void)?) -> ForEach {
        var c = self; c.onDeleteAction = action; return c
    }

    public func onMove(perform action: ((IndexSet, Int) -> Void)?) -> ForEach {
        var c = self; c.onMoveAction = action; return c
    }

    public func _render() -> [_Node] {
        var out: [_Node] = []
        for e in data { out += _at(_hash(idOf(e))) { SwiftUI._render(content(e)) } }
        return out
    }

    func _flatten(_ key: UInt64, _ traits: [String: Any], _ out: inout [_Child]) {
        var index = 0
        for e in data {
            var t = traits
            if let del = onDeleteAction, t["delete"] == nil {
                let i = index
                t["delete"] = { del(IndexSet(integer: i)) } as () -> Void
            }
            _flattenInto(content(e), _mix(key, _hash(idOf(e))), t, &out)
            index += 1
        }
    }
}

// MARK: ViewModifier

@MainActor public protocol ViewModifier {
    associatedtype Body: View
    typealias Content = _ModContent
    @ViewBuilder func body(content: Content) -> Body
}

public struct _ModContent: View, _Primitive {
    public typealias Body = Never
    let v: any View
    public func _render() -> [_Node] { _at(31) { _renderAny(v) } }
}

public struct ModifiedContent<C: View, M: ViewModifier>: View, _Primitive {
    public typealias Body = Never
    let content: C
    let modifier: M
    public func _render() -> [_Node] {
        _at(_hash(ObjectIdentifier(M.self))) {
            let saved = _R.curAnim
            defer { _R.curAnim = saved }
            _link(modifier)
            return SwiftUI._render(modifier.body(content: _ModContent(v: content)))
        }
    }
}

extension View {
    public func modifier<M: ViewModifier>(_ m: M) -> ModifiedContent<Self, M> { ModifiedContent(content: self, modifier: m) }
}

/** Allgemeiner Modifier: ändert die Umgebung und/oder die fertigen Knoten */
struct _Mod<C: View>: View, _Primitive {
    typealias Body = Never
    let content: C
    var env: ((inout EnvironmentValues) -> Void)?
    var wrap: (([_Node]) -> [_Node])?
    func _render() -> [_Node] {
        _at(41) {
            let nodes: [_Node]
            if let env { nodes = _withEnv(env) { SwiftUI._render(content) } } else { nodes = SwiftUI._render(content) }
            return wrap?(nodes) ?? nodes
        }
    }
}

extension View {
    func _env(_ f: @escaping (inout EnvironmentValues) -> Void) -> some View { _Mod(content: self, env: f) }
    func _wrap(_ f: @escaping ([_Node]) -> [_Node]) -> some View { _Mod(content: self, wrap: f) }
    func _style(_ layer: _Layer, _ props: [(String, String)], gw: Bool? = nil, gh: Bool? = nil, extra: [String: _J] = [:]) -> some View {
        _Mod(content: self, wrap: { _css($0, layer, props, gw: gw, gh: gh, extra: extra) })
    }
    /** Eigenschaft direkt am Knoten (für Bausteine, die sie selbst auswerten) */
    func _prop(_ k: String, _ v: _J) -> some View {
        _Mod(content: self, wrap: { nodes in
            nodes.map { n in
                let w = n.t == "css" && n.p[k] == nil ? n : { let x = _Node("css", [:], [n]); x.gw = n.gw; x.gh = n.gh; return x }()
                w.p[k] = v
                return w
            }
        })
    }
}
