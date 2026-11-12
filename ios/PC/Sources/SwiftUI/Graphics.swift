// Farben, Verläufe, Schrift, Geometrie, Animation

// MARK: Farbe

public struct Color: Hashable, Sendable {
    var r = 0.0, g = 0.0, b = 0.0, a = 1.0
    /** dynamische Farbe als CSS-Ausdruck (Akzent, Vordergrund) */
    var dyn: String?

    public enum RGBColorSpace: Sendable { case sRGB, sRGBLinear, displayP3 }

    nonisolated public init(_ space: RGBColorSpace = .sRGB, red: Double, green: Double, blue: Double, opacity: Double = 1) {
        r = red; g = green; b = blue; a = opacity
    }
    nonisolated public init(_ space: RGBColorSpace = .sRGB, white: Double, opacity: Double = 1) { r = white; g = white; b = white; a = opacity }
    nonisolated public init(hue: Double, saturation: Double, brightness: Double, opacity: Double = 1) {
        let h = (hue - floor(hue)) * 6, c = brightness * saturation, x = c * (1 - abs(h.truncatingRemainder(dividingBy: 2) - 1)), m = brightness - c
        let (r1, g1, b1): (Double, Double, Double)
        switch Int(h) {
        case 0: (r1, g1, b1) = (c, x, 0)
        case 1: (r1, g1, b1) = (x, c, 0)
        case 2: (r1, g1, b1) = (0, c, x)
        case 3: (r1, g1, b1) = (0, x, c)
        case 4: (r1, g1, b1) = (x, 0, c)
        default: (r1, g1, b1) = (c, 0, x)
        }
        r = r1 + m; g = g1 + m; b = b1 + m; a = opacity
    }
    init(_ hex: UInt32, _ alpha: Double = 1) {
        r = Double((hex >> 16) & 0xFF) / 255; g = Double((hex >> 8) & 0xFF) / 255; b = Double(hex & 0xFF) / 255; a = alpha
    }
    init(dyn: String) { self.dyn = dyn }
    nonisolated public init(_ c: Color) { self = c }
    nonisolated public init(uiColor: UIColor) { self = uiColor.color }
    nonisolated public init(_ c: UIColor) { self = c.color }
    nonisolated public init(_ name: String, bundle: Bundle? = nil) { self = name == "AccentColor" ? .accentColor : .gray }

    public func opacity(_ o: Double) -> Color {
        var c = self
        if let d = dyn { c.dyn = "color-mix(in srgb, \(d) \(_num(max(0, min(1, o)) * 100))%, transparent)" } else { c.a = a * o }
        return c
    }

    var css: String {
        if let dyn { return dyn }
        let R = Int((max(0, min(1, r)) * 255).rounded()), G = Int((max(0, min(1, g)) * 255).rounded()), B = Int((max(0, min(1, b)) * 255).rounded())
        if a >= 1 { return String(format: "#%02x%02x%02x", R, G, B) }
        return "rgba(\(R),\(G),\(B),\(_num(max(0, a))))"
    }

    public static let clear = Color(0, 0)
    public static let black = Color(0x000000)
    public static let white = Color(0xFFFFFF)
    public static let red = Color(0xFF3B30)
    public static let orange = Color(0xFF9500)
    public static let yellow = Color(0xFFCC00)
    public static let green = Color(0x34C759)
    public static let mint = Color(0x00C7BE)
    public static let teal = Color(0x30B0C7)
    public static let cyan = Color(0x32ADE6)
    public static let blue = Color(0x007AFF)
    public static let indigo = Color(0x5856D6)
    public static let purple = Color(0xAF52DE)
    public static let pink = Color(0xFF2D55)
    public static let brown = Color(0xA2845E)
    public static let gray = Color(0x8E8E93)
    public static let primary = Color(dyn: "var(--label)")
    public static let secondary = Color(dyn: "var(--label2)")
    public static let accentColor = Color(dyn: "var(--tint)")

    public var description: String { css }
    public func resolve(in env: EnvironmentValues) -> Resolved { Resolved(red: Float(r), green: Float(g), blue: Float(b), opacity: Float(a)) }
    public struct Resolved: Hashable, Sendable { public var red: Float, green: Float, blue: Float, opacity: Float }
}

// MARK: ShapeStyle

