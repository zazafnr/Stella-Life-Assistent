// Pfade und Formen

public struct StrokeStyle: Equatable, Sendable {
    public var lineWidth: CGFloat
    public var lineCap: CGLineCap
    public var lineJoin: CGLineJoin
    public var miterLimit: CGFloat
    public var dash: [CGFloat]
    public var dashPhase: CGFloat
    nonisolated public init(lineWidth: CGFloat = 1, lineCap: CGLineCap = .butt, lineJoin: CGLineJoin = .miter, miterLimit: CGFloat = 10, dash: [CGFloat] = [], dashPhase: CGFloat = 0) {
        self.lineWidth = lineWidth; self.lineCap = lineCap; self.lineJoin = lineJoin; self.miterLimit = miterLimit; self.dash = dash; self.dashPhase = dashPhase
    }
    var json: [String: _J] {
        var o: [String: _J] = ["lw": .n(lineWidth)]
        if lineCap != .butt { o["cap"] = .s(lineCap == .round ? "round" : "square") }
        if lineJoin != .miter { o["join"] = .s(lineJoin == .round ? "round" : "bevel") }
        if !dash.isEmpty { o["dash"] = .a(dash.map { .n($0) }) }
        return o
    }
}

public enum CGLineCap: Int32, Sendable { case butt, round, square }
public enum CGLineJoin: Int32, Sendable { case miter, round, bevel }

public struct Path: Equatable, Sendable {
    enum El: Equatable, Sendable {
        case move(CGPoint), line(CGPoint), quad(CGPoint, CGPoint), curve(CGPoint, CGPoint, CGPoint), close
    }
    var els: [El] = []
    var start = CGPoint.zero

    nonisolated public init() {}
    nonisolated public init(_ rect: CGRect) { addRect(rect) }
    nonisolated public init(roundedRect: CGRect, cornerRadius: CGFloat, style: RoundedCornerStyle = .circular) { addRoundedRect(in: roundedRect, cornerSize: CGSize(width: cornerRadius, height: cornerRadius)) }
    nonisolated public init(roundedRect: CGRect, cornerSize: CGSize, style: RoundedCornerStyle = .circular) { addRoundedRect(in: roundedRect, cornerSize: cornerSize) }
    nonisolated public init(ellipseIn rect: CGRect) { addEllipse(in: rect) }
    nonisolated public init(roundedRect r: CGRect, cornerRadii c: RectangleCornerRadii, style: RoundedCornerStyle = .continuous) {
        let k: CGFloat = 0.5523
        func cl(_ v: CGFloat) -> CGFloat { min(v, r.width / 2, r.height / 2) }
        let tl = cl(c.topLeading), tr = cl(c.topTrailing), br = cl(c.bottomTrailing), bl = cl(c.bottomLeading)
        move(to: CGPoint(x: r.minX + tl, y: r.minY))
        addLine(to: CGPoint(x: r.maxX - tr, y: r.minY))
        addCurve(to: CGPoint(x: r.maxX, y: r.minY + tr), control1: CGPoint(x: r.maxX - tr + tr * k, y: r.minY), control2: CGPoint(x: r.maxX, y: r.minY + tr - tr * k))
        addLine(to: CGPoint(x: r.maxX, y: r.maxY - br))
        addCurve(to: CGPoint(x: r.maxX - br, y: r.maxY), control1: CGPoint(x: r.maxX, y: r.maxY - br + br * k), control2: CGPoint(x: r.maxX - br + br * k, y: r.maxY))
        addLine(to: CGPoint(x: r.minX + bl, y: r.maxY))
        addCurve(to: CGPoint(x: r.minX, y: r.maxY - bl), control1: CGPoint(x: r.minX + bl - bl * k, y: r.maxY), control2: CGPoint(x: r.minX, y: r.maxY - bl + bl * k))
        addLine(to: CGPoint(x: r.minX, y: r.minY + tl))
        addCurve(to: CGPoint(x: r.minX + tl, y: r.minY), control1: CGPoint(x: r.minX, y: r.minY + tl - tl * k), control2: CGPoint(x: r.minX + tl - tl * k, y: r.minY))
        closeSubpath()
    }
    nonisolated public init(_ build: (inout Path) -> Void) { build(&self) }

