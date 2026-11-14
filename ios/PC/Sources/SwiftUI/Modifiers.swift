// Modifier: Layout, Aussehen, Lebenszyklus, Gesten

extension View {
    // MARK: Abstand und Größe

    public func padding(_ insets: EdgeInsets) -> some View {
        _Mod(content: self, env: { e in
            if var p = e[_Env.proposal] {
                if let w = p.width { p.width = max(0, w - insets.leading - insets.trailing) }
                if let h = p.height { p.height = max(0, h - insets.top - insets.bottom) }
                e[_Env.proposal] = p
            }
        }, wrap: { _css($0, .pad, [("padding", insets.css)]) })
    }
    public func padding(_ edges: Edge.Set = .all, _ length: CGFloat? = nil) -> some View {
        let l = length ?? 16
        return padding(EdgeInsets(top: edges.contains(.top) ? l : 0, leading: edges.contains(.leading) ? l : 0,
                                  bottom: edges.contains(.bottom) ? l : 0, trailing: edges.contains(.trailing) ? l : 0))
    }
    public func padding(_ length: CGFloat) -> some View { padding(.all, length) }

    public func frame(width: CGFloat? = nil, height: CGFloat? = nil, alignment: Alignment = .center) -> some View {
        var css: [(String, String)] = []
        if let width { css.append(("width", _px(width))) }
        if let height { css.append(("height", _px(height))) }
        if !alignment.isCenter { css.append(("place-items", alignment.css)) }
        css.append(("flex-shrink", "0"))
        return _Mod(content: self, env: { e in
            var p = e[_Env.proposal] ?? _Proposal()
            if let width { p.width = width }
            if let height { p.height = height }
            e[_Env.proposal] = p
        }, wrap: { _css($0, .frame, css, gw: width != nil ? false : nil, gh: height != nil ? false : nil) })
    }

    public func frame(minWidth: CGFloat? = nil, idealWidth: CGFloat? = nil, maxWidth: CGFloat? = nil,
                      minHeight: CGFloat? = nil, idealHeight: CGFloat? = nil, maxHeight: CGFloat? = nil, alignment: Alignment = .center) -> some View {
        var css: [(String, String)] = []
        if let minWidth, minWidth > 0 { css.append(("min-width", _px(minWidth))) }
        if let maxWidth, maxWidth.isFinite { css.append(("max-width", _px(maxWidth))) }
        if let minHeight, minHeight > 0 { css.append(("min-height", _px(minHeight))) }
        if let maxHeight, maxHeight.isFinite { css.append(("max-height", _px(maxHeight))) }
        if !alignment.isCenter { css.append(("place-items", alignment.css)) }
        if css.isEmpty { css.append(("--f", "1")) }
        return _Mod(content: self, env: { e in e[_Env.proposal] = nil },
                    wrap: { _css($0, .frame, css, gw: maxWidth != nil ? true : nil, gh: maxHeight != nil ? true : nil) })
    }

    @available(*, deprecated) public func frame() -> some View { self }

    public func fixedSize(horizontal: Bool = true, vertical: Bool = true) -> some View {
        _style(.frame, [("flex-shrink", "0")] + (horizontal ? [("white-space", "nowrap")] : []), gw: horizontal ? false : nil, gh: vertical ? false : nil)
    }
    public func layoutPriority(_ p: Double) -> some View { _style(.inherit, p > 0 ? [("--lp", "1")] : [], extra: p > 0 ? ["lp": true] : [:]) }

    public func aspectRatio(_ ratio: CGFloat? = nil, contentMode: ContentMode) -> some View {
        var css = [("--fit", contentMode == .fit ? "contain" : "cover")]
        if let ratio { css.append(("aspect-ratio", _num(Double(ratio)))) }
        return _style(.frame, css)
    }
    public func aspectRatio(_ size: CGSize, contentMode: ContentMode) -> some View { aspectRatio(size.width / max(size.height, 0.001), contentMode: contentMode) }
    public func scaledToFit() -> some View { aspectRatio(contentMode: .fit) }
    public func scaledToFill() -> some View { aspectRatio(contentMode: .fill) }

    public func position(x: CGFloat = 0, y: CGFloat = 0) -> some View {
        _style(.effect, [("position", "absolute"), ("left", _px(x)), ("top", _px(y)), ("translate", "-50% -50%")], gw: false, gh: false)
    }
    public func position(_ p: CGPoint) -> some View { position(x: p.x, y: p.y) }

    public func offset(x: CGFloat = 0, y: CGFloat = 0) -> some View { _style(.effect, [("transform", "translate(\(_px(x)),\(_px(y)))")]) }
    public func offset(_ s: CGSize) -> some View { offset(x: s.width, y: s.height) }