public indirect enum _Paint {
    case color(Color)
    case linear(Gradient, UnitPoint, UnitPoint)
    case radial(Gradient, UnitPoint, CGFloat, CGFloat)
    case angular(Gradient, UnitPoint)
    case foreground(Double)
    case material(Double)
    case faded(_Paint, Double)

    /** als CSS-Hintergrund */
    var css: String {
        switch self {
        case .color(let c): return c.css
        case .foreground(let o): return o >= 1 ? "var(--fg, currentColor)" : "color-mix(in srgb, currentColor \(_num(o * 100))%, transparent)"
        case .material(let o): return "rgba(255,255,255,\(_num(o)))"
        case .faded(let p, let o):
            switch p {
            case .color(let c): return c.opacity(o).css
            case .linear(let g, let s, let e): return _Paint.linear(g.faded(o), s, e).css
            case .radial(let g, let c, let a, let b): return _Paint.radial(g.faded(o), c, a, b).css
            default: return p.css
            }
        case .linear(let g, let s, let e):
            let dx = Double(e.x - s.x), dy = Double(e.y - s.y)
            var dir: String
            if abs(dx) < 0.001 { dir = dy >= 0 ? "to bottom" : "to top" }
            else if abs(dy) < 0.001 { dir = dx >= 0 ? "to right" : "to left" }
            else if abs(abs(dx) - 1) < 0.001, abs(abs(dy) - 1) < 0.001 { dir = "to \(dy > 0 ? "bottom" : "top") \(dx > 0 ? "right" : "left")" }
            else { dir = "\(_num(atan2(dx, -dy) * 180 / .pi))deg" }
            return "linear-gradient(\(dir), \(g.cssStops))"
        case .radial(let g, let c, let r0, let r1):
            let stops = g.stops.map { "\($0.color.css) \(_px(r0 + (r1 - r0) * $0.location))" }.joined(separator: ", ")
            return "radial-gradient(circle at \(_num(Double(c.x) * 100))% \(_num(Double(c.y) * 100))%, \(stops))"
        case .angular(let g, let c):
            return "conic-gradient(from 90deg at \(_num(Double(c.x) * 100))% \(_num(Double(c.y) * 100))%, \(g.cssStops))"
        }
    }

    /** einfache Farbe (für Text, Linien) */
    var flat: String {
        switch self {
        case .color(let c): return c.css
        case .linear(let g, _, _), .radial(let g, _, _, _), .angular(let g, _): return g.stops.first?.color.css ?? "currentColor"
        case .foreground(let o): return o >= 1 ? "currentColor" : "color-mix(in srgb, currentColor \(_num(o * 100))%, transparent)"
        case .material: return css
        case .faded(let p, let o): if case .color(let c) = p { return c.opacity(o).css }; return p.flat
        }
    }

    var isFlat: Bool { if case .color = self { return true }; if case .foreground = self { return true }; return false }

    /** für SVG und Canvas */
    var json: _J {
        switch self {
        case .color(let c): return .s(c.css)
        case .foreground, .material: return .s(flat)
        case .faded(let p, let o):
            switch p {
            case .linear(let g, let s, let e): return _Paint.linear(g.faded(o), s, e).json
            case .radial(let g, let c, let a, let b): return _Paint.radial(g.faded(o), c, a, b).json
            default: return .s(flat)
            }
        case .linear(let g, let s, let e): return .o(["k": "l", "st": g.json, "a": .a([.n(s.x), .n(s.y), .n(e.x), .n(e.y)])])
        case .radial(let g, let c, let r0, let r1): return .o(["k": "r", "st": g.json, "a": .a([.n(c.x), .n(c.y), .n(r0), .n(r1)])])
        case .angular(let g, _): return .s(g.stops.first?.color.css ?? "currentColor")
        }
    }
}

public protocol ShapeStyle: Sendable {
    func _paint() -> _Paint
}

extension ShapeStyle {
    @_disfavoredOverload public func opacity(_ o: Double) -> some ShapeStyle { _AnyStyle(p: .faded(_paint(), o)) }
}

struct _AnyStyle: ShapeStyle, @unchecked Sendable {
    let p: _Paint
    func _paint() -> _Paint { p }
}

public struct AnyShapeStyle: ShapeStyle, @unchecked Sendable {
    let p: _Paint
    nonisolated public init<S: ShapeStyle>(_ s: S) { p = s._paint() }
    public func _paint() -> _Paint { p }
}

extension Color: ShapeStyle {
    public func _paint() -> _Paint { .color(self) }
}

extension ShapeStyle where Self == Color {
    public static var clear: Color { .clear }
    public static var black: Color { .black }
    public static var white: Color { .white }
    public static var red: Color { .red }
    public static var orange: Color { .orange }
    public static var yellow: Color { .yellow }
    public static var green: Color { .green }
    public static var mint: Color { .mint }
    public static var teal: Color { .teal }
    public static var cyan: Color { .cyan }
    public static var blue: Color { .blue }
    public static var indigo: Color { .indigo }
    public static var purple: Color { .purple }
    public static var pink: Color { .pink }
    public static var brown: Color { .brown }
    public static var gray: Color { .gray }
    public static var accentColor: Color { .accentColor }
}

