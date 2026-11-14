// Charts: Balken und Linien werden gesammelt und im Fenster als SVG gezeichnet

public struct PlottableValue<V> {
    let label: String
    let value: V
    var unit: Calendar.Component?
    public static func value(_ label: String, _ v: V) -> PlottableValue<V> { PlottableValue(label: label, value: v) }
    public static func value(_ label: String, _ v: V, unit: Calendar.Component) -> PlottableValue<V> { PlottableValue(label: label, value: v, unit: unit) }
}

func _plot(_ v: Any) -> _J {
    switch v {
    case let d as Date: return .o(["date": .n(d.timeIntervalSince1970 * 1000)])
    case let i as Int: return .n(Double(i))
    case let d as Double: return .n(d)
    case let f as CGFloat: return .n(Double(f))
    case let f as Float: return .n(Double(f))
    case let s as String: return .s(s)
    default: return .s("\(v)")
    }
}

@MainActor public protocol ChartContent {
    func _marks(_ out: inout [_J])
}

public struct _Mark: ChartContent {
    var o: [String: _J]
    var annotation: (any View)?
    public func _marks(_ out: inout [_J]) {
        var m = o
        if let annotation {
            let nodes = _at(_hash(out.count)) { _renderAny(annotation) }
            var s = ""
            _Node("z", [:], nodes).write(&s)
            m["ann"] = _JSONReader.parse(s) ?? .null
        }
        out.append(.o(m))
    }
    public func foregroundStyle<S: ShapeStyle>(_ s: S) -> _Mark { var c = self; c.o["color"] = .s(s._paint().flat); return c }
    public func foregroundStyle<V>(by v: PlottableValue<V>) -> _Mark { var c = self; c.o["series"] = _plot(v.value); return c }
    public func clipShape<S: Shape>(_ s: S) -> _Mark {
        var c = self
        if let b = s as? _BoxShape { c.o["radius"] = .s(b._radius) }
        return c
    }
    public func cornerRadius(_ r: CGFloat) -> _Mark { var c = self; c.o["radius"] = .s(_px(r)); return c }
    public func lineStyle(_ s: StrokeStyle) -> _Mark { var c = self; for (k, v) in s.json { c.o[k] = v }; return c }
    public func opacity(_ a: Double) -> _Mark { var c = self; c.o["opacity"] = .n(a); return c }
    public func interpolationMethod(_ m: InterpolationMethod) -> _Mark { var c = self; c.o["curve"] = .s(m.k); return c }
    public func symbol<S>(_ s: S) -> _Mark { self }
    public func symbolSize(_ s: CGFloat) -> _Mark { self }
    public func annotation<V: View>(position: AnnotationPosition = .automatic, alignment: Alignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> V) -> _Mark {
        var c = self
        c.annotation = content()
        c.o["annPos"] = .s(position.k)
        c.o["annAlign"] = .s(alignment.horizontal.css)
        return c
    }
    public func position<V>(by v: PlottableValue<V>) -> _Mark { self }
    public func accessibilityLabel(_ s: String) -> _Mark { self }
}

public struct InterpolationMethod: Sendable {
    let k: String
    public static let linear = InterpolationMethod(k: "linear"), catmullRom = InterpolationMethod(k: "smooth"), monotone = InterpolationMethod(k: "smooth"), cardinal = InterpolationMethod(k: "smooth"), stepStart = InterpolationMethod(k: "step")
}

public struct AnnotationPosition: Sendable {
    let k: String
    public static let automatic = AnnotationPosition(k: "top"), top = AnnotationPosition(k: "top"), bottom = AnnotationPosition(k: "bottom"), overlay = AnnotationPosition(k: "overlay")
    public static let leading = AnnotationPosition(k: "top"), trailing = AnnotationPosition(k: "top"), topLeading = AnnotationPosition(k: "top"), topTrailing = AnnotationPosition(k: "top")
}

func _xy<X, Y>(_ kind: String, _ x: PlottableValue<X>, _ y: PlottableValue<Y>) -> _Mark {
    var o: [String: _J] = ["k": .s(kind), "x": _plot(x.value), "y": _plot(y.value)]
    if x.unit == .day { o["xunit"] = "day" }
    return _Mark(o: o)
}