    public var isEmpty: Bool { els.isEmpty }
    public var currentPoint: CGPoint? {
        for e in els.reversed() {
            switch e {
            case .move(let p), .line(let p), .quad(let p, _), .curve(let p, _, _): return p
            case .close: return start
            }
        }
        return nil
    }

    public mutating func move(to p: CGPoint) { els.append(.move(p)); start = p }
    public mutating func addLine(to p: CGPoint) { if els.isEmpty { move(to: p) } else { els.append(.line(p)) } }
    public mutating func addQuadCurve(to p: CGPoint, control: CGPoint) { els.append(.quad(p, control)) }
    public mutating func addCurve(to p: CGPoint, control1: CGPoint, control2: CGPoint) { els.append(.curve(p, control1, control2)) }
    public mutating func closeSubpath() { els.append(.close) }
    public mutating func addLines(_ pts: [CGPoint]) {
        guard let f = pts.first else { return }
        move(to: f)
        for p in pts.dropFirst() { addLine(to: p) }
    }
    public mutating func addRect(_ r: CGRect, transform: CGAffineTransform = .identity) {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY)); p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY)); p.addLine(to: CGPoint(x: r.minX, y: r.maxY)); p.closeSubpath()
        addPath(p, transform: transform)
    }
    public mutating func addRects(_ rs: [CGRect]) { for r in rs { addRect(r) } }
    public mutating func addRoundedRect(in r: CGRect, cornerSize: CGSize, style: RoundedCornerStyle = .circular, transform: CGAffineTransform = .identity) {
        let rx = min(cornerSize.width, r.width / 2), ry = min(cornerSize.height, r.height / 2)
        if rx <= 0 || ry <= 0 { addRect(r, transform: transform); return }
        let k: CGFloat = 0.5523
        var p = Path()
        p.move(to: CGPoint(x: r.minX + rx, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - rx, y: r.minY))
        p.addCurve(to: CGPoint(x: r.maxX, y: r.minY + ry), control1: CGPoint(x: r.maxX - rx + rx * k, y: r.minY), control2: CGPoint(x: r.maxX, y: r.minY + ry - ry * k))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - ry))
        p.addCurve(to: CGPoint(x: r.maxX - rx, y: r.maxY), control1: CGPoint(x: r.maxX, y: r.maxY - ry + ry * k), control2: CGPoint(x: r.maxX - rx + rx * k, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX + rx, y: r.maxY))
        p.addCurve(to: CGPoint(x: r.minX, y: r.maxY - ry), control1: CGPoint(x: r.minX + rx - rx * k, y: r.maxY), control2: CGPoint(x: r.minX, y: r.maxY - ry + ry * k))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + ry))
        p.addCurve(to: CGPoint(x: r.minX + rx, y: r.minY), control1: CGPoint(x: r.minX, y: r.minY + ry - ry * k), control2: CGPoint(x: r.minX + rx - rx * k, y: r.minY))
        p.closeSubpath()
        addPath(p, transform: transform)
    }
    public mutating func addEllipse(in r: CGRect, transform: CGAffineTransform = .identity) {
        let k: CGFloat = 0.5523, rx = r.width / 2, ry = r.height / 2, cx = r.midX, cy = r.midY
        var p = Path()
        p.move(to: CGPoint(x: cx + rx, y: cy))
        p.addCurve(to: CGPoint(x: cx, y: cy + ry), control1: CGPoint(x: cx + rx, y: cy + ry * k), control2: CGPoint(x: cx + rx * k, y: cy + ry))
        p.addCurve(to: CGPoint(x: cx - rx, y: cy), control1: CGPoint(x: cx - rx * k, y: cy + ry), control2: CGPoint(x: cx - rx, y: cy + ry * k))
        p.addCurve(to: CGPoint(x: cx, y: cy - ry), control1: CGPoint(x: cx - rx, y: cy - ry * k), control2: CGPoint(x: cx - rx * k, y: cy - ry))
        p.addCurve(to: CGPoint(x: cx + rx, y: cy), control1: CGPoint(x: cx + rx * k, y: cy - ry), control2: CGPoint(x: cx + rx, y: cy - ry * k))
        p.closeSubpath()
        addPath(p, transform: transform)
    }
    /** Winkel wachsen auf dem Bildschirm im Uhrzeigersinn; `clockwise: false` läuft in diese Richtung */
    public mutating func addArc(center: CGPoint, radius: CGFloat, startAngle: Angle, endAngle: Angle, clockwise: Bool, transform: CGAffineTransform = .identity) {
        var a0 = startAngle.radians, a1 = endAngle.radians
        if clockwise { while a1 > a0 { a1 -= 2 * .pi } } else { while a1 < a0 { a1 += 2 * .pi } }
        if abs(endAngle.radians - startAngle.radians) >= 2 * .pi - 1e-9 { a1 = a0 + (clockwise ? -2 : 2) * .pi }
        let n = max(1, Int(ceil(abs(a1 - a0) / (.pi / 2) - 1e-9)))
        let step = (a1 - a0) / Double(n)
        func pt(_ a: Double) -> CGPoint { CGPoint(x: center.x + radius * CGFloat(cos(a)), y: center.y + radius * CGFloat(sin(a))).applying(transform) }
        let first = pt(a0)
        if els.isEmpty { move(to: first) } else { els.append(.line(first)) }
        let k = 4.0 / 3.0 * tan(step / 4)
        for i in 0..<n {
            let s = a0 + step * Double(i), e = s + step
            let c1 = CGPoint(x: center.x + radius * CGFloat(cos(s) - k * sin(s)), y: center.y + radius * CGFloat(sin(s) + k * cos(s))).applying(transform)
            let c2 = CGPoint(x: center.x + radius * CGFloat(cos(e) + k * sin(e)), y: center.y + radius * CGFloat(sin(e) - k * cos(e))).applying(transform)
            els.append(.curve(pt(e), c1, c2))
            a0 = a0 + 0
        }
    }
    public mutating func addRelativeArc(center: CGPoint, radius: CGFloat, startAngle: Angle, delta: Angle, transform: CGAffineTransform = .identity) {
        addArc(center: center, radius: radius, startAngle: startAngle, endAngle: startAngle + delta, clockwise: delta.radians < 0, transform: transform)
    }
    public mutating func addPath(_ p: Path, transform t: CGAffineTransform = .identity) {
        if t.isIdentity { els += p.els; if let last = p.els.last, case .close = last {} ; start = p.start; return }
        els += p.applying(t).els
        start = p.start.applying(t)
    }

    public func applying(_ t: CGAffineTransform) -> Path {
        var out = Path()
        out.start = start.applying(t)
        out.els = els.map {
            switch $0 {
            case .move(let p): return .move(p.applying(t))
            case .line(let p): return .line(p.applying(t))
            case .quad(let p, let c): return .quad(p.applying(t), c.applying(t))
            case .curve(let p, let c1, let c2): return .curve(p.applying(t), c1.applying(t), c2.applying(t))
            case .close: return .close
            }
        }
        return out
    }
    public func offsetBy(dx: CGFloat, dy: CGFloat) -> Path { applying(CGAffineTransform(translationX: dx, y: dy)) }
    public func trimmedPath(from: CGFloat, to: CGFloat) -> Path { self }
    public func strokedPath(_ s: StrokeStyle) -> Path { self }

    public var boundingRect: CGRect {
        var minX = CGFloat.infinity, minY = CGFloat.infinity, maxX = -CGFloat.infinity, maxY = -CGFloat.infinity
        func add(_ p: CGPoint) { minX = min(minX, p.x); minY = min(minY, p.y); maxX = max(maxX, p.x); maxY = max(maxY, p.y) }
        for e in els {
            switch e {
            case .move(let p), .line(let p): add(p)
            case .quad(let p, let c): add(p); add(c)
            case .curve(let p, let c1, let c2): add(p); add(c1); add(c2)
            case .close: break
            }
        }
        if minX == .infinity { return .zero }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    public func contains(_ p: CGPoint, eoFill: Bool = false) -> Bool { boundingRect.contains(p) }

    /** SVG-Pfad */
    var d: String {
        var s = ""
        s.reserveCapacity(els.count * 16)
        func f(_ v: CGFloat) -> String {
            let d = Double(v)
            if d.isNaN || d.isInfinite { return "0" }
            let r = (d * 100).rounded() / 100
            return r == r.rounded() ? "\(Int(r))" : "\(r)"
        }
        for e in els {
            switch e {
            case .move(let p): s += "M\(f(p.x)) \(f(p.y))"
            case .line(let p): s += "L\(f(p.x)) \(f(p.y))"
            case .quad(let p, let c): s += "Q\(f(c.x)) \(f(c.y)) \(f(p.x)) \(f(p.y))"
            case .curve(let p, let c1, let c2): s += "C\(f(c1.x)) \(f(c1.y)) \(f(c2.x)) \(f(c2.y)) \(f(p.x)) \(f(p.y))"
            case .close: s += "Z"
            }
        }
        return s
    }
}