public struct HierarchicalShapeStyle: ShapeStyle {
    let level: Int
    public func _paint() -> _Paint {
        switch level {
        case 0: return .color(.primary)
        case 1: return .color(.secondary)
        case 2: return .color(Color(dyn: "var(--label3)"))
        default: return .color(Color(dyn: "var(--label4)"))
        }
    }
    public static let primary = HierarchicalShapeStyle(level: 0)
    public static let secondary = HierarchicalShapeStyle(level: 1)
    public static let tertiary = HierarchicalShapeStyle(level: 2)
    public static let quaternary = HierarchicalShapeStyle(level: 3)
}

extension ShapeStyle where Self == HierarchicalShapeStyle {
    public static var primary: HierarchicalShapeStyle { .primary }
    public static var secondary: HierarchicalShapeStyle { .secondary }
    public static var tertiary: HierarchicalShapeStyle { .tertiary }
    public static var quaternary: HierarchicalShapeStyle { .quaternary }
}

public struct TintShapeStyle: ShapeStyle {
    nonisolated public init() {}
    public func _paint() -> _Paint { .color(.accentColor) }
}
extension ShapeStyle where Self == TintShapeStyle { public static var tint: TintShapeStyle { TintShapeStyle() } }

public struct ForegroundStyle: ShapeStyle {
    nonisolated public init() {}
    public func _paint() -> _Paint { .foreground(1) }
}
extension ShapeStyle where Self == ForegroundStyle { public static var foreground: ForegroundStyle { ForegroundStyle() } }

public struct BackgroundStyle: ShapeStyle {
    nonisolated public init() {}
    public func _paint() -> _Paint { .color(Color(dyn: "var(--bg)")) }
}
extension ShapeStyle where Self == BackgroundStyle { public static var background: BackgroundStyle { BackgroundStyle() } }

public struct SeparatorShapeStyle: ShapeStyle {
    nonisolated public init() {}
    public func _paint() -> _Paint { .color(Color(dyn: "var(--sep)")) }
}
extension ShapeStyle where Self == SeparatorShapeStyle { public static var separator: SeparatorShapeStyle { SeparatorShapeStyle() } }

public struct Material: ShapeStyle {
    let o: Double
    public func _paint() -> _Paint { .material(o) }
    public static let ultraThinMaterial = Material(o: 0.45)
    public static let thinMaterial = Material(o: 0.6)
    public static let regularMaterial = Material(o: 0.72)
    public static let thickMaterial = Material(o: 0.85)
    public static let ultraThickMaterial = Material(o: 0.93)
    public static let bar = Material(o: 0.8)
}
extension ShapeStyle where Self == Material {
    public static var ultraThinMaterial: Material { .ultraThinMaterial }
    public static var thinMaterial: Material { .thinMaterial }
    public static var regularMaterial: Material { .regularMaterial }
    public static var thickMaterial: Material { .thickMaterial }
    public static var ultraThickMaterial: Material { .ultraThickMaterial }
    public static var bar: Material { .bar }
}

// MARK: Verläufe

public struct Gradient: Hashable, Sendable {
    public struct Stop: Hashable, Sendable {
        public var color: Color
        public var location: CGFloat
        nonisolated public init(color: Color, location: CGFloat) { self.color = color; self.location = location }
    }
    public var stops: [Stop]
    nonisolated public init(stops: [Stop]) { self.stops = stops }
    nonisolated public init(colors: [Color]) {
        let n = max(colors.count - 1, 1)
        stops = colors.enumerated().map { Stop(color: $1, location: CGFloat($0) / CGFloat(n)) }
    }
    var cssStops: String { stops.map { "\($0.color.css) \(_num(Double($0.location) * 100))%" }.joined(separator: ", ") }
    var json: _J { .a(stops.map { .a([.s($0.color.css), .n($0.location)]) }) }
    func faded(_ o: Double) -> Gradient { Gradient(stops: stops.map { Stop(color: $0.color.opacity(o), location: $0.location) }) }
}

extension Gradient: ShapeStyle {
    public func _paint() -> _Paint { .linear(self, .top, .bottom) }
}

