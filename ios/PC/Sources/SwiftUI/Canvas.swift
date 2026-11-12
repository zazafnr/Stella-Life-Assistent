// Canvas: die Zeichenbefehle werden aufgezeichnet und im Fenster auf ein <canvas> gemalt

public struct GraphicsContext {
    final class Recorder { var cmds: [_J] = [] }
    let rec: Recorder
    var ctm = CGAffineTransform.identity
    public var opacity: Double = 1
    public var blendMode: BlendMode = .normal
    public var environment: EnvironmentValues { MainActor.assumeIsolated { _R.env } }

    init(rec: Recorder) { self.rec = rec }

    public enum Shading {
        case _paint(_Paint)
        case _linear(Gradient, CGPoint, CGPoint)
        case _radial(Gradient, CGPoint, CGFloat, CGFloat)
        public static func color(_ c: Color) -> Shading { ._paint(.color(c)) }
        public static func color(_ space: Color.RGBColorSpace = .sRGB, red: Double, green: Double, blue: Double, opacity: Double = 1) -> Shading { .color(Color(space, red: red, green: green, blue: blue, opacity: opacity)) }
        public static func style<S: ShapeStyle>(_ s: S) -> Shading { ._paint(s._paint()) }
        public static func linearGradient(_ g: Gradient, startPoint: CGPoint, endPoint: CGPoint, options: GradientOptions = []) -> Shading { ._linear(g, startPoint, endPoint) }
        public static func radialGradient(_ g: Gradient, center: CGPoint, startRadius: CGFloat, endRadius: CGFloat, options: GradientOptions = []) -> Shading { ._radial(g, center, startRadius, endRadius) }
        public static var foreground: Shading { ._paint(.foreground(1)) }
    }

    public struct GradientOptions: OptionSet, Sendable {
        public let rawValue: UInt32
        nonisolated public init(rawValue: UInt32) { self.rawValue = rawValue }
        public static let `repeat` = GradientOptions(rawValue: 1), mirror = GradientOptions(rawValue: 2), linearColor = GradientOptions(rawValue: 4)
    }

    public struct Filter {
        let css: String
        public static func blur(radius: CGFloat, options: BlurOptions = []) -> Filter { Filter(css: "blur(\(_px(radius)))") }
        public static func shadow(color: Color = .black, radius: CGFloat, x: CGFloat = 0, y: CGFloat = 0, blendMode: BlendMode = .normal, options: ShadowOptions = []) -> Filter {
            Filter(css: "drop-shadow(\(_px(x)) \(_px(y)) \(_px(radius)) \(color.css))")
        }
        public static func brightness(_ a: Double) -> Filter { Filter(css: "brightness(\(_num(1 + a)))") }
        public static func saturation(_ a: Double) -> Filter { Filter(css: "saturate(\(_num(a)))") }
        public static func opacity(_ a: Double) -> Filter { Filter(css: "opacity(\(_num(a)))") }
    }
    public struct BlurOptions: OptionSet, Sendable { public let rawValue: UInt32; public init(rawValue: UInt32) { self.rawValue = rawValue }; public static let opaque = BlurOptions(rawValue: 1), dithersResult = BlurOptions(rawValue: 2) }
    public struct ShadowOptions: OptionSet, Sendable { public let rawValue: UInt32; public init(rawValue: UInt32) { self.rawValue = rawValue }; public static let shadowAbove = ShadowOptions(rawValue: 1), shadowOnly = ShadowOptions(rawValue: 2) }

    var filter = ""

    func paint(_ s: Shading) -> _J {
        switch s {
        case ._paint(let p): return p.json
        case ._linear(let g, let a, let b):
            let p = a.applying(ctm), q = b.applying(ctm)
            return .o(["k": "L", "st": g.json, "a": .a([.n(p.x), .n(p.y), .n(q.x), .n(q.y)])])
        case ._radial(let g, let c, let r0, let r1):
            let p = c.applying(ctm)
            return .o(["k": "R", "st": g.json, "a": .a([.n(p.x), .n(p.y), .n(r0), .n(r1)])])
        }
    }

    func emit(_ kind: String, _ path: Path, _ s: Shading, _ extra: [String: _J] = [:]) {
        var o: [String: _J] = ["k": .s(kind), "d": .s(path.applying(ctm).d), "p": paint(s)]
        if opacity < 1 { o["a"] = .n(max(0, opacity)) }
        if blendMode != .normal { o["b"] = .s(blendMode.canvas) }
        if !filter.isEmpty { o["fl"] = .s(filter) }
        for (k, v) in extra { o[k] = v }
        rec.cmds.append(.o(o))
    }