    public func ignoresSafeArea(_ regions: SafeAreaRegions = .all, edges: Edge.Set = .all) -> some View {
        _prop("isa", .n(Double(edges.rawValue)))
    }
    public func edgesIgnoringSafeArea(_ edges: Edge.Set) -> some View { ignoresSafeArea(edges: edges) }
    public func safeAreaPadding(_ edges: Edge.Set = .all, _ length: CGFloat? = nil) -> some View { padding(edges, length) }
    public func safeAreaPadding(_ length: CGFloat) -> some View { padding(length) }

    public func safeAreaInset<V: View>(edge: VerticalEdge, alignment: HorizontalAlignment = .center, spacing: CGFloat? = nil, @ViewBuilder content: () -> V) -> some View {
        _Inset(content: self, inset: content(), top: edge == .top)
    }

    // MARK: Aussehen

    public func foregroundStyle<S: ShapeStyle>(_ s: S) -> some View {
        let p = s._paint()
        return _style(.inherit, [("color", p.flat), ("--fg", p.css)])
    }
    public func foregroundStyle<S1: ShapeStyle, S2: ShapeStyle>(_ a: S1, _ b: S2) -> some View { foregroundStyle(a) }
    public func foregroundStyle<S1: ShapeStyle, S2: ShapeStyle, S3: ShapeStyle>(_ a: S1, _ b: S2, _ c: S3) -> some View { foregroundStyle(a) }
    public func foregroundColor(_ c: Color?) -> some View { _style(.inherit, c.map { [("color", $0.css), ("--fg", $0.css)] } ?? []) }
    public func tint(_ c: Color?) -> some View { _style(.inherit, c.map { [("--tint", $0.css)] } ?? []) }
    public func tint<S: ShapeStyle>(_ s: S?) -> some View { _style(.inherit, s.map { [("--tint", $0._paint().flat)] } ?? []) }
    public func accentColor(_ c: Color?) -> some View { tint(c) }

    public func font(_ f: Font?) -> some View { _Mod(content: self, env: { $0[_Env.font] = f }, wrap: { _css($0, .inherit, f?.css ?? []) }) }
    public func fontWeight(_ w: Font.Weight?) -> some View { _style(.inherit, w.map { [("font-weight", "\($0.v)")] } ?? []) }
    public func fontDesign(_ d: Font.Design?) -> some View { _style(.inherit, d.map { Font(design: $0).css } ?? []) }
    public func fontWidth(_ w: Font.Width?) -> some View { self }
    public func bold(_ on: Bool = true) -> some View { _style(.inherit, on ? [("font-weight", "700")] : []) }
    public func italic(_ on: Bool = true) -> some View { _style(.inherit, on ? [("font-style", "italic")] : []) }
    public func monospacedDigit() -> some View { _style(.inherit, [("font-variant-numeric", "tabular-nums")]) }
    public func monospaced(_ on: Bool = true) -> some View { _style(.inherit, on ? [("font-family", "var(--font-mono)")] : []) }
    public func underline(_ on: Bool = true, pattern: Text.LineStyle.Pattern = .solid, color: Color? = nil) -> some View { _style(.inherit, on ? [("text-decoration", "underline")] : []) }
    public func strikethrough(_ on: Bool = true, pattern: Text.LineStyle.Pattern = .solid, color: Color? = nil) -> some View { _style(.inherit, on ? [("text-decoration", "line-through")] : []) }
    public func kerning(_ k: CGFloat) -> some View { _style(.inherit, [("letter-spacing", _px(k))]) }
    public func tracking(_ k: CGFloat) -> some View { _style(.inherit, [("letter-spacing", _px(k))]) }
    public func textCase(_ c: Text.Case?) -> some View { _style(.inherit, [("text-transform", c == .uppercase ? "uppercase" : c == .lowercase ? "lowercase" : "none")]) }
    public func lineSpacing(_ s: CGFloat) -> some View { _style(.inherit, [("--ls", _px(s))]) }
    public func multilineTextAlignment(_ a: TextAlignment) -> some View { _style(.inherit, [("text-align", a == .center ? "center" : a == .trailing ? "right" : "left")]) }
    public func lineLimit(_ n: Int?) -> some View { _Mod(content: self, env: { $0[_Env.lineLimit] = n }, wrap: { _css($0, .inherit, [("--ll", n.map { "\($0)" } ?? "none")]) }) }
    public func lineLimit(_ r: ClosedRange<Int>) -> some View { lineLimit(r.upperBound) }
    public func lineLimit(_ r: PartialRangeFrom<Int>) -> some View { lineLimit(nil) }
    public func lineLimit(_ r: PartialRangeThrough<Int>) -> some View { lineLimit(r.upperBound) }
    public func lineLimit(_ n: Int, reservesSpace: Bool) -> some View { lineLimit(n) }
    public func truncationMode(_ m: Text.TruncationMode) -> some View { self }
    public func minimumScaleFactor(_ f: CGFloat) -> some View { self }
    public func allowsTightening(_ on: Bool) -> some View { self }
    public func textSelection<S: TextSelectability>(_ s: S) -> some View { _style(.inherit, [("user-select", s._on ? "text" : "none"), ("cursor", s._on ? "text" : "inherit")]) }
    public func dynamicTypeSize(_ s: DynamicTypeSize) -> some View { self }
    public func dynamicTypeSize<R: RangeExpression>(_ r: R) -> some View where R.Bound == DynamicTypeSize { self }
    public func imageScale(_ s: Image.Scale) -> some View { _style(.inherit, [("--isc", s == .small ? "0.82" : s == .large ? "1.2" : "1")]) }
    public func symbolRenderingMode(_ m: SymbolRenderingMode?) -> some View { self }
    public func symbolVariant(_ v: SymbolVariants) -> some View { self }
    public func symbolEffect<E>(_ e: E, options: Any? = nil, isActive: Bool = true) -> some View { self }
    public func symbolEffect<E, V: Equatable>(_ e: E, options: Any? = nil, value: V) -> some View { self }
    public func contentTransition(_ t: ContentTransition) -> some View { self }