public struct LinearGradient: ShapeStyle, View, _Primitive {
    public typealias Body = Never
    let g: Gradient, s: UnitPoint, e: UnitPoint
    nonisolated public init(gradient: Gradient, startPoint: UnitPoint, endPoint: UnitPoint) { g = gradient; s = startPoint; e = endPoint }
    nonisolated public init(colors: [Color], startPoint: UnitPoint, endPoint: UnitPoint) { g = Gradient(colors: colors); s = startPoint; e = endPoint }
    nonisolated public init(stops: [Gradient.Stop], startPoint: UnitPoint, endPoint: UnitPoint) { g = Gradient(stops: stops); s = startPoint; e = endPoint }
    public func _paint() -> _Paint { .linear(g, s, e) }
    public func _render() -> [_Node] { _fillNode(_paint()) }
}

public struct RadialGradient: ShapeStyle, View, _Primitive {
    public typealias Body = Never
    let g: Gradient, c: UnitPoint, r0: CGFloat, r1: CGFloat
    nonisolated public init(gradient: Gradient, center: UnitPoint, startRadius: CGFloat, endRadius: CGFloat) { g = gradient; c = center; r0 = startRadius; r1 = endRadius }
    nonisolated public init(colors: [Color], center: UnitPoint, startRadius: CGFloat, endRadius: CGFloat) { g = Gradient(colors: colors); c = center; r0 = startRadius; r1 = endRadius }
    nonisolated public init(stops: [Gradient.Stop], center: UnitPoint, startRadius: CGFloat, endRadius: CGFloat) { g = Gradient(stops: stops); c = center; r0 = startRadius; r1 = endRadius }
    public func _paint() -> _Paint { .radial(g, c, r0, r1) }
    public func _render() -> [_Node] { _fillNode(_paint()) }
}

public struct AngularGradient: ShapeStyle, View, _Primitive {
    public typealias Body = Never
    let g: Gradient, c: UnitPoint
    nonisolated public init(gradient: Gradient, center: UnitPoint, angle: Angle = .zero) { g = gradient; c = center }
    nonisolated public init(colors: [Color], center: UnitPoint, angle: Angle = .zero) { g = Gradient(colors: colors); c = center }
    nonisolated public init(colors: [Color], center: UnitPoint, startAngle: Angle, endAngle: Angle) { g = Gradient(colors: colors); c = center }
    public func _paint() -> _Paint { .angular(g, c) }
    public func _render() -> [_Node] { _fillNode(_paint()) }
}

extension ShapeStyle where Self == LinearGradient {
    public static func linearGradient(_ g: Gradient, startPoint: UnitPoint, endPoint: UnitPoint) -> LinearGradient { LinearGradient(gradient: g, startPoint: startPoint, endPoint: endPoint) }
    public static func linearGradient(colors: [Color], startPoint: UnitPoint, endPoint: UnitPoint) -> LinearGradient { LinearGradient(colors: colors, startPoint: startPoint, endPoint: endPoint) }
    public static func linearGradient(stops: [Gradient.Stop], startPoint: UnitPoint, endPoint: UnitPoint) -> LinearGradient { LinearGradient(stops: stops, startPoint: startPoint, endPoint: endPoint) }
}

extension ShapeStyle where Self == RadialGradient {
    public static func radialGradient(_ g: Gradient, center: UnitPoint, startRadius: CGFloat, endRadius: CGFloat) -> RadialGradient { RadialGradient(gradient: g, center: center, startRadius: startRadius, endRadius: endRadius) }
    public static func radialGradient(colors: [Color], center: UnitPoint, startRadius: CGFloat, endRadius: CGFloat) -> RadialGradient { RadialGradient(colors: colors, center: center, startRadius: startRadius, endRadius: endRadius) }
}

@MainActor func _fillNode(_ p: _Paint) -> [_Node] {
    let n = _Node("fill")
    n.gw = true; n.gh = true
    n.css = [("background", p.css)]
    return [n]
}

extension Color: View, _Primitive {
    public typealias Body = Never
    public func _render() -> [_Node] { _fillNode(.color(self)) }
}

// MARK: Geometrie

public struct Angle: Hashable, Sendable, Comparable {
    public var radians: Double
    public var degrees: Double { get { radians * 180 / .pi } set { radians = newValue * .pi / 180 } }
    nonisolated public init() { radians = 0 }
    nonisolated public init(radians: Double) { self.radians = radians }
    nonisolated public init(degrees: Double) { radians = degrees * .pi / 180 }
    public static func radians(_ r: Double) -> Angle { Angle(radians: r) }
    public static func degrees(_ d: Double) -> Angle { Angle(degrees: d) }
    public static let zero = Angle()
    public static func < (a: Angle, b: Angle) -> Bool { a.radians < b.radians }
    public static func + (a: Angle, b: Angle) -> Angle { Angle(radians: a.radians + b.radians) }
    public static func - (a: Angle, b: Angle) -> Angle { Angle(radians: a.radians - b.radians) }
    public static func * (a: Angle, b: Double) -> Angle { Angle(radians: a.radians * b) }
    public static func / (a: Angle, b: Double) -> Angle { Angle(radians: a.radians / b) }
    public static prefix func - (a: Angle) -> Angle { Angle(radians: -a.radians) }
}