// MARK: Shape

public protocol Shape: View {
    func path(in rect: CGRect) -> Path
}

public protocol InsettableShape: Shape {
    associatedtype InsetShape: InsettableShape
    func inset(by amount: CGFloat) -> InsetShape
}

/** Formen, die CSS direkt kann (Rechteck mit runden Ecken, Kapsel, Kreis, Ellipse) */
protocol _BoxShape {
    var _radius: String { get }
    var _circle: Bool { get }
    var _inset: CGFloat { get }
}

extension Shape {
    public var body: some View { _ShapeView(shape: self, fill: .foreground(1)) }

    public func fill<S: ShapeStyle>(_ style: S, style fs: FillStyle = FillStyle()) -> some View { _ShapeView(shape: self, fill: style._paint()) }
    public func fill(style fs: FillStyle = FillStyle()) -> some View { _ShapeView(shape: self, fill: .foreground(1)) }
    public func stroke<S: ShapeStyle>(_ style: S, lineWidth: CGFloat = 1, antialiased: Bool = true) -> some View {
        _ShapeView(shape: self, fill: nil, stroke: style._paint(), style: StrokeStyle(lineWidth: lineWidth))
    }
    public func stroke<S: ShapeStyle>(_ style: S, style ss: StrokeStyle, antialiased: Bool = true) -> some View {
        _ShapeView(shape: self, fill: nil, stroke: style._paint(), style: ss)
    }
    public func stroke(lineWidth: CGFloat = 1) -> some View {
        _ShapeView(shape: self, fill: nil, stroke: .foreground(1), style: StrokeStyle(lineWidth: lineWidth))
    }
    public func stroke(style ss: StrokeStyle) -> some View {
        _ShapeView(shape: self, fill: nil, stroke: .foreground(1), style: ss)
    }
    public func trim(from: CGFloat = 0, to: CGFloat = 1) -> _Trimmed<Self> { _Trimmed(base: self, from: from, to: to) }
    public func rotation(_ a: Angle, anchor: UnitPoint = .center) -> _Transformed<Self> { _Transformed(base: self, make: { r in
        let c = CGPoint(x: r.minX + r.width * anchor.x, y: r.minY + r.height * anchor.y)
        return CGAffineTransform(translationX: c.x, y: c.y).rotated(by: CGFloat(a.radians)).translatedBy(x: -c.x, y: -c.y)
    }) }
    public func offset(x: CGFloat = 0, y: CGFloat = 0) -> _Transformed<Self> { _Transformed(base: self, make: { _ in CGAffineTransform(translationX: x, y: y) }) }
    public func scale(_ s: CGFloat, anchor: UnitPoint = .center) -> _Transformed<Self> { _Transformed(base: self, make: { r in
        let c = CGPoint(x: r.minX + r.width * anchor.x, y: r.minY + r.height * anchor.y)
        return CGAffineTransform(translationX: c.x, y: c.y).scaledBy(x: s, y: s).translatedBy(x: -c.x, y: -c.y)
    }) }
    public func size(_ s: CGSize) -> _Transformed<Self> { _Transformed(base: self, make: { _ in .identity }) }
}

