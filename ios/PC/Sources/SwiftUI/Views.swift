// Text, Bild, Stapel, Scrollen, Raster

// MARK: Geometrie, die Foundation unter Linux/Windows fehlt

public struct CGAffineTransform: Equatable, Sendable {
    public var a: CGFloat, b: CGFloat, c: CGFloat, d: CGFloat, tx: CGFloat, ty: CGFloat
    nonisolated public init(a: CGFloat, b: CGFloat, c: CGFloat, d: CGFloat, tx: CGFloat, ty: CGFloat) { self.a = a; self.b = b; self.c = c; self.d = d; self.tx = tx; self.ty = ty }
    nonisolated public init() { self.init(a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0) }
    nonisolated public init(translationX x: CGFloat, y: CGFloat) { self.init(a: 1, b: 0, c: 0, d: 1, tx: x, ty: y) }
    nonisolated public init(scaleX x: CGFloat, y: CGFloat) { self.init(a: x, b: 0, c: 0, d: y, tx: 0, ty: 0) }
    nonisolated public init(rotationAngle r: CGFloat) { self.init(a: cos(r), b: sin(r), c: -sin(r), d: cos(r), tx: 0, ty: 0) }
    public static let identity = CGAffineTransform()
    public var isIdentity: Bool { self == .identity }
    /** t1 zuerst, dann t2 */
    public func concatenating(_ t: CGAffineTransform) -> CGAffineTransform {
        CGAffineTransform(a: a * t.a + b * t.c, b: a * t.b + b * t.d, c: c * t.a + d * t.c, d: c * t.b + d * t.d,
                          tx: tx * t.a + ty * t.c + t.tx, ty: tx * t.b + ty * t.d + t.ty)
    }
    public func translatedBy(x: CGFloat, y: CGFloat) -> CGAffineTransform { CGAffineTransform(translationX: x, y: y).concatenating(self) }
    public func scaledBy(x: CGFloat, y: CGFloat) -> CGAffineTransform { CGAffineTransform(scaleX: x, y: y).concatenating(self) }
    public func rotated(by r: CGFloat) -> CGAffineTransform { CGAffineTransform(rotationAngle: r).concatenating(self) }
    public func inverted() -> CGAffineTransform {
        let det = a * d - b * c
        guard det != 0 else { return self }
        return CGAffineTransform(a: d / det, b: -b / det, c: -c / det, d: a / det, tx: (c * ty - d * tx) / det, ty: (b * tx - a * ty) / det)
    }
}

extension CGPoint {
    public func applying(_ t: CGAffineTransform) -> CGPoint { CGPoint(x: t.a * x + t.c * y + t.tx, y: t.b * x + t.d * y + t.ty) }
}

extension CGSize {
    public func applying(_ t: CGAffineTransform) -> CGSize { CGSize(width: t.a * width + t.c * height, height: t.b * width + t.d * height) }
}

extension CGRect {
    public func applying(_ t: CGAffineTransform) -> CGRect {
        let pts = [CGPoint(x: minX, y: minY), CGPoint(x: maxX, y: minY), CGPoint(x: minX, y: maxY), CGPoint(x: maxX, y: maxY)].map { $0.applying(t) }
        let xs = pts.map(\.x), ys = pts.map(\.y)
        return CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
    }
}

// MARK: Markdown (Foundation kann es hier nicht selbst)

let _mdMark: Character = "\u{E000}"

extension AttributedString {
    public struct MarkdownParsingOptions: Sendable {
        public enum InterpretedSyntax: Sendable { case full, inlineOnly, inlineOnlyPreservingWhitespace }
        public enum FailurePolicy: Sendable { case throwError, returnPartiallyParsedIfPossible }
        nonisolated public init(allowsExtendedAttributes: Bool = false, interpretedSyntax: InterpretedSyntax = .full, failurePolicy: FailurePolicy = .throwError, languageCode: String? = nil) {}
    }
    /** Der Text bleibt Markdown und wird erst im Fenster gesetzt */
    nonisolated public init(markdown: String, options: MarkdownParsingOptions = .init(), baseURL: URL? = nil) throws {
        self.init(String(_mdMark) + markdown)
    }
}

// MARK: Text