public struct UnitPoint: Hashable, Sendable {
    public var x: CGFloat, y: CGFloat
    nonisolated public init(x: CGFloat, y: CGFloat) { self.x = x; self.y = y }
    public static let zero = UnitPoint(x: 0, y: 0)
    public static let center = UnitPoint(x: 0.5, y: 0.5)
    public static let leading = UnitPoint(x: 0, y: 0.5)
    public static let trailing = UnitPoint(x: 1, y: 0.5)
    public static let top = UnitPoint(x: 0.5, y: 0)
    public static let bottom = UnitPoint(x: 0.5, y: 1)
    public static let topLeading = UnitPoint(x: 0, y: 0)
    public static let topTrailing = UnitPoint(x: 1, y: 0)
    public static let bottomLeading = UnitPoint(x: 0, y: 1)
    public static let bottomTrailing = UnitPoint(x: 1, y: 1)
    var css: String { "\(_num(Double(x) * 100))% \(_num(Double(y) * 100))%" }
}

public struct HorizontalAlignment: Hashable, Sendable {
    let v: Int
    public static let leading = HorizontalAlignment(v: 0)
    public static let center = HorizontalAlignment(v: 1)
    public static let trailing = HorizontalAlignment(v: 2)
    public static let listRowSeparatorLeading = HorizontalAlignment(v: 0)
    public static let listRowSeparatorTrailing = HorizontalAlignment(v: 2)
    var css: String { ["start", "center", "end"][v] }
}

public struct VerticalAlignment: Hashable, Sendable {
    let v: Int
    public static let top = VerticalAlignment(v: 0)
    public static let center = VerticalAlignment(v: 1)
    public static let bottom = VerticalAlignment(v: 2)
    public static let firstTextBaseline = VerticalAlignment(v: 3)
    public static let lastTextBaseline = VerticalAlignment(v: 4)
    var css: String { ["start", "center", "end", "baseline", "last baseline"][v] }
}

public struct Alignment: Hashable, Sendable {
    public var horizontal: HorizontalAlignment
    public var vertical: VerticalAlignment
    nonisolated public init(horizontal: HorizontalAlignment, vertical: VerticalAlignment) { self.horizontal = horizontal; self.vertical = vertical }
    public static let center = Alignment(horizontal: .center, vertical: .center)
    public static let leading = Alignment(horizontal: .leading, vertical: .center)
    public static let trailing = Alignment(horizontal: .trailing, vertical: .center)
    public static let top = Alignment(horizontal: .center, vertical: .top)
    public static let bottom = Alignment(horizontal: .center, vertical: .bottom)
    public static let topLeading = Alignment(horizontal: .leading, vertical: .top)
    public static let topTrailing = Alignment(horizontal: .trailing, vertical: .top)
    public static let bottomLeading = Alignment(horizontal: .leading, vertical: .bottom)
    public static let bottomTrailing = Alignment(horizontal: .trailing, vertical: .bottom)
    public static let leadingFirstTextBaseline = Alignment(horizontal: .leading, vertical: .firstTextBaseline)
    public static let centerFirstTextBaseline = Alignment(horizontal: .center, vertical: .firstTextBaseline)
    public static let trailingFirstTextBaseline = Alignment(horizontal: .trailing, vertical: .firstTextBaseline)
    /** "vertikal horizontal" für place-items */
    var css: String { "\(vertical.v > 2 ? "start" : vertical.css) \(horizontal.css)" }
    var isCenter: Bool { self == .center }
}

public enum Edge: Int8, Hashable, CaseIterable, Sendable {
    case top, leading, bottom, trailing
    public struct Set: OptionSet, Hashable, Sendable {
        public let rawValue: Int8
        nonisolated public init(rawValue: Int8) { self.rawValue = rawValue }
        nonisolated public init(_ e: Edge) { rawValue = 1 << e.rawValue }
        public static let top = Set(.top)
        public static let leading = Set(.leading)
        public static let bottom = Set(.bottom)
        public static let trailing = Set(.trailing)
        public static let all: Set = [.top, .leading, .bottom, .trailing]
        public static let horizontal: Set = [.leading, .trailing]
        public static let vertical: Set = [.top, .bottom]
    }
}