extension InsettableShape {
    public func strokeBorder<S: ShapeStyle>(_ style: S, lineWidth: CGFloat = 1, antialiased: Bool = true) -> some View {
        _ShapeView(shape: inset(by: lineWidth / 2), fill: nil, stroke: style._paint(), style: StrokeStyle(lineWidth: lineWidth), inside: true)
    }
    public func strokeBorder<S: ShapeStyle>(_ style: S, style ss: StrokeStyle, antialiased: Bool = true) -> some View {
        _ShapeView(shape: inset(by: ss.lineWidth / 2), fill: nil, stroke: style._paint(), style: ss, inside: true)
    }
    public func strokeBorder(lineWidth: CGFloat = 1) -> some View {
        _ShapeView(shape: inset(by: lineWidth / 2), fill: nil, stroke: .foreground(1), style: StrokeStyle(lineWidth: lineWidth), inside: true)
    }
}

public struct FillStyle: Equatable, Sendable {
    public var isEOFilled: Bool
    public var isAntialiased: Bool
    nonisolated public init(eoFill: Bool = false, antialiased: Bool = true) { isEOFilled = eoFill; isAntialiased = antialiased }
}

public struct _Trimmed<S: Shape>: Shape {
    let base: S
    let from: CGFloat, to: CGFloat
    public func path(in rect: CGRect) -> Path { base.path(in: rect) }
}