public struct LocalizedStringKey: ExpressibleByStringInterpolation, Equatable, Sendable {
    var s: String
    nonisolated public init(_ s: String) { self.s = s }
    nonisolated public init(stringLiteral value: String) { s = value }
    nonisolated public init(stringInterpolation i: StringInterpolation) { s = i.s }

    public struct StringInterpolation: StringInterpolationProtocol {
        var s = ""
        nonisolated public init(literalCapacity: Int, interpolationCount: Int) {}
        public mutating func appendLiteral(_ l: String) { s += l }
        public mutating func appendInterpolation(_ v: String) { s += v }
        public mutating func appendInterpolation<T>(_ v: T) { s += "\(v)" }
        public mutating func appendInterpolation(_ d: Date, style: Text.DateStyle) { s += style.format(d) }
        public mutating func appendInterpolation<F: FormatStyle>(_ v: F.FormatInput, format: F) where F.FormatOutput == String { s += format.format(v) }
        public mutating func appendInterpolation(_ t: Text) { s += t.plain }
        public mutating func appendInterpolation(_ v: Double, specifier: String) { s += String(format: specifier, v) }
        public mutating func appendInterpolation(_ v: Int, specifier: String) { s += String(format: specifier, v) }
    }
}

public struct Text: Equatable {
    struct Run: Equatable {
        var s: String
        var css: [String: String] = [:]
        var md = false
    }
    var runs: [Run]

    nonisolated public init(_ key: LocalizedStringKey) { runs = [Run(s: key.s, md: key.s.contains("*") || key.s.contains("](") || key.s.contains("`"))] }
    @_disfavoredOverload public init<S: StringProtocol>(_ s: S) { runs = [Run(s: String(s))] }
    nonisolated public init(verbatim s: String) { runs = [Run(s: s)] }
    @_disfavoredOverload nonisolated public init(_ a: AttributedString) {
        let s = String(a.characters)
        if s.first == _mdMark { runs = [Run(s: String(s.dropFirst()), md: true)] } else { runs = [Run(s: s)] }
    }
    nonisolated public init(_ d: Date, style: DateStyle) { runs = [Run(s: style.format(d))] }
    nonisolated public init<F: FormatStyle>(_ v: F.FormatInput, format: F) where F.FormatOutput == String { runs = [Run(s: format.format(v))] }
    nonisolated public init(_ i: Image) { runs = [Run(s: "")] }
    nonisolated public init(_ range: ClosedRange<Date>) { runs = [Run(s: "\(DateStyle.time.format(range.lowerBound)) – \(DateStyle.time.format(range.upperBound))")] }

    var plain: String { runs.map(\.s).joined() }

    public struct DateStyle: Sendable {
        let k: Int
        public static let time = DateStyle(k: 0)
        public static let date = DateStyle(k: 1)
        public static let relative = DateStyle(k: 2)
        public static let offset = DateStyle(k: 3)
        public static let timer = DateStyle(k: 4)
        func format(_ d: Date) -> String {
            switch k {
            case 0: return d.formatted(date: .omitted, time: .shortened)
            case 1: return d.formatted(date: .long, time: .omitted)
            case 4:
                let s = Int(abs(d.timeIntervalSinceNow))
                return String(format: "%d:%02d", s / 60, s % 60)
            default:
                let s = Int(abs(d.timeIntervalSinceNow))
                if s < 60 { return "\(s) s" }
                if s < 3600 { return "\(s / 60) min" }
                if s < 86400 { return "\(s / 3600) h" }
                return "\(s / 86400) d"
            }
        }
    }

    public enum TruncationMode: Sendable { case head, middle, tail }
    public enum Case: Sendable { case uppercase, lowercase }
    public struct LineStyle: Sendable {
        public enum Pattern: Sendable { case solid, dot, dash, dashDot, dashDotDot }
        nonisolated public init(pattern: Pattern = .solid, color: Color? = nil) {}
        public static let single = LineStyle()
    }

    func with(_ k: String, _ v: String) -> Text {
        var t = self
        for i in t.runs.indices where t.runs[i].css[k] == nil { t.runs[i].css[k] = v }
        return t
    }
    func with(_ list: [(String, String)]) -> Text {
        var t = self
        for (k, v) in list { t = t.with(k, v) }
        return t
    }