public typealias VerticalEdge = Edge
public typealias HorizontalEdge = Edge

public struct EdgeInsets: Hashable, Sendable {
    public var top: CGFloat, leading: CGFloat, bottom: CGFloat, trailing: CGFloat
    nonisolated public init(top: CGFloat = 0, leading: CGFloat = 0, bottom: CGFloat = 0, trailing: CGFloat = 0) {
        self.top = top; self.leading = leading; self.bottom = bottom; self.trailing = trailing
    }
    var css: String { "\(_px(top)) \(_px(trailing)) \(_px(bottom)) \(_px(leading))" }
}

public enum Axis: Int8, Hashable, CaseIterable, Sendable {
    case horizontal, vertical
    public struct Set: OptionSet, Hashable, Sendable {
        public let rawValue: Int8
        nonisolated public init(rawValue: Int8) { self.rawValue = rawValue }
        public static let horizontal = Set(rawValue: 1)
        public static let vertical = Set(rawValue: 2)
    }
}

public enum ContentMode: Hashable, Sendable { case fit, fill }
public enum TextAlignment: Hashable, Sendable { case leading, center, trailing }
public enum ControlSize: Hashable, Sendable { case mini, small, regular, large, extraLarge }
public enum Visibility: Hashable, Sendable { case automatic, visible, hidden }
public enum RoundedCornerStyle: Hashable, Sendable { case circular, continuous }
public enum BlendMode: Hashable, Sendable {
    case normal, multiply, screen, overlay, darken, lighten, colorDodge, colorBurn, softLight, hardLight, difference, exclusion, hue, saturation, color, luminosity, sourceAtop, destinationOver, destinationOut, plusDarker, plusLighter
    var css: String {
        switch self {
        case .multiply: return "multiply"
        case .screen: return "screen"
        case .overlay: return "overlay"
        case .darken: return "darken"
        case .lighten: return "lighten"
        case .softLight: return "soft-light"
        case .hardLight: return "hard-light"
        case .plusLighter: return "plus-lighter"
        case .difference: return "difference"
        default: return "normal"
        }
    }
    var canvas: String {
        switch self {
        case .plusLighter: return "lighter"
        case .normal: return "source-over"
        case .sourceAtop: return "source-atop"
        case .destinationOver: return "destination-over"
        case .destinationOut: return "destination-out"
        default: return css
        }
    }
}

// MARK: Schrift

public struct Font: Hashable, Sendable {
    var size: CGFloat?
    var weight: Weight?
    var design: Design?
    var isItalic = false
    var monoDigit = false
    var isSmallCaps = false
    var family: String?
    var lineHeight: CGFloat?

    public struct Weight: Hashable, Sendable {
        let v: Int
        public static let ultraLight = Weight(v: 100)
        public static let thin = Weight(v: 200)
        public static let light = Weight(v: 300)
        public static let regular = Weight(v: 400)
        public static let medium = Weight(v: 500)
        public static let semibold = Weight(v: 600)
        public static let bold = Weight(v: 700)
        public static let heavy = Weight(v: 800)
        public static let black = Weight(v: 900)
    }

    public enum Design: Hashable, Sendable { case `default`, serif, rounded, monospaced }
    public enum Leading: Hashable, Sendable { case standard, tight, loose }
    public enum Width: Hashable, Sendable { case standard, compressed, condensed, expanded }

    public enum TextStyle: Hashable, CaseIterable, Sendable {
        case largeTitle, title, title2, title3, headline, subheadline, body, callout, footnote, caption, caption2
        var metrics: (CGFloat, Weight, CGFloat) {
            switch self {
            case .largeTitle: return (34, .regular, 41)
            case .title: return (28, .regular, 34)
            case .title2: return (22, .regular, 28)
            case .title3: return (20, .regular, 25)
            case .headline: return (17, .semibold, 22)
            case .subheadline: return (15, .regular, 20)
            case .body: return (17, .regular, 22)
            case .callout: return (16, .regular, 21)
            case .footnote: return (13, .regular, 18)
            case .caption: return (12, .regular, 16)
            case .caption2: return (11, .regular, 13)
            }
        }
    }

    public static func system(size: CGFloat, weight: Weight? = nil, design: Design? = nil) -> Font { Font(size: size, weight: weight, design: design) }
    public static func system(_ style: TextStyle, design: Design? = nil, weight: Weight? = nil) -> Font {
        let m = style.metrics
        return Font(size: m.0, weight: weight ?? m.1, design: design, lineHeight: m.2)
    }
    public static func custom(_ name: String, size: CGFloat) -> Font { Font(size: size, family: name) }
    public static func custom(_ name: String, size: CGFloat, relativeTo: TextStyle) -> Font { Font(size: size, family: name) }
    public static func custom(_ name: String, fixedSize: CGFloat) -> Font { Font(size: fixedSize, family: name) }