public func BarMark<X, Y>(x: PlottableValue<X>, y: PlottableValue<Y>, width: Any? = nil, stacking: Any? = nil) -> _Mark { _xy("bar", x, y) }
public func LineMark<X, Y>(x: PlottableValue<X>, y: PlottableValue<Y>) -> _Mark { _xy("line", x, y) }
public func AreaMark<X, Y>(x: PlottableValue<X>, y: PlottableValue<Y>, stacking: Any? = nil) -> _Mark { _xy("area", x, y) }
public func PointMark<X, Y>(x: PlottableValue<X>, y: PlottableValue<Y>) -> _Mark { _xy("point", x, y) }
public func RuleMark<Y>(y: PlottableValue<Y>) -> _Mark { _Mark(o: ["k": "ruleY", "y": _plot(y.value)]) }
public func RuleMark<X>(x: PlottableValue<X>) -> _Mark { _Mark(o: ["k": "ruleX", "x": _plot(x.value)]) }
public func SectorMark<V>(angle: PlottableValue<V>, innerRadius: Any? = nil, angularInset: CGFloat = 0) -> _Mark { _Mark(o: ["k": "sector", "y": _plot(angle.value)]) }

public struct _ChartList: ChartContent {
    let parts: [any ChartContent]
    public func _marks(_ out: inout [_J]) { for p in parts { p._marks(&out) } }
}

extension ForEach: ChartContent where Content: ChartContent {
    nonisolated public init(_ data: Data, id: KeyPath<Data.Element, ID>, @ChartContentBuilder content: @escaping (Data.Element) -> Content) {
        self.data = data; self.idOf = { $0[keyPath: id] }; self.content = content
    }
    nonisolated public init(_ data: Data, @ChartContentBuilder content: @escaping (Data.Element) -> Content) where Data.Element: Identifiable, ID == Data.Element.ID {
        self.data = data; self.idOf = { $0.id }; self.content = content
    }
    public func _marks(_ out: inout [_J]) { for e in data { content(e)._marks(&out) } }
}

@MainActor @resultBuilder public struct ChartContentBuilder {
    public static func buildBlock<each C: ChartContent>(_ c: repeat each C) -> _ChartList {
        var list: [any ChartContent] = []
        repeat list.append(each c)
        return _ChartList(parts: list)
    }
    public static func buildExpression<C: ChartContent>(_ c: C) -> C { c }
    public static func buildIf<C: ChartContent>(_ c: C?) -> _ChartList { _ChartList(parts: c.map { [$0] } ?? []) }
    public static func buildEither<A: ChartContent>(first: A) -> _ChartList { _ChartList(parts: [first]) }
    public static func buildEither<B: ChartContent>(second: B) -> _ChartList { _ChartList(parts: [second]) }
    public static func buildArray(_ c: [any ChartContent]) -> _ChartList { _ChartList(parts: c) }
}

public struct Chart<Content: ChartContent>: View, _Primitive {
    public typealias Body = Never
    let content: Content
    var xAxis: _J?
    var yAxis: _J?
    var yDomain: _J?
    nonisolated public init(@ChartContentBuilder content: () -> Content) { self.content = content() }

    public func _render() -> [_Node] {
        var marks: [_J] = []
        content._marks(&marks)
        var p: [String: _J] = ["marks": .a(marks)]
        if let xAxis { p["xAxis"] = xAxis }
        if let yAxis { p["yAxis"] = yAxis }
        if let yDomain { p["yDomain"] = yDomain }
        let n = _Node("chart", p)
        n.gw = true; n.gh = true
        return [n]
    }

    public func chartXAxis<A: AxisContent>(@AxisContentBuilder content: () -> A) -> Chart { var c = self; c.xAxis = content()._json; return c }
    public func chartYAxis<A: AxisContent>(@AxisContentBuilder content: () -> A) -> Chart { var c = self; c.yAxis = content()._json; return c }
    public func chartXAxis(_ v: Visibility) -> Chart { var c = self; if v == .hidden { c.xAxis = .o(["hidden": true]) }; return c }
    public func chartYAxis(_ v: Visibility) -> Chart { var c = self; if v == .hidden { c.yAxis = .o(["hidden": true]) }; return c }
    public func chartYScale<R>(domain: R) -> Chart {
        var c = self
        if let r = domain as? ClosedRange<Int> { c.yDomain = .a([.n(Double(r.lowerBound)), .n(Double(r.upperBound))]) }
        if let r = domain as? ClosedRange<Double> { c.yDomain = .a([.n(r.lowerBound), .n(r.upperBound)]) }
        return c
    }
    public func chartXScale<R>(domain: R) -> Chart { self }
    public func chartLegend(_ v: Visibility) -> Chart { self }
    public func chartPlotStyle<V: View>(content: (ChartPlotContent) -> V) -> Chart { self }
}

public struct ChartPlotContent: View, _Primitive { public typealias Body = Never; public func _render() -> [_Node] { [] } }