    public func opacity(_ o: Double) -> some View { _style(.effect, [("opacity", _num(o))]) }
    public func hidden() -> some View { _style(.effect, [("visibility", "hidden")]) }
    public func blur(radius: CGFloat, opaque: Bool = false) -> some View { _style(.effect, radius > 0 ? [("filter", "blur(\(_px(radius * 0.9)))")] : []) }
    public func shadow(color: Color = Color(.sRGB, white: 0, opacity: 0.33), radius: CGFloat, x: CGFloat = 0, y: CGFloat = 0) -> some View {
        _style(.effect, [("filter", "drop-shadow(\(_px(x)) \(_px(y)) \(_px(radius)) \(color.css))")])
    }
    public func brightness(_ b: Double) -> some View { _style(.effect, [("filter", "brightness(\(_num(1 + b)))")]) }
    public func saturation(_ s: Double) -> some View { _style(.effect, [("filter", "saturate(\(_num(s)))")]) }
    public func contrast(_ c: Double) -> some View { _style(.effect, [("filter", "contrast(\(_num(c)))")]) }
    public func grayscale(_ g: Double) -> some View { _style(.effect, [("filter", "grayscale(\(_num(g)))")]) }
    public func colorMultiply(_ c: Color) -> some View { self }
    public func blendMode(_ m: BlendMode) -> some View { _style(.effect, [("mix-blend-mode", m.css)]) }
    public func compositingGroup() -> some View { self }
    public func drawingGroup(opaque: Bool = false) -> some View { self }

    public func rotationEffect(_ a: Angle, anchor: UnitPoint = .center) -> some View {
        _style(.effect, [("transform", "rotate(\(_num(a.degrees))deg)")] + (anchor == .center ? [] : [("transform-origin", anchor.css)]))
    }
    public func scaleEffect(_ s: CGFloat, anchor: UnitPoint = .center) -> some View {
        _style(.effect, [("transform", "scale(\(_num(Double(s))))")] + (anchor == .center ? [] : [("transform-origin", anchor.css)]))
    }
    public func scaleEffect(x: CGFloat = 1, y: CGFloat = 1, anchor: UnitPoint = .center) -> some View {
        _style(.effect, [("transform", "scale(\(_num(Double(x))),\(_num(Double(y))))")] + (anchor == .center ? [] : [("transform-origin", anchor.css)]))
    }
    public func scaleEffect(_ s: CGSize, anchor: UnitPoint = .center) -> some View { scaleEffect(x: s.width, y: s.height, anchor: anchor) }
    public func rotation3DEffect(_ a: Angle, axis: (x: CGFloat, y: CGFloat, z: CGFloat), anchor: UnitPoint = .center, anchorZ: CGFloat = 0, perspective: CGFloat = 1) -> some View {
        _style(.effect, [("transform", "perspective(600px) rotate3d(\(_num(Double(axis.x))),\(_num(Double(axis.y))),\(_num(Double(axis.z))),\(_num(a.degrees))deg)")])
    }

    public func clipShape<S: Shape>(_ shape: S, style: FillStyle = FillStyle()) -> some View {
        if let b = shape as? _BoxShape { return AnyView(_style(.paint, [("border-radius", b._radius), ("overflow", "hidden")])) }
        return AnyView(_style(.paint, [("overflow", "hidden")]))
    }
    public func clipped(antialiased: Bool = false) -> some View { _style(.paint, [("overflow", "hidden")]) }
    public func cornerRadius(_ r: CGFloat, antialiased: Bool = true) -> some View { _style(.paint, [("border-radius", _px(r)), ("overflow", "hidden")]) }
    public func mask<M: View>(alignment: Alignment = .center, @ViewBuilder _ mask: () -> M) -> some View { self }
    public func mask<M: View>(_ mask: M) -> some View { self }
    public func border<S: ShapeStyle>(_ s: S, width: CGFloat = 1) -> some View { _style(.paint, [("box-shadow", "inset 0 0 0 \(_px(width)) \(s._paint().flat)")]) }
    public func containerShape<S: Shape>(_ s: S) -> some View { self }
    public func contentShape<S: Shape>(_ s: S, eoFill: Bool = false) -> some View { self }
    public func contentShape<S: Shape>(_ kind: ContentShapeKinds, _ s: S, eoFill: Bool = false) -> some View { self }