    public static let largeTitle = system(.largeTitle)
    public static let title = system(.title)
    public static let title2 = system(.title2)
    public static let title3 = system(.title3)
    public static let headline = system(.headline)
    public static let subheadline = system(.subheadline)
    public static let body = system(.body)
    public static let callout = system(.callout)
    public static let footnote = system(.footnote)
    public static let caption = system(.caption)
    public static let caption2 = system(.caption2)

    public func weight(_ w: Weight) -> Font { var f = self; f.weight = w; return f }
    public func bold() -> Font { weight(.bold) }
    public func italic() -> Font { var f = self; f.isItalic = true; return f }
    public func monospacedDigit() -> Font { var f = self; f.monoDigit = true; return f }
    public func monospaced() -> Font { var f = self; f.design = .monospaced; return f }
    public func smallCaps() -> Font { var f = self; f.isSmallCaps = true; return f }
    public func leading(_ l: Leading) -> Font { self }
    public func width(_ w: Width) -> Font { self }

    var css: [(String, String)] {
        var out: [(String, String)] = []
        if let size {
            out.append(("font-size", _px(size)))
            // Zeilenhöhe der Systemschrift von iOS
            let lh = lineHeight ?? (size * 1.19 + 1.5).rounded()
            out.append(("line-height", _px(lh)))
            out.append(("letter-spacing", _tracking(size)))
        }
        if let weight { out.append(("font-weight", "\(weight.v)")) }
        if let family { out.append(("font-family", "'\(family)', var(--font)")) }
        else if let design {
            switch design {
            case .rounded: out.append(("font-family", "var(--font-rounded)"))
            case .serif: out.append(("font-family", "var(--font-serif)"))
            case .monospaced: out.append(("font-family", "var(--font-mono)"))
            case .default: out.append(("font-family", "var(--font)"))
            }
        }
        if isItalic { out.append(("font-style", "italic")) }
        if monoDigit { out.append(("font-variant-numeric", "tabular-nums")) }
        if isSmallCaps { out.append(("font-variant-caps", "small-caps")) }
        return out
    }
}

/** Laufweite von San Francisco je nach Größe (kleine Schrift weiter, große enger) */
func _tracking(_ size: CGFloat) -> String {
    let s = Double(size)
    let em: Double
    if s <= 11 { em = 0.006 } else if s <= 13 { em = -0.003 } else if s <= 17 { em = -0.022 + (17 - s) * 0.004 } else if s <= 22 { em = -0.022 + (s - 17) * 0.001 } else { em = 0.012 }
    return "\(_num((em * 1000).rounded() / 1000))em"
}

// MARK: Animation

public struct Animation: Hashable, Sendable {
    var duration = 0.35
    var delayBy = 0.0
    var curve = "ease-in-out"
    var repeatN = 1          // -1: endlos
    var reverses = false

    public static let `default` = Animation()
    public static let linear = Animation(curve: "linear")
    public static let easeIn = Animation(curve: "ease-in")
    public static let easeOut = Animation(curve: "ease-out")
    public static let easeInOut = Animation(curve: "ease-in-out")
    public static let spring = Animation.spring(response: 0.5, dampingFraction: 0.825, blendDuration: 0)
    public static let bouncy = Animation.spring(response: 0.5, dampingFraction: 0.7)
    public static let smooth = Animation.spring(response: 0.5, dampingFraction: 1)
    public static let snappy = Animation.spring(response: 0.4, dampingFraction: 0.85)
    public static let interactiveSpring = Animation.spring(response: 0.15, dampingFraction: 0.86)