public struct _Transformed<S: Shape>: Shape {
    let base: S
    let make: (CGRect) -> CGAffineTransform
    public func path(in rect: CGRect) -> Path { base.path(in: rect).applying(make(rect)) }
}

protocol _TrimInfo { var _trim: (CGFloat, CGFloat) { get } }
extension _Trimmed: _TrimInfo { var _trim: (CGFloat, CGFloat) { (from, to) } }

struct _ShapeView<S: Shape>: View, _Primitive {
    typealias Body = Never
    let shape: S
    var fill: _Paint?
    var stroke: _Paint?
    var style: StrokeStyle?
    var inside = false

    /** auch als ShapeStyle-Füllung mit zusätzlicher Linie: .fill(…).stroke(…) */
    func _render() -> [_Node] {
        if let box = shape as? _BoxShape {
            let n = _Node("shape")
            n.gw = true; n.gh = true
            if box._circle { n.p["circle"] = true } else { n.css.append(("border-radius", box._radius)) }
            if let fill { n.css.append(("background", fill.css)) }
            if let stroke, let style {
                let w = style.lineWidth
                if inside {
                    n.css.append(("box-shadow", "inset 0 0 0 \(_px(w)) \(stroke.flat)"))
                } else {
                    n.css.append(("outline", "\(_px(w)) \(style.dash.isEmpty ? "solid" : "dashed") \(stroke.flat)"))
                    n.css.append(("outline-offset", _px(-w / 2)))
                }
            }
            if box._inset != 0 { n.css.append(("margin", _px(box._inset))) }
            return [n]
        }
        let n = _Node("path")
        n.gw = true; n.gh = true
        var size = _R.env[_Env.proposal]
        if size == nil || size!.width == nil || size!.height == nil {
            let m = _R.measure()
            n.p["m"] = m.id
            if let s = m.size { size = _Proposal(width: s.width, height: s.height) }
        }
        if let w = size?.width, let h = size?.height, w > 0, h > 0 {
            n.p["d"] = .s(shape.path(in: CGRect(x: 0, y: 0, width: w, height: h)).d)
            n.p["w"] = .n(w); n.p["h"] = .n(h)
        }
        if let fill { n.p["fill"] = fill.json }
        if let stroke, let style {
            n.p["stroke"] = stroke.json
            for (k, v) in style.json { n.p[k] = v }
        }
        if let t = shape as? _TrimInfo { n.p["trim"] = .a([.n(t._trim.0), .n(t._trim.1)]) }
        return [n]
    }
}

struct _Proposal: Equatable { var width: CGFloat?; var height: CGFloat? }
extension _Env { static let proposal = _EnvName<_Proposal?>(nil) }

public struct Rectangle: InsettableShape, _BoxShape {
    var _inset: CGFloat = 0
    nonisolated public init() {}
    public func path(in rect: CGRect) -> Path { Path(rect.insetBy(dx: _inset, dy: _inset)) }
    public func inset(by amount: CGFloat) -> Rectangle { var c = self; c._inset += amount; return c }
    var _radius: String { "0" }
    var _circle: Bool { false }
}

public struct RoundedRectangle: InsettableShape, _BoxShape {
    public var cornerSize: CGSize
    public var style: RoundedCornerStyle
    var _inset: CGFloat = 0
    nonisolated public init(cornerRadius: CGFloat, style: RoundedCornerStyle = .continuous) { cornerSize = CGSize(width: cornerRadius, height: cornerRadius); self.style = style }
    nonisolated public init(cornerSize: CGSize, style: RoundedCornerStyle = .continuous) { self.cornerSize = cornerSize; self.style = style }
    public func path(in rect: CGRect) -> Path { Path(roundedRect: rect.insetBy(dx: _inset, dy: _inset), cornerSize: cornerSize) }
    public func inset(by amount: CGFloat) -> RoundedRectangle { var c = self; c._inset += amount; return c }
    var _radius: String { _px(max(0, cornerSize.width - _inset)) }
    var _circle: Bool { false }
}