    public func zIndex(_ z: Double) -> some View { _style(.effect, [("z-index", "\(Int(z))")]) }
    public func allowsHitTesting(_ on: Bool) -> some View { _style(.inherit, on ? [] : [("pointer-events", "none")]) }
    public func disabled(_ off: Bool) -> some View {
        _Mod(content: self, env: { e in if off { e[_Env.isEnabled] = false } }, wrap: { off ? _css($0, .inherit, [("--dis", "1")], extra: ["dis": true]) : $0 })
    }
    public func preferredColorScheme(_ s: ColorScheme?) -> some View { self }
    public func colorScheme(_ s: ColorScheme) -> some View { self }
    public func redacted(reason: RedactionReasons) -> some View { self }
    public func statusBarHidden(_ hidden: Bool = true) -> some View { self }
    public func statusBar(hidden: Bool) -> some View { self }
    public func persistentSystemOverlays(_ v: Visibility) -> some View { self }
    public func sensoryFeedback<T: Equatable>(_ f: SensoryFeedback, trigger: T) -> some View { self }
    public func sensoryFeedback<T: Equatable>(_ f: SensoryFeedback, trigger: T, condition: @escaping (T, T) -> Bool) -> some View { self }
    public func coordinateSpace(name: AnyHashable) -> some View { self }
    public func coordinateSpace(_ n: NamedCoordinateSpace) -> some View { self }
    public func defersSystemGestures(on: Edge.Set) -> some View { self }
    public func hoverEffect(_ e: HoverEffect = .automatic) -> some View { self }
    public func keyboardShortcut(_ k: KeyboardShortcut) -> some View { self }
    public func help(_ t: LocalizedStringKey) -> some View { self }

    // MARK: Hintergrund und Auflage

    public func background<S: ShapeStyle>(_ style: S, ignoresSafeAreaEdges edges: Edge.Set = .all) -> some View {
        let p = style._paint()
        var css = [("background", p.css)]
        if case .material = p { css.append(("backdrop-filter", "blur(20px) saturate(1.6)")) }
        return _style(.paint, css, extra: edges.isEmpty ? [:] : ["bsa": .n(Double(edges.rawValue))])
    }
    public func background<S: ShapeStyle, T: Shape>(_ style: S, in shape: T, fillStyle: FillStyle = FillStyle()) -> some View {
        let p = style._paint()
        if let b = shape as? _BoxShape, !b._circle {
            var css = [("background", p.css), ("border-radius", b._radius)]
            if case .material = p { css.append(("backdrop-filter", "blur(20px) saturate(1.6)")) }
            return AnyView(_style(.paint, css))
        }
        return AnyView(_Deco(content: self, deco: shape.fill(style), alignment: .center, front: false))
    }
    public func background<T: Shape>(in shape: T, fillStyle: FillStyle = FillStyle()) -> some View { background(BackgroundStyle(), in: shape) }
    public func background(ignoresSafeAreaEdges edges: Edge.Set = .all) -> some View { background(BackgroundStyle()) }
    @_disfavoredOverload public func background<V: View>(_ view: V, alignment: Alignment = .center) -> some View {
        _Deco(content: self, deco: view, alignment: alignment, front: false)
    }
    public func background<V: View>(alignment: Alignment = .center, @ViewBuilder content: () -> V) -> some View {
        _Deco(content: self, deco: content(), alignment: alignment, front: false)
    }
    public func backgroundStyle<S: ShapeStyle>(_ s: S) -> some View { _style(.inherit, [("--bg", s._paint().flat)]) }

    @_disfavoredOverload public func overlay<V: View>(_ view: V, alignment: Alignment = .center) -> some View {
        _Deco(content: self, deco: view, alignment: alignment, front: true)
    }
    public func overlay<V: View>(alignment: Alignment = .center, @ViewBuilder content: () -> V) -> some View {
        _Deco(content: self, deco: content(), alignment: alignment, front: true)
    }
    public func overlay<S: ShapeStyle>(_ style: S, ignoresSafeAreaEdges: Edge.Set = .all) -> some View {
        _Deco(content: self, deco: Rectangle().fill(style), alignment: .center, front: true)
    }
    public func overlay<S: ShapeStyle, T: Shape>(_ style: S, in shape: T, fillStyle: FillStyle = FillStyle()) -> some View {
        _Deco(content: self, deco: shape.fill(style), alignment: .center, front: true)
    }

    // MARK: Bedienhilfen (am PC als Namen fürs Testen)