@MainActor public protocol AxisContent { var _json: _J { get } }

public struct AxisMarkValues {
    let j: _J
    public static var automatic: AxisMarkValues { AxisMarkValues(j: "auto") }
    public static func automatic(desiredCount: Int) -> AxisMarkValues { AxisMarkValues(j: .o(["count": .n(Double(desiredCount))])) }
    public static func stride(by c: Calendar.Component, count: Int = 1) -> AxisMarkValues { AxisMarkValues(j: .o(["strideDays": .n(Double(c == .day ? count : c == .weekOfYear ? count * 7 : count))])) }
    public static func stride(by step: Double) -> AxisMarkValues { AxisMarkValues(j: .o(["step": .n(step)])) }
}

public enum AxisMarkPosition: Sendable { case automatic, leading, trailing, top, bottom }

public struct AxisValue { public func `as`<T>(_ t: T.Type) -> T? { nil }; public var index: Int { 0 } }

public struct AxisMarks: AxisContent {
    let o: [String: _J]
    nonisolated public init<C>(preset: Any? = nil, position: AxisMarkPosition = .automatic, values: AxisMarkValues = .automatic, stroke: StrokeStyle? = nil, @_AxisMarkBuilder content: @escaping (AxisValue) -> C) {
        let parts = (content(AxisValue()) as? _AxisParts)?.list ?? []
        var o: [String: _J] = ["values": values.j, "pos": .s(position == .trailing ? "trailing" : position == .leading ? "leading" : "auto")]
        o["grid"] = .b(parts.contains("grid"))
        o["labels"] = .b(parts.contains("label"))
        if let f = parts.first(where: { $0.hasPrefix("fmt:") }) { o["fmt"] = .s(String(f.dropFirst(4))) }
        if let c = parts.first(where: { $0.hasPrefix("gridColor:") }) { o["gridColor"] = .s(String(c.dropFirst(10))) }
        self.o = o
    }
    nonisolated public init(preset: Any? = nil, position: AxisMarkPosition = .automatic, values: AxisMarkValues = .automatic) {
        o = ["values": values.j, "grid": true, "labels": true, "pos": .s(position == .trailing ? "trailing" : position == .leading ? "leading" : "auto")]
    }
    public var _json: _J { .o(o) }
}

public struct _AxisParts { var list: [String] }
public protocol _AxisPart { var _k: String { get } }

@resultBuilder public struct _AxisMarkBuilder {
    public static func buildBlock(_ c: _AxisPart...) -> _AxisParts { _AxisParts(list: c.flatMap { $0._k.split(separator: " ").map(String.init) }) }
}

public struct AxisGridLine: _AxisPart {
    var color: String?
    nonisolated public init(centered: Bool? = nil, stroke: StrokeStyle? = nil) {}
    public var _k: String { color.map { "gridColor:" + $0 } ?? "grid" }
    public func foregroundStyle<S: ShapeStyle>(_ s: S) -> AxisGridLine { var c = self; c.color = s._paint().flat; return c }
}
public struct AxisTick: _AxisPart { public init(centered: Bool? = nil, length: CGFloat = 4, stroke: StrokeStyle? = nil) {}; public var _k: String { "tick" } }
public struct AxisValueLabel: _AxisPart {
    let fmt: String?
    nonisolated public init(centered: Bool? = nil, anchor: UnitPoint? = nil, multiLabelAlignment: Alignment? = nil, collisionResolution: Any? = nil, offsetsMarks: Bool? = nil, orientation: Any? = nil, horizontalSpacing: CGFloat? = nil, verticalSpacing: CGFloat? = nil) { fmt = nil }
    nonisolated public init(format: Date.FormatStyle, centered: Bool? = nil) { fmt = "dayMonth" }
    nonisolated public init<F: FormatStyle>(format: F, centered: Bool? = nil) { fmt = "dayMonth" }
    public var _k: String { fmt.map { "label fmt:" + $0 } ?? "label" }
    public func font(_ f: Font) -> AxisValueLabel { self }
    public func foregroundStyle<S: ShapeStyle>(_ s: S) -> AxisValueLabel { self }
}

public struct _AxisList: AxisContent {
    let list: [_J]
    public var _json: _J { list.first ?? .null }
}

@MainActor @resultBuilder public struct AxisContentBuilder {
    public static func buildBlock<A: AxisContent>(_ a: A) -> A { a }
    public static func buildBlock() -> _AxisList { _AxisList(list: [.o(["hidden": true])]) }
}

extension Array: ChartContent where Element == any ChartContent {
    public func _marks(_ out: inout [_J]) { for c in self { c._marks(&out) } }
}