    public func font(_ f: Font?) -> Text { f.map { with($0.css) } ?? self }
    public func fontWeight(_ w: Font.Weight?) -> Text { w.map { with("font-weight", "\($0.v)") } ?? self }
    public func fontDesign(_ d: Font.Design?) -> Text { d.map { with(Font(design: $0).css) } ?? self }
    public func bold() -> Text { with("font-weight", "700") }
    public func bold(_ on: Bool) -> Text { on ? bold() : self }
    public func italic() -> Text { with("font-style", "italic") }
    public func italic(_ on: Bool) -> Text { on ? italic() : self }
    public func monospacedDigit() -> Text { with("font-variant-numeric", "tabular-nums") }
    public func monospaced(_ on: Bool = true) -> Text { on ? with("font-family", "var(--font-mono)") : self }
    public func foregroundColor(_ c: Color?) -> Text { c.map { with("color", $0.css) } ?? self }
    public func foregroundStyle<S: ShapeStyle>(_ s: S) -> Text { with("color", s._paint().flat) }
    public func underline(_ on: Bool = true, pattern: LineStyle.Pattern = .solid, color: Color? = nil) -> Text { on ? with("text-decoration", "underline") : self }
    public func strikethrough(_ on: Bool = true, pattern: LineStyle.Pattern = .solid, color: Color? = nil) -> Text { on ? with("text-decoration", "line-through") : self }
    public func kerning(_ k: CGFloat) -> Text { with("letter-spacing", _px(k)) }
    public func tracking(_ k: CGFloat) -> Text { with("letter-spacing", _px(k)) }
    public func baselineOffset(_ o: CGFloat) -> Text { self }
    public func textScale(_ s: TextScale, isEnabled: Bool = true) -> Text { self }
    public struct TextScale: Sendable { public static let `default` = TextScale(); public static let secondary = TextScale() }

    public static func + (a: Text, b: Text) -> Text { var t = a; t.runs += b.runs; return t }

}

extension Text: View, _Primitive {
    public typealias Body = Never
    public func _render() -> [_Node] {
        let n = _Node("text")
        if runs.count == 1 {
            let r = runs[0]
            n.p["s"] = .s(r.s)
            if r.md { n.p["md"] = true }
            for (k, v) in r.css.sorted(by: { $0.key < $1.key }) { n.css.append((k, v)) }
        } else {
            n.p["r"] = .a(runs.map { r in
                var o: [String: _J] = ["s": .s(r.s)]
                if !r.css.isEmpty { o["c"] = .s(r.css.sorted(by: { $0.key < $1.key }).map { "\($0.key):\($0.value)" }.joined(separator: ";")) }
                if r.md { o["md"] = true }
                return .o(o)
            })
        }
        return [n]
    }
}

// MARK: Bild

public struct Image: View, _Primitive, Equatable {
    public typealias Body = Never
    enum Src: Equatable { case symbol(String), res(String), named(String) }
    let src: Src
    var isResizable = false
    var label: String?

    nonisolated public init(systemName: String) { src = .symbol(systemName) }
    nonisolated public init(systemName: String, variableValue: Double?) { src = .symbol(systemName) }
    nonisolated public init(_ name: String, bundle: Bundle? = nil) { src = .named(name) }
    nonisolated public init(decorative name: String, bundle: Bundle? = nil) { src = .named(name) }
    nonisolated public init(uiImage: UIImage) { src = .res(MainActor.assumeIsolated { _resource(uiImage.data, mime: uiImage.mime) }) }

    public enum ResizingMode: Sendable { case tile, stretch }
    public enum TemplateRenderingMode: Sendable { case template, original }
    public enum Interpolation: Sendable { case none, low, medium, high }
    public enum Scale: Sendable { case small, medium, large }
    public enum Orientation: Sendable { case up, down, left, right }

    public func resizable(capInsets: EdgeInsets = EdgeInsets(), resizingMode: ResizingMode = .stretch) -> Image { var i = self; i.isResizable = true; return i }
    public func renderingMode(_ m: TemplateRenderingMode?) -> Image { self }
    public func interpolation(_ i: Interpolation) -> Image { self }
    public func antialiased(_ a: Bool) -> Image { self }
    public func symbolRenderingMode(_ m: SymbolRenderingMode?) -> Image { self }