    public func accessibilityLabel(_ l: LocalizedStringKey) -> some View { _prop("al", .s(l.s)) }
    @_disfavoredOverload public func accessibilityLabel<S: StringProtocol>(_ l: S) -> some View { _prop("al", .s(String(l))) }
    public func accessibilityLabel(_ t: Text) -> some View { _prop("al", .s(t.plain)) }
    public func accessibilityHint(_ l: LocalizedStringKey) -> some View { self }
    @_disfavoredOverload public func accessibilityHint<S: StringProtocol>(_ l: S) -> some View { self }
    public func accessibilityValue(_ l: LocalizedStringKey) -> some View { self }
    @_disfavoredOverload public func accessibilityValue<S: StringProtocol>(_ l: S) -> some View { self }
    public func accessibilityHidden(_ h: Bool) -> some View { self }
    public func accessibilityIdentifier(_ id: String) -> some View { _prop("tid", .s(id)) }
    public func accessibilityAddTraits(_ t: AccessibilityTraits) -> some View { self }
    public func accessibilityRemoveTraits(_ t: AccessibilityTraits) -> some View { self }
    public func accessibilityElement(children: AccessibilityChildBehavior = .ignore) -> some View { self }
    public func accessibilitySortPriority(_ p: Double) -> some View { self }
    public func accessibilityAction(_ kind: AccessibilityActionKind = .default, _ handler: @escaping () -> Void) -> some View { self }
    public func accessibilityInputLabels(_ l: [String]) -> some View { self }

    // MARK: Identität, Übergänge, Animation

    public func id<ID: Hashable>(_ id: ID) -> some View { _IDMod(content: self, id: _hash(id)) }
    public func tag<V: Hashable>(_ v: V, includeOptional: Bool = true) -> some View { _Trait(content: self, key: "tag", value: AnyHashable(v)) }
    public func transition(_ t: AnyTransition) -> some View { _prop("tr", .s(t.css)) }
    public func animation<V: Equatable>(_ a: Animation?, value: V) -> some View { _AnimMod(content: self, anim: a, value: value) }
    public func animation(_ a: Animation?) -> some View { self }
    public func transaction(_ f: @escaping (inout Transaction) -> Void) -> some View { self }
    public func matchedGeometryEffect<ID: Hashable>(id: ID, in ns: Namespace.ID, properties: Any? = nil, anchor: UnitPoint = .center, isSource: Bool = true) -> some View { self }
    public func geometryGroup() -> some View { self }

    // MARK: Lebenszyklus

    public func onAppear(perform action: (() -> Void)? = nil) -> some View { _LifeMod(content: self, appear: action) }
    public func onDisappear(perform action: (() -> Void)? = nil) -> some View { _LifeMod(content: self, disappear: action) }
    public func task(priority: TaskPriority = .userInitiated, _ action: @escaping @MainActor @Sendable () async -> Void) -> some View {
        _LifeMod(content: self, task: action, taskId: AnyHashable(0))
    }
    public func task<T: Equatable>(id: T, priority: TaskPriority = .userInitiated, _ action: @escaping @MainActor @Sendable () async -> Void) -> some View {
        _LifeMod(content: self, task: action, taskId: AnyHashable(_Eq(v: id)))
    }
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping (V, V) -> Void) -> some View {
        _ChangeMod(content: self, value: value, initial: initial, action: action)
    }
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping () -> Void) -> some View {
        _ChangeMod(content: self, value: value, initial: initial, action: { _, _ in action() })
    }
    @_disfavoredOverload public func onChange<V: Equatable>(of value: V, perform action: @escaping (V) -> Void) -> some View {
        _ChangeMod(content: self, value: value, initial: false, action: { _, n in action(n) })
    }
    public func onReceive<P>(_ p: P, perform: @escaping (Any) -> Void) -> some View { self }
    public func onOpenURL(perform action: @escaping (URL) -> Void) -> some View {
        _Mod(content: self, wrap: { nodes in _openURLHandlers.append(action); return nodes })
    }
    public func onContinueUserActivity(_ type: String, perform: @escaping (Any) -> Void) -> some View { self }
    public func refreshable(action: @escaping @Sendable () async -> Void) -> some View { _env { $0[_Env.refresh] = RefreshAction(f: action) } }

    // MARK: Gesten

    public func onTapGesture(count: Int = 1, perform action: @escaping () -> Void) -> some View {
        _HandlerMod(content: self, name: count > 1 ? "dbl" : "tap") { _ in action() }
    }
    public func onTapGesture(count: Int = 1, coordinateSpace: CoordinateSpace = .local, perform action: @escaping (CGPoint) -> Void) -> some View {
        _HandlerMod(content: self, name: "tap") { v in action(CGPoint(x: v["x"]?.number ?? 0, y: v["y"]?.number ?? 0)) }
    }
    public func onLongPressGesture(minimumDuration: Double = 0.5, maximumDistance: CGFloat = 10, perform action: @escaping () -> Void, onPressingChanged: ((Bool) -> Void)? = nil) -> some View {
        _HandlerMod(content: self, name: "lp") { _ in action() }
    }
    public func gesture<G: Gesture>(_ g: G, including: GestureMask = .all) -> some View { _GestureMod(content: self, gesture: g) }
    public func simultaneousGesture<G: Gesture>(_ g: G, including: GestureMask = .all) -> some View { _GestureMod(content: self, gesture: g) }
    public func highPriorityGesture<G: Gesture>(_ g: G, including: GestureMask = .all) -> some View { _GestureMod(content: self, gesture: g) }
    public func onHover(perform: @escaping (Bool) -> Void) -> some View { self }
}