    public func fill(_ path: Path, with s: Shading, style: FillStyle = FillStyle()) { emit("f", path, s) }
    public func stroke(_ path: Path, with s: Shading, lineWidth: CGFloat = 1) { emit("s", path, s, ["lw": .n(lineWidth)]) }
    public func stroke(_ path: Path, with s: Shading, style: StrokeStyle) { emit("s", path, s, style.json) }

    public mutating func translateBy(x: CGFloat, y: CGFloat) { ctm = CGAffineTransform(translationX: x, y: y).concatenating(ctm) }
    public mutating func scaleBy(x: CGFloat, y: CGFloat) { ctm = CGAffineTransform(scaleX: x, y: y).concatenating(ctm) }
    public mutating func rotate(by a: Angle) { ctm = CGAffineTransform(rotationAngle: CGFloat(a.radians)).concatenating(ctm) }
    public mutating func concatenate(_ t: CGAffineTransform) { ctm = t.concatenating(ctm) }
    public var transform: CGAffineTransform { get { ctm } set { ctm = newValue } }
    public mutating func addFilter(_ f: Filter, options: FilterOptions = FilterOptions()) { filter += (filter.isEmpty ? "" : " ") + f.css }
    public struct FilterOptions: OptionSet, Sendable { public let rawValue: UInt32; public init(rawValue: UInt32 = 0) { self.rawValue = rawValue } }
    public mutating func clip(to path: Path, style: FillStyle = FillStyle(), options: ClipOptions = ClipOptions()) {}
    public struct ClipOptions: OptionSet, Sendable { public let rawValue: UInt32; public init(rawValue: UInt32 = 0) { self.rawValue = rawValue }; public static let inverse = ClipOptions(rawValue: 1) }
    public var clipBoundingRect: CGRect { .infinite }

    public func drawLayer(content: (inout GraphicsContext) throws -> Void) rethrows {
        var c = self
        try content(&c)
    }

    public struct ResolvedText { let t: Text; public func measure(in size: CGSize) -> CGSize { CGSize(width: CGFloat(t.plain.count) * 8, height: 17) } }
    public func resolve(_ t: Text) -> ResolvedText { ResolvedText(t: t) }
    public func draw(_ t: ResolvedText, at p: CGPoint, anchor: UnitPoint = .center) { draw(t.t, at: p, anchor: anchor) }
    public func draw(_ t: Text, at p: CGPoint, anchor: UnitPoint = .center) {
        let q = p.applying(ctm)
        let r = t.runs.first
        rec.cmds.append(.o(["k": "t", "s": .s(t.plain), "x": .n(q.x), "y": .n(q.y), "ax": .n(anchor.x), "ay": .n(anchor.y),
                            "c": .s(r?.css["color"] ?? "#000"), "f": .s("\(r?.css["font-weight"] ?? "400") \(r?.css["font-size"] ?? "17px") var(--font)"), "a": .n(opacity)]))
    }
    public func draw(_ i: Image, in rect: CGRect) {}
    public func draw(_ i: Image, at p: CGPoint, anchor: UnitPoint = .center) {}
}

public struct Canvas<Symbols: View>: View, _Primitive {
    public typealias Body = Never
    let renderer: (inout GraphicsContext, CGSize) -> Void

    public func _render() -> [_Node] {
        let n = _Node("canvas")
        n.gw = true; n.gh = true
        let size = _knownSize(n)
        if size.width > 0, size.height > 0 {
            var ctx = GraphicsContext(rec: .init())
            renderer(&ctx, size)
            n.p["w"] = .n(size.width); n.p["h"] = .n(size.height)
            n.p["cmd"] = .a(ctx.rec.cmds)
        }
        return [n]
    }
}

extension Canvas where Symbols == EmptyView {
    nonisolated public init(opaque: Bool = false, colorMode: ColorRenderingMode = .nonLinear, rendersAsynchronously: Bool = false, renderer: @escaping (inout GraphicsContext, CGSize) -> Void) {
        self.renderer = renderer
    }
}

public enum ColorRenderingMode: Sendable { case nonLinear, linear, extendedLinear }