    public func _render() -> [_Node] {
        let n: _Node
        switch src {
        case .symbol(let name): n = _Node("sym", ["n": .s(name)])
        case .res(let id): n = _Node("img", ["res": .s(id)])
        case .named(let name): n = _Node("img", ["name": .s(name)])
        }
        if isResizable { n.p["rs"] = true; n.gw = true; n.gh = true }
        return [n]
    }
}

public struct SymbolRenderingMode: Sendable {
    public static let monochrome = SymbolRenderingMode()
    public static let multicolor = SymbolRenderingMode()
    public static let hierarchical = SymbolRenderingMode()
    public static let palette = SymbolRenderingMode()
}

/** Bilddaten einmal ans Fenster schicken, danach nur noch die Kennung */
@MainActor func _resource(_ data: Data, mime: String) -> String {
    var h: UInt64 = 1469598103934665603
    let step = max(1, data.count / 4096)
    var i = 0
    while i < data.count { h = (h ^ UInt64(data[data.startIndex + i])) &* 1099511628211; i += step }
    let id = "r\(data.count)-\(String(h, radix: 36))"
    if _R.resources[id] == nil {
        _R.resources[id] = true
        _Server.resLock.lock()
        _Server.resources[id] = (mime, data)
        _Server.resLock.unlock()
    }
    return id
}

// MARK: Label

public struct Label<Title: View, Icon: View>: View {
    let title: Title
    let icon: Icon
    @Environment(\._labelStyle) private var style

    nonisolated public init(@ViewBuilder title: () -> Title, @ViewBuilder icon: () -> Icon) { self.title = title(); self.icon = icon() }

    public var body: some View {
        switch style {
        case "icon": icon
        case "title": title
        default: HStack(spacing: 6) { icon; title }
        }
    }
}

extension Label where Title == Text, Icon == Image {
    nonisolated public init(_ title: LocalizedStringKey, systemImage: String) { self.init(title: { Text(title) }, icon: { Image(systemName: systemImage) }) }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, systemImage: String) { self.init(title: { Text(title) }, icon: { Image(systemName: systemImage) }) }
    nonisolated public init(_ title: LocalizedStringKey, image: String) { self.init(title: { Text(title) }, icon: { Image(image) }) }
}

extension EnvironmentValues {
    var _labelStyle: String { get { MainActor.assumeIsolated { self[_Env.labelStyle] } } set { MainActor.assumeIsolated { self[_Env.labelStyle] = newValue } } }
}

public protocol LabelStyle { var _k: String { get } }
public struct DefaultLabelStyle: LabelStyle { public init() {}; public var _k: String { "auto" } }
public struct IconOnlyLabelStyle: LabelStyle { public init() {}; public var _k: String { "icon" } }
public struct TitleOnlyLabelStyle: LabelStyle { public init() {}; public var _k: String { "title" } }
public struct TitleAndIconLabelStyle: LabelStyle { public init() {}; public var _k: String { "both" } }
extension LabelStyle where Self == DefaultLabelStyle { public static var automatic: DefaultLabelStyle { .init() } }
extension LabelStyle where Self == IconOnlyLabelStyle { public static var iconOnly: IconOnlyLabelStyle { .init() } }
extension LabelStyle where Self == TitleOnlyLabelStyle { public static var titleOnly: TitleOnlyLabelStyle { .init() } }
extension LabelStyle where Self == TitleAndIconLabelStyle { public static var titleAndIcon: TitleAndIconLabelStyle { .init() } }

extension View {
    public func labelStyle<S: LabelStyle>(_ s: S) -> some View { _env { $0[_Env.labelStyle] = s._k } }
}

// MARK: Stapel

@MainActor func _stack(_ t: String, _ axis: _Axis, _ css: [(String, String)], _ content: () -> [_Node]) -> _Node {
    let kids = _withAxis(axis) { axis == .z ? content() : _withEnv({ $0[_Env.proposal] = nil }, content) }
    let n = _Node(t, [:], kids)
    n.css = css
    n.gw = kids.contains { $0.gw }
    n.gh = kids.contains { $0.gh }
    return n
}