// MARK: kleine Typen für die Modifier

public struct SafeAreaRegions: OptionSet, Sendable {
    public let rawValue: Int
    nonisolated public init(rawValue: Int) { self.rawValue = rawValue }
    public static let container = SafeAreaRegions(rawValue: 1)
    public static let keyboard = SafeAreaRegions(rawValue: 2)
    public static let all: SafeAreaRegions = [.container, .keyboard]
}
public protocol TextSelectability { var _on: Bool { get } }
public struct EnabledTextSelectability: TextSelectability { public var _on: Bool { true } }
public struct DisabledTextSelectability: TextSelectability { public var _on: Bool { false } }
extension TextSelectability where Self == EnabledTextSelectability { public static var enabled: EnabledTextSelectability { .init() } }
extension TextSelectability where Self == DisabledTextSelectability { public static var disabled: DisabledTextSelectability { .init() } }
public struct SymbolVariants: Sendable { public static let fill = SymbolVariants(); public static let none = SymbolVariants(); public static let circle = SymbolVariants(); public static let slash = SymbolVariants() }
public struct ContentTransition: Sendable {
    public static let identity = ContentTransition(); public static let opacity = ContentTransition(); public static let interpolate = ContentTransition()
    public static let numericText = ContentTransition()
    public static func numericText(countsDown: Bool = false) -> ContentTransition { .init() }
    public static func numericText(value: Double) -> ContentTransition { .init() }
}
public struct RedactionReasons: OptionSet, Sendable {
    public let rawValue: Int
    nonisolated public init(rawValue: Int) { self.rawValue = rawValue }
    public static let placeholder = RedactionReasons(rawValue: 1)
}
public struct SensoryFeedback: Sendable, Equatable {
    public static let success = SensoryFeedback(), warning = SensoryFeedback(), error = SensoryFeedback(), selection = SensoryFeedback()
    public static let increase = SensoryFeedback(), decrease = SensoryFeedback(), start = SensoryFeedback(), stop = SensoryFeedback(), alignment = SensoryFeedback(), levelChange = SensoryFeedback(), impact = SensoryFeedback()
    public static func impact(weight: Weight = .medium, intensity: Double = 1) -> SensoryFeedback { .init() }
    public static func impact(flexibility: Flexibility, intensity: Double = 1) -> SensoryFeedback { .init() }
    public enum Weight: Sendable { case light, medium, heavy }
    public enum Flexibility: Sendable { case rigid, solid, soft }
}
public struct HoverEffect: Sendable { public static let automatic = HoverEffect(), highlight = HoverEffect(), lift = HoverEffect() }
public struct KeyboardShortcut: Sendable { public static let defaultAction = KeyboardShortcut(), cancelAction = KeyboardShortcut() }
public struct ContentShapeKinds: OptionSet, Sendable {
    public let rawValue: Int
    nonisolated public init(rawValue: Int) { self.rawValue = rawValue }
    public static let interaction = ContentShapeKinds(rawValue: 1), dragPreview = ContentShapeKinds(rawValue: 2), contextMenuPreview = ContentShapeKinds(rawValue: 4), hoverEffect = ContentShapeKinds(rawValue: 8)
}
public struct AccessibilityTraits: OptionSet, Sendable {
    public let rawValue: Int
    nonisolated public init(rawValue: Int) { self.rawValue = rawValue }
    public static let isButton = AccessibilityTraits(rawValue: 1), isHeader = AccessibilityTraits(rawValue: 2), isSelected = AccessibilityTraits(rawValue: 4), isLink = AccessibilityTraits(rawValue: 8)
    public static let isImage = AccessibilityTraits(rawValue: 16), isStaticText = AccessibilityTraits(rawValue: 32), updatesFrequently = AccessibilityTraits(rawValue: 64), isModal = AccessibilityTraits(rawValue: 128)
    public static let isToggle = AccessibilityTraits(rawValue: 256), isSummaryElement = AccessibilityTraits(rawValue: 512), playsSound = AccessibilityTraits(rawValue: 1024)
}
public enum AccessibilityChildBehavior: Sendable { case ignore, contain, combine }
public struct AccessibilityActionKind: Sendable { public static let `default` = AccessibilityActionKind(), escape = AccessibilityActionKind(), magicTap = AccessibilityActionKind() }