    public static func linear(duration: Double) -> Animation { Animation(duration: duration, curve: "linear") }
    public static func easeIn(duration: Double) -> Animation { Animation(duration: duration, curve: "ease-in") }
    public static func easeOut(duration: Double) -> Animation { Animation(duration: duration, curve: "ease-out") }
    public static func easeInOut(duration: Double) -> Animation { Animation(duration: duration, curve: "ease-in-out") }
    public static func timingCurve(_ a: Double, _ b: Double, _ c: Double, _ d: Double, duration: Double = 0.35) -> Animation {
        Animation(duration: duration, curve: "cubic-bezier(\(_num(a)),\(_num(b)),\(_num(c)),\(_num(d)))")
    }
    public static func spring(response: Double = 0.5, dampingFraction: Double = 0.825, blendDuration: Double = 0) -> Animation {
        // gedämpfte Feder als Kurve mit etwas Überschwingen
        let over = max(0, 1 - dampingFraction) * 1.6
        return Animation(duration: response * 1.6, curve: "cubic-bezier(0.25,\(_num(1 + over * 0.6)),0.35,\(_num(1 + over * 0.15)))")
    }
    public static func spring(duration: Double = 0.5, bounce: Double = 0, blendDuration: Double = 0) -> Animation {
        spring(response: duration, dampingFraction: 1 - bounce, blendDuration: 0)
    }
    public static func interactiveSpring(response: Double = 0.15, dampingFraction: Double = 0.86, blendDuration: Double = 0.25) -> Animation {
        spring(response: response, dampingFraction: dampingFraction)
    }
    public static func interpolatingSpring(stiffness: Double, damping: Double, initialVelocity: Double = 0) -> Animation { spring(response: 0.5, dampingFraction: 0.825, blendDuration: 0) }
    public static func bouncy(duration: Double = 0.5, extraBounce: Double = 0) -> Animation { spring(response: duration, dampingFraction: 0.7 - extraBounce) }
    public static func smooth(duration: Double = 0.5, extraBounce: Double = 0) -> Animation { spring(response: duration, dampingFraction: 1) }
    public static func snappy(duration: Double = 0.5, extraBounce: Double = 0) -> Animation { spring(response: duration, dampingFraction: 0.85) }

    public func delay(_ d: Double) -> Animation { var a = self; a.delayBy += d; return a }
    public func speed(_ s: Double) -> Animation { var a = self; a.duration /= max(s, 0.01); return a }
    public func repeatForever(autoreverses: Bool = true) -> Animation { var a = self; a.repeatN = -1; a.reverses = autoreverses; return a }
    public func repeatCount(_ n: Int, autoreverses: Bool = true) -> Animation { var a = self; a.repeatN = n; a.reverses = autoreverses; return a }

    var _json: _J {
        var o: [String: _J] = ["d": .n(duration), "e": .s(curve)]
        if delayBy > 0 { o["dl"] = .n(delayBy) }
        if repeatN != 1 { o["rp"] = .n(Double(repeatN)); o["ar"] = .b(reverses) }
        return .o(o)
    }
    var _once: Animation { var a = self; a.repeatN = 1; a.delayBy = 0; return a }
}

public func withAnimation<R>(_ animation: Animation? = .default, _ body: () throws -> R) rethrows -> R {
    let prev = MainActor.assumeIsolated { () -> Animation? in
        let p = _R.txAnim
        _R.txAnim = animation
        return p
    }
    defer { MainActor.assumeIsolated { _R.txAnim = prev } }
    return try body()
}

public func withAnimation<R>(_ animation: Animation? = .default, completionCriteria: AnimationCompletionCriteria = .logicallyComplete, _ body: () throws -> R, completion: @escaping () -> Void) rethrows -> R {
    let r = try withAnimation(animation, body)
    DispatchQueue.main.asyncAfter(deadline: .now() + (animation?.duration ?? 0)) { completion() }
    return r
}

public enum AnimationCompletionCriteria: Sendable { case logicallyComplete, removed }

public struct Transaction {
    public var animation: Animation?
    public var disablesAnimations = false
    nonisolated public init() {}
    nonisolated public init(animation: Animation?) { self.animation = animation }
}

public func withTransaction<R>(_ t: Transaction, _ body: () throws -> R) rethrows -> R { try withAnimation(t.animation, body) }

public struct AnyTransition: Sendable {
    let css: String
    public static let opacity = AnyTransition(css: "opacity")
    public static let identity = AnyTransition(css: "")
    public static let slide = AnyTransition(css: "move-leading")
    public static let scale = AnyTransition(css: "scale")
    public static func scale(scale: CGFloat, anchor: UnitPoint = .center) -> AnyTransition { AnyTransition(css: "scale") }
    public static func move(edge: Edge) -> AnyTransition { AnyTransition(css: "move-\(edge)") }
    public static func push(from edge: Edge) -> AnyTransition { AnyTransition(css: "move-\(edge)") }
    public static func offset(x: CGFloat = 0, y: CGFloat = 0) -> AnyTransition { AnyTransition(css: "opacity") }
    public static func asymmetric(insertion: AnyTransition, removal: AnyTransition) -> AnyTransition { insertion }
    public static func modifier<E: ViewModifier>(active: E, identity: E) -> AnyTransition { AnyTransition(css: "opacity") }
    public func combined(with other: AnyTransition) -> AnyTransition { AnyTransition(css: css + " " + other.css) }
    public func animation(_ a: Animation?) -> AnyTransition { self }
}