public struct VStack<Content: View>: View, _Primitive {
    public typealias Body = Never
    let alignment: HorizontalAlignment, spacing: CGFloat?, content: Content
    nonisolated public init(alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {
        self.alignment = alignment; self.spacing = spacing; self.content = content()
    }
    public func _render() -> [_Node] {
        [_stack("v", .v, [("gap", _px(spacing ?? 8)), ("align-items", alignment.css)]) { SwiftUI._render(content) }]
    }
}

public struct HStack<Content: View>: View, _Primitive {
    public typealias Body = Never
    let alignment: VerticalAlignment, spacing: CGFloat?, content: Content
    nonisolated public init(alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {
        self.alignment = alignment; self.spacing = spacing; self.content = content()
    }
    public func _render() -> [_Node] {
        [_stack("h", .h, [("gap", _px(spacing ?? 8)), ("align-items", alignment.css)]) { SwiftUI._render(content) }]
    }
}

public struct ZStack<Content: View>: View, _Primitive {
    public typealias Body = Never
    let alignment: Alignment, content: Content
    nonisolated public init(alignment: Alignment = .center, @ViewBuilder content: () -> Content) { self.alignment = alignment; self.content = content() }
    public func _render() -> [_Node] {
        [_stack("z", .z, alignment.isCenter ? [] : [("place-items", alignment.css)]) { SwiftUI._render(content) }]
    }
}

public struct PinnedScrollableViews: OptionSet, Sendable {
    public let rawValue: Int
    nonisolated public init(rawValue: Int) { self.rawValue = rawValue }
    public static let sectionHeaders = PinnedScrollableViews(rawValue: 1)
    public static let sectionFooters = PinnedScrollableViews(rawValue: 2)
}

public struct LazyVStack<Content: View>: View, _Primitive {
    public typealias Body = Never
    let alignment: HorizontalAlignment, spacing: CGFloat?, content: Content
    nonisolated public init(alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, pinnedViews: PinnedScrollableViews = [], @ViewBuilder content: () -> Content) {
        self.alignment = alignment; self.spacing = spacing; self.content = content()
    }
    public func _render() -> [_Node] {
        let n = _stack("v", .v, [("gap", _px(spacing ?? 8)), ("align-items", alignment.css)]) { SwiftUI._render(content) }
        n.gw = true
        return [n]
    }
}

public struct LazyHStack<Content: View>: View, _Primitive {
    public typealias Body = Never
    let alignment: VerticalAlignment, spacing: CGFloat?, content: Content
    nonisolated public init(alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, pinnedViews: PinnedScrollableViews = [], @ViewBuilder content: () -> Content) {
        self.alignment = alignment; self.spacing = spacing; self.content = content()
    }
    public func _render() -> [_Node] {
        [_stack("h", .h, [("gap", _px(spacing ?? 8)), ("align-items", alignment.css)]) { SwiftUI._render(content) }]
    }
}

public struct Spacer: View, _Primitive {
    public typealias Body = Never
    let minLength: CGFloat?
    nonisolated public init(minLength: CGFloat? = nil) { self.minLength = minLength }
    public func _render() -> [_Node] {
        let n = _Node("sp")
        let axis = _R.axis
        n.gw = axis != .v
        n.gh = axis != .h
        let m = _px(minLength ?? 8)
        if axis == .h { n.css = [("min-width", m)] } else if axis == .v { n.css = [("min-height", m)] }
        return [n]
    }
}

public struct Divider: View, _Primitive {
    public typealias Body = Never
    nonisolated public init() {}
    public func _render() -> [_Node] {
        let n = _Node("divider")
        if _R.axis == .h { n.gh = true; n.p["vert"] = true } else { n.gw = true }
        return [n]
    }
}

// MARK: Scrollen

public struct ScrollView<Content: View>: View, _Primitive {
    public typealias Body = Never
    let axes: Axis.Set, content: Content
    nonisolated public init(_ axes: Axis.Set = .vertical, showsIndicators: Bool = true, @ViewBuilder content: () -> Content) { self.axes = axes; self.content = content() }
    public func _render() -> [_Node] {
        let vertical = axes.contains(.vertical)
        let inner = _stack(vertical ? "v" : "h", vertical ? .v : .h, [("gap", "8px"), ("align-items", "center")]) {
            _withEnv({ $0[_Env.refresh] = nil; $0[_Env.scrollAnchor] = nil }) { SwiftUI._render(content) }
        }
        let n = _Node("scroll", ["ax": .s(axes == [.horizontal, .vertical] ? "b" : vertical ? "v" : "h")], [inner])
        n.gw = true
        n.gh = vertical
        n.p["k"] = .n(_id(_R.path))
        if let r = _R.env[_Env.refresh] {
            n.p["refresh"] = _R.handler("refresh") { Task { @MainActor in await r() ; _R.message(["k": "refreshed"]) } }
        }
        if let a = _R.env[_Env.scrollAnchor] { n.p["anchor"] = .s(a) }
        return [n]
    }
}

extension _Env { static let scrollAnchor = _EnvName<String?>(nil) }

public struct ScrollViewProxy {
    public func scrollTo<ID: Hashable>(_ id: ID, anchor: UnitPoint? = nil) {
        MainActor.assumeIsolated {
            _R.message(["k": "scrollTo", "id": .n(_id(_hash(id))), "anchor": .s(anchor == .bottom ? "end" : anchor == .top ? "start" : anchor == .center ? "center" : "nearest"),
                        "anim": .b(_R.txAnim != nil)])
        }
    }
}

public struct ScrollViewReader<Content: View>: View, _Primitive {
    public typealias Body = Never
    let content: (ScrollViewProxy) -> Content
    nonisolated public init(@ViewBuilder content: @escaping (ScrollViewProxy) -> Content) { self.content = content }
    public func _render() -> [_Node] { SwiftUI._render(content(ScrollViewProxy())) }
}

public enum ScrollDismissesKeyboardMode: Sendable { case automatic, immediately, interactively, never }
public enum ScrollIndicatorVisibility: Sendable { case automatic, visible, hidden, never }
public enum ScrollBounceBehavior: Sendable { case automatic, always, basedOnSize }

// MARK: Größe lesen

public struct GeometryProxy {
    public let size: CGSize
    public var safeAreaInsets: EdgeInsets { EdgeInsets(top: 59, leading: 0, bottom: 34, trailing: 0) }
    public func frame(in space: CoordinateSpace) -> CGRect { CGRect(origin: .zero, size: size) }
    public func frame<C: CoordinateSpaceProtocol>(in space: C) -> CGRect { CGRect(origin: .zero, size: size) }
}

public enum CoordinateSpace: Sendable { case global, local, named(AnyHashable) }
public protocol CoordinateSpaceProtocol {}
public struct GlobalCoordinateSpace: CoordinateSpaceProtocol {}
public struct LocalCoordinateSpace: CoordinateSpaceProtocol {}
public struct NamedCoordinateSpace: CoordinateSpaceProtocol {}
extension CoordinateSpaceProtocol where Self == GlobalCoordinateSpace { public static var global: GlobalCoordinateSpace { .init() } }
extension CoordinateSpaceProtocol where Self == LocalCoordinateSpace { public static var local: LocalCoordinateSpace { .init() } }
extension CoordinateSpaceProtocol where Self == NamedCoordinateSpace { public static func named(_ n: some Hashable) -> NamedCoordinateSpace { .init() } }

/** Größe eines Bausteins: vorgegeben durch frame(), sonst vom Fenster gemessen */
@MainActor func _knownSize(_ n: _Node) -> CGSize {
    let prop = _R.env[_Env.proposal]
    if let w = prop?.width, let h = prop?.height { return CGSize(width: w, height: h) }
    let m = _R.measure()
    n.p["m"] = m.id
    if let s = m.size { return s }
    return CGSize(width: prop?.width ?? _R.screen.width, height: prop?.height ?? 0)
}

public struct GeometryReader<Content: View>: View, _Primitive {
    public typealias Body = Never
    let content: (GeometryProxy) -> Content
    nonisolated public init(@ViewBuilder content: @escaping (GeometryProxy) -> Content) { self.content = content }
    public func _render() -> [_Node] {
        let n = _Node("geo")
        n.gw = true; n.gh = true
        let size = _knownSize(n)
        n.c = _withAxis(.z) { _withEnv({ $0[_Env.proposal] = nil }) { SwiftUI._render(content(GeometryProxy(size: size))) } }
        return [n]
    }
}

// MARK: Raster

public struct GridItem: Sendable {
    public enum Size: Sendable { case fixed(CGFloat), flexible(minimum: CGFloat = 10, maximum: CGFloat = .infinity), adaptive(minimum: CGFloat, maximum: CGFloat = .infinity) }
    public var size: Size
    public var spacing: CGFloat?
    public var alignment: Alignment?
    nonisolated public init(_ size: Size = .flexible(), spacing: CGFloat? = nil, alignment: Alignment? = nil) { self.size = size; self.spacing = spacing; self.alignment = alignment }
    var css: String {
        switch size {
        case .fixed(let w): return _px(w)
        case .flexible: return "minmax(0, 1fr)"
        case .adaptive(let mn, _): return "repeat(auto-fill, minmax(\(_px(mn)), 1fr))"
        }
    }
}

public struct LazyVGrid<Content: View>: View, _Primitive {
    public typealias Body = Never
    let columns: [GridItem], alignment: HorizontalAlignment, spacing: CGFloat?, content: Content
    nonisolated public init(columns: [GridItem], alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, pinnedViews: PinnedScrollableViews = [], @ViewBuilder content: () -> Content) {
        self.columns = columns; self.alignment = alignment; self.spacing = spacing; self.content = content()
    }
    public func _render() -> [_Node] {
        let kids = _withAxis(.z) { _withEnv({ $0[_Env.proposal] = nil }) { SwiftUI._render(content) } }
        let n = _Node("grid", [:], kids)
        n.gw = true
        n.css = [("grid-template-columns", columns.map(\.css).joined(separator: " ")),
                 ("column-gap", _px(columns.first?.spacing ?? 8)), ("row-gap", _px(spacing ?? 8)), ("justify-items", alignment.css)]
        return [n]
    }
}

public struct LazyHGrid<Content: View>: View, _Primitive {
    public typealias Body = Never
    let rows: [GridItem], spacing: CGFloat?, content: Content
    nonisolated public init(rows: [GridItem], alignment: VerticalAlignment = .center, spacing: CGFloat? = nil, pinnedViews: PinnedScrollableViews = [], @ViewBuilder content: () -> Content) {
        self.rows = rows; self.spacing = spacing; self.content = content()
    }
    public func _render() -> [_Node] {
        let kids = _withAxis(.z) { SwiftUI._render(content) }
        let n = _Node("grid", [:], kids)
        n.css = [("grid-template-rows", rows.map(\.css).joined(separator: " ")), ("grid-auto-flow", "column"),
                 ("row-gap", _px(rows.first?.spacing ?? 8)), ("column-gap", _px(spacing ?? 8))]
        return [n]
    }
}

/** Nimmt die erste Variante, die passt – das Fenster probiert sie der Reihe nach */
public struct ViewThatFits<Content: View>: View, _Primitive {
    public typealias Body = Never
    let axes: Axis.Set, content: Content
    nonisolated public init(in axes: Axis.Set = [.horizontal, .vertical], @ViewBuilder content: () -> Content) { self.axes = axes; self.content = content() }
    public func _render() -> [_Node] {
        let kids = _children(content).map { c -> _Node in
            let nodes = _renderChild(c)
            return nodes.count == 1 ? nodes[0] : _Node("z", [:], nodes)
        }
        let n = _Node("fits", ["ax": .s(axes.contains(.horizontal) ? "h" : "v")], kids)
        n.gw = kids.contains { $0.gw }
        return [n]
    }
}

// MARK: Zeitleiste

public struct TimelineViewDefaultContext { public let date: Date; public enum Cadence: Comparable, Sendable { case live, seconds, minutes }; public var cadence: Cadence { .live } }

public protocol TimelineSchedule { var _interval: Double? { get } }
public struct AnimationTimelineSchedule: TimelineSchedule {
    let paused: Bool
    nonisolated public init(minimumInterval: Double? = nil, paused: Bool = false) { self.paused = paused }
    public var _interval: Double? { paused ? nil : 0 }
}
public struct PeriodicTimelineSchedule: TimelineSchedule {
    let by: Double
    nonisolated public init(from: Date, by: Double) { self.by = by }
    public var _interval: Double? { by }
}
public struct EveryMinuteTimelineSchedule: TimelineSchedule { public init() {}; public var _interval: Double? { 30 } }
extension TimelineSchedule where Self == AnimationTimelineSchedule {
    public static var animation: AnimationTimelineSchedule { .init() }
    public static func animation(minimumInterval: Double? = nil, paused: Bool = false) -> AnimationTimelineSchedule { .init(minimumInterval: minimumInterval, paused: paused) }
}
extension TimelineSchedule where Self == PeriodicTimelineSchedule {
    public static func periodic(from: Date, by: Double) -> PeriodicTimelineSchedule { .init(from: from, by: by) }
}
extension TimelineSchedule where Self == EveryMinuteTimelineSchedule { public static var everyMinute: EveryMinuteTimelineSchedule { .init() } }

public struct TimelineView<Schedule: TimelineSchedule, Content: View>: View, _Primitive {
    public typealias Body = Never
    public typealias Context = TimelineViewDefaultContext
    let schedule: Schedule
    let content: (TimelineViewDefaultContext) -> Content
    nonisolated public init(_ schedule: Schedule, @ViewBuilder content: @escaping (TimelineViewDefaultContext) -> Content) { self.schedule = schedule; self.content = content }
    public func _render() -> [_Node] {
        if let i = schedule._interval {
            if i == 0 { _R.timeline = true }
            else {
                let l = _R.life(_mix(_R.path, 77))
                if l.task == nil {
                    l.task = Task { @MainActor in
                        while !Task.isCancelled { try? await Task.sleep(for: .seconds(i)); _R.invalidate() }
                    }
                }
            }
        }
        return SwiftUI._render(content(TimelineViewDefaultContext(date: Date())))
    }
}

// MARK: eigene Layouts (umbrechende Chips)

public struct ProposedViewSize: Equatable, Sendable {
    public var width: CGFloat?, height: CGFloat?
    nonisolated public init(width: CGFloat?, height: CGFloat?) { self.width = width; self.height = height }
    nonisolated public init(_ s: CGSize) { width = s.width; height = s.height }
    public static let zero = ProposedViewSize(width: 0, height: 0)
    public static let unspecified = ProposedViewSize(width: nil, height: nil)
    public static let infinity = ProposedViewSize(width: .infinity, height: .infinity)
    public func replacingUnspecifiedDimensions(by s: CGSize = CGSize(width: 10, height: 10)) -> CGSize { CGSize(width: width ?? s.width, height: height ?? s.height) }
}

public struct LayoutSubview {
    public func sizeThatFits(_ p: ProposedViewSize) -> CGSize { .zero }
    public func dimensions(in p: ProposedViewSize) -> CGSize { .zero }
    public func place(at: CGPoint, anchor: UnitPoint = .topLeading, proposal: ProposedViewSize) {}
    public var priority: Double { 0 }
}

public typealias LayoutSubviews = [LayoutSubview]

/** Am PC ordnet das Fenster die Kinder umbrechend an; die eigene Rechnung der App wird nicht gebraucht */
@MainActor public protocol Layout {
    associatedtype Cache = Void
    typealias Subviews = LayoutSubviews
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache)
}

extension Layout {
    public func callAsFunction<V: View>(@ViewBuilder _ content: () -> V) -> some View { _FlowView(spacing: _spacing(self), content: content()) }
}

func _spacing(_ layout: Any) -> CGFloat {
    for ch in Mirror(reflecting: layout).children where ch.label == "spacing" {
        if let v = ch.value as? CGFloat { return v }
        if let v = ch.value as? Double { return CGFloat(v) }
    }
    return 8
}

struct _FlowView<C: View>: View, _Primitive {
    typealias Body = Never
    let spacing: CGFloat
    let content: C
    func _render() -> [_Node] {
        let kids = _withAxis(.h) { _withEnv({ $0[_Env.proposal] = nil }) { SwiftUI._render(content) } }
        let n = _Node("flow", [:], kids)
        n.gw = true
        n.css = [("gap", _px(spacing))]
        return [n]
    }
}