struct _Eq<V: Equatable>: Hashable {
    let v: V
    func hash(into h: inout Hasher) {}
}

@MainActor var _openURLHandlers: [(URL) -> Void] = []

// MARK: Bausteine der Modifier

/** Hintergrund oder Auflage aus einer View */
struct _Deco<C: View, D: View>: View, _Primitive {
    typealias Body = Never
    let content: C, deco: D, alignment: Alignment, front: Bool
    func _render() -> [_Node] {
        let nodes = _at(51) { SwiftUI._render(content) }
        return nodes.map { n in
            let d = _at(52) { _withAxis(.z) { SwiftUI._render(deco) } }
            if d.isEmpty { return n }
            let layer = _Node("deco", [:], d)
            if !alignment.isCenter { layer.css = [("place-items", alignment.css)] }
            let w = _Node(front ? "ov" : "bg", [:], [n, layer])
            w.gw = n.gw; w.gh = n.gh
            return w
        }
    }
}

struct _Inset<C: View, I: View>: View, _Primitive {
    typealias Body = Never
    let content: C, inset: I, top: Bool
    func _render() -> [_Node] {
        let main = _at(51) { SwiftUI._render(content) }
        let bar = _at(52) { SwiftUI._render(inset) }
        let n = _Node("inset", ["top": .b(top)], [_Node("z", [:], main), _Node("z", [:], bar)])
        n.c[0].gw = true; n.c[0].gh = true
        n.c[1].gw = true
        n.gw = true; n.gh = true
        return [n]
    }
}

struct _IDMod<C: View>: View, _Primitive {
    typealias Body = Never
    let content: C, id: UInt64
    func _render() -> [_Node] {
        let nodes = _at(id) { SwiftUI._render(content) }
        return nodes.map { n in
            let w = n.t == "css" && n.p["sid"] == nil ? n : { let x = _Node("css", [:], [n]); x.gw = n.gw; x.gh = n.gh; return x }()
            w.p["sid"] = .n(_id(id))
            return w
        }
    }
}

struct _AnimMod<C: View, V: Equatable>: View, _Primitive {
    typealias Body = Never
    let content: C, anim: Animation?, value: V
    func _render() -> [_Node] {
        _at(53) {
            let l = _R.life(_R.path)
            let changed = (l.last as? V).map { $0 != value } ?? false
            l.last = value
            let saved = _R.curAnim
            if changed, let anim { _R.curAnim = anim }
            defer { _R.curAnim = saved }
            return SwiftUI._render(content)
        }
    }
}

struct _LifeMod<C: View>: View, _Primitive {
    typealias Body = Never
    let content: C
    var appear: (() -> Void)?
    var disappear: (() -> Void)?
    var task: (@MainActor @Sendable () async -> Void)?
    var taskId: AnyHashable?
    func _render() -> [_Node] {
        _at(54) {
            let nodes = SwiftUI._render(content)
            let l = _R.life(_R.path)
            l.onDisappear = disappear
            if !l.appeared {
                l.appeared = true
                if let appear { _R.post.append(appear) }
            }
            if let task, l.task == nil || l.taskId != taskId {
                l.task?.cancel()
                l.taskId = taskId
                l.task = Task { @MainActor in await task() }
            }
            return nodes
        }
    }
}

struct _ChangeMod<C: View, V: Equatable>: View, _Primitive {
    typealias Body = Never
    let content: C, value: V, initial: Bool, action: (V, V) -> Void
    func _render() -> [_Node] {
        _at(55) {
            let nodes = SwiftUI._render(content)
            let l = _R.life(_R.path)
            if let old = l.last as? V {
                if old != value { let a = action, v = value; _R.post.append { a(old, v) } }
            } else if initial {
                let a = action, v = value
                _R.post.append { a(v, v) }
            }
            l.last = value
            return nodes
        }
    }
}

struct _HandlerMod<C: View>: View, _Primitive {
    typealias Body = Never
    let content: C, name: String, action: (_J) -> Void
    func _render() -> [_Node] {
        _at(56) {
            let nodes = SwiftUI._render(content)
            let h = _R.handler(name, action)
            return nodes.map { n in
                let w = n.t == "css" && n.p[name] == nil ? n : { let x = _Node("css", [:], [n]); x.gw = n.gw; x.gh = n.gh; return x }()
                w.p[name] = h
                return w
            }
        }
    }
}

// MARK: Gesten

public protocol Gesture {
    associatedtype Value
    var _kind: String { get }
    func _handle(_ phase: String, _ v: _J)
}

public struct GestureMask: OptionSet, Sendable {
    public let rawValue: Int
    nonisolated public init(rawValue: Int) { self.rawValue = rawValue }
    public static let none = GestureMask([]), gesture = GestureMask(rawValue: 1), subviews = GestureMask(rawValue: 2), all: GestureMask = [.gesture, .subviews]
}