public struct RectangleCornerRadii: Equatable, Sendable {
    public var topLeading: CGFloat, bottomLeading: CGFloat, bottomTrailing: CGFloat, topTrailing: CGFloat
    nonisolated public init(topLeading: CGFloat = 0, bottomLeading: CGFloat = 0, bottomTrailing: CGFloat = 0, topTrailing: CGFloat = 0) {
        self.topLeading = topLeading; self.bottomLeading = bottomLeading; self.bottomTrailing = bottomTrailing; self.topTrailing = topTrailing
    }
}

public struct UnevenRoundedRectangle: InsettableShape, _BoxShape {
    public var cornerRadii: RectangleCornerRadii
    var _inset: CGFloat = 0
    nonisolated public init(cornerRadii: RectangleCornerRadii, style: RoundedCornerStyle = .continuous) { self.cornerRadii = cornerRadii }
    nonisolated public init(topLeadingRadius: CGFloat = 0, bottomLeadingRadius: CGFloat = 0, bottomTrailingRadius: CGFloat = 0, topTrailingRadius: CGFloat = 0, style: RoundedCornerStyle = .continuous) {
        cornerRadii = RectangleCornerRadii(topLeading: topLeadingRadius, bottomLeading: bottomLeadingRadius, bottomTrailing: bottomTrailingRadius, topTrailing: topTrailingRadius)
    }
    public func path(in rect: CGRect) -> Path { Path(roundedRect: rect, cornerRadius: cornerRadii.topLeading) }
    public func inset(by amount: CGFloat) -> UnevenRoundedRectangle { var c = self; c._inset += amount; return c }
    var _radius: String { "\(_px(cornerRadii.topLeading)) \(_px(cornerRadii.topTrailing)) \(_px(cornerRadii.bottomTrailing)) \(_px(cornerRadii.bottomLeading))" }
    var _circle: Bool { false }
}

public struct Capsule: InsettableShape, _BoxShape {
    var _inset: CGFloat = 0
    nonisolated public init(style: RoundedCornerStyle = .continuous) {}
    public func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: _inset, dy: _inset)
        return Path(roundedRect: r, cornerRadius: min(r.width, r.height) / 2)
    }
    public func inset(by amount: CGFloat) -> Capsule { var c = self; c._inset += amount; return c }
    var _radius: String { "9999px" }
    var _circle: Bool { false }
}

public struct Circle: InsettableShape, _BoxShape {
    var _inset: CGFloat = 0
    nonisolated public init() {}
    public func path(in rect: CGRect) -> Path {
        let d = min(rect.width, rect.height) - _inset * 2
        return Path(ellipseIn: CGRect(x: rect.midX - d / 2, y: rect.midY - d / 2, width: d, height: d))
    }
    public func inset(by amount: CGFloat) -> Circle { var c = self; c._inset += amount; return c }
    var _radius: String { "50%" }
    var _circle: Bool { true }
}

public struct Ellipse: InsettableShape, _BoxShape {
    var _inset: CGFloat = 0
    nonisolated public init() {}
    public func path(in rect: CGRect) -> Path { Path(ellipseIn: rect.insetBy(dx: _inset, dy: _inset)) }
    public func inset(by amount: CGFloat) -> Ellipse { var c = self; c._inset += amount; return c }
    var _radius: String { "50%" }
    var _circle: Bool { false }
}

extension Path: Shape {
    public func path(in rect: CGRect) -> Path { self }
}

public struct AnyShape: Shape {
    let make: (CGRect) -> Path
    nonisolated public init<S: Shape>(_ s: S) { make = { s.path(in: $0) } }
    public func path(in rect: CGRect) -> Path { make(rect) }
}

extension Shape where Self == Rectangle { public static var rect: Rectangle { Rectangle() } }
extension Shape where Self == Circle { public static var circle: Circle { Circle() } }
extension Shape where Self == Capsule { public static var capsule: Capsule { Capsule() } }
extension Shape where Self == Ellipse { public static var ellipse: Ellipse { Ellipse() } }
extension Shape where Self == RoundedRectangle {
    public static func rect(cornerRadius: CGFloat, style: RoundedCornerStyle = .continuous) -> RoundedRectangle { RoundedRectangle(cornerRadius: cornerRadius, style: style) }
}