extension Gesture {
    public func onChanged(_ f: @escaping (Value) -> Void) -> _GestureWith<Self> { _GestureWith(base: self, changed: f, ended: nil) }
    public func onEnded(_ f: @escaping (Value) -> Void) -> _GestureWith<Self> { _GestureWith(base: self, changed: nil, ended: f) }
    public func updating<S>(_ state: GestureState<S>, body: @escaping (Value, inout S, inout Transaction) -> Void) -> _GestureWith<Self> { _GestureWith(base: self, changed: nil, ended: nil) }
    public func simultaneously<G: Gesture>(with other: G) -> Self { self }
    public func sequenced<G: Gesture>(before other: G) -> Self { self }
    public func exclusively<G: Gesture>(before other: G) -> Self { self }
}

@propertyWrapper public struct GestureState<Value>: _DynProp {
    public var wrappedValue: Value
    nonisolated public init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
    public var projectedValue: GestureState<Value> { self }
    func _link(_ key: UInt64) {}
}

protocol _GestureValue { static func _make(_ v: _J) -> Self }

public struct _GestureWith<G: Gesture>: Gesture {
    public typealias Value = G.Value
    let base: G
    var changed: ((G.Value) -> Void)?
    var ended: ((G.Value) -> Void)?
    public var _kind: String { base._kind }
    public func onChanged(_ f: @escaping (Value) -> Void) -> _GestureWith<G> { var c = self; c.changed = f; return c }
    public func onEnded(_ f: @escaping (Value) -> Void) -> _GestureWith<G> { var c = self; c.ended = f; return c }
    public func _handle(_ phase: String, _ v: _J) {
        guard let t = G.Value.self as? _GestureValue.Type, let value = t._make(v) as? G.Value else { return }
        if phase == "end" { ended?(value) } else { changed?(value) }
    }
}

public struct DragGesture: Gesture {
    public struct Value: Equatable, Sendable, _GestureValue {
        public var time: Date
        public var location: CGPoint
        public var startLocation: CGPoint
        public var translation: CGSize { CGSize(width: location.x - startLocation.x, height: location.y - startLocation.y) }
        public var velocity: CGSize
        public var predictedEndLocation: CGPoint { CGPoint(x: location.x + velocity.width * 0.2, y: location.y + velocity.height * 0.2) }
        public var predictedEndTranslation: CGSize { CGSize(width: translation.width + velocity.width * 0.2, height: translation.height + velocity.height * 0.2) }
        static func _make(_ v: _J) -> Value {
            Value(time: Date(), location: CGPoint(x: v["x"]?.number ?? 0, y: v["y"]?.number ?? 0),
                  startLocation: CGPoint(x: v["sx"]?.number ?? 0, y: v["sy"]?.number ?? 0),
                  velocity: CGSize(width: v["vx"]?.number ?? 0, height: v["vy"]?.number ?? 0))
        }
    }
    let minimumDistance: CGFloat
    nonisolated public init(minimumDistance: CGFloat = 10, coordinateSpace: CoordinateSpace = .local) { self.minimumDistance = minimumDistance }
    public var _kind: String { "drag:\(Int(minimumDistance))" }
    public func _handle(_ phase: String, _ v: _J) {}
}

public struct TapGesture: Gesture {
    public typealias Value = Void
    nonisolated public init(count: Int = 1) {}
    public var _kind: String { "tapg" }
    public func _handle(_ phase: String, _ v: _J) {}
}

public struct LongPressGesture: Gesture {
    public typealias Value = Bool
    nonisolated public init(minimumDuration: Double = 0.5, maximumDistance: CGFloat = 10) {}
    public var _kind: String { "lpg" }
    public func _handle(_ phase: String, _ v: _J) {}
}

public struct MagnifyGesture: Gesture {
    public struct Value: Equatable, Sendable { public var magnification: CGFloat = 1; public var velocity: CGFloat = 0; public var startLocation: CGPoint = .zero; public var time = Date() }
    nonisolated public init(minimumScaleDelta: CGFloat = 0.01) {}
    public var _kind: String { "mag" }
    public func _handle(_ phase: String, _ v: _J) {}
}

public typealias MagnificationGesture = MagnifyGesture

struct _GestureMod<C: View, G: Gesture>: View, _Primitive {
    typealias Body = Never
    let content: C, gesture: G
    func _render() -> [_Node] {
        _at(57) {
            let nodes = SwiftUI._render(content)
            let kind = gesture._kind
            guard kind.hasPrefix("drag") else { return nodes }
            let g = gesture
            let h = _R.handler("drag") { (v: _J) in g._handle(v["ph"]?.string ?? "move", v) }
            return nodes.map { n in
                let w = _Node("css", ["drag": h, "dmin": .n(Double(kind.dropFirst(5)) ?? 10)], [n])
                w.gw = n.gw; w.gh = n.gh
                return w
            }
        }
    }
}
