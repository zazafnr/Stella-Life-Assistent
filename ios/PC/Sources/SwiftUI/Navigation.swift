// Listen, Formulare, Navigation, Tabs, Sheets, Dialoge

// MARK: Abschnitte und Listen

@MainActor protocol _SectionLike {
    func _header() -> [_Node]
    func _footer() -> [_Node]
    func _rows() -> [_Child]
}

public struct Section<Parent: View, Content: View, Footer: View>: View, _Primitive, _SectionLike {
    public typealias Body = Never
    let header: Parent, content: Content, footer: Footer

    nonisolated public init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Parent, @ViewBuilder footer: () -> Footer) {
        self.header = header(); self.content = content(); self.footer = footer()
    }

    func _header() -> [_Node] { _at(1) { SwiftUI._render(header) } }
    func _footer() -> [_Node] { _at(2) { SwiftUI._render(footer) } }
    func _rows() -> [_Child] { _children(content) }

    /** außerhalb einer Liste: Kopf, Inhalt, Fuß untereinander */
    public func _render() -> [_Node] {
        let h = _withEnv({ $0[_Env.buttonKind] = "auto" }) { _header() }
        let head = h.isEmpty ? [] : [_Node("sechead", [:], h)]
        return head + _at(3) { SwiftUI._render(content) } + _footer()
    }
}

extension Section where Parent == EmptyView, Footer == EmptyView {
    nonisolated public init(@ViewBuilder content: () -> Content) { self.init(content: content, header: { EmptyView() }, footer: { EmptyView() }) }
}
extension Section where Footer == EmptyView {
    nonisolated public init(@ViewBuilder content: () -> Content, @ViewBuilder header: () -> Parent) { self.init(content: content, header: header, footer: { EmptyView() }) }
    nonisolated public init(header: Parent, @ViewBuilder content: () -> Content) { self.init(content: content, header: { header }, footer: { EmptyView() }) }
}
extension Section where Parent == EmptyView {
    nonisolated public init(@ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) { self.init(content: content, header: { EmptyView() }, footer: footer) }
    nonisolated public init(footer: Footer, @ViewBuilder content: () -> Content) { self.init(content: content, header: { EmptyView() }, footer: { footer }) }
}
extension Section {
    nonisolated public init(header: Parent, footer: Footer, @ViewBuilder content: () -> Content) { self.init(content: content, header: { header }, footer: { footer }) }
}
extension Section where Parent == Text, Footer == EmptyView {
    nonisolated public init(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) { self.init(content: content, header: { Text(title) }, footer: { EmptyView() }) }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, @ViewBuilder content: () -> Content) { self.init(content: content, header: { Text(title) }, footer: { EmptyView() }) }
    nonisolated public init(_ title: LocalizedStringKey, isExpanded: Binding<Bool>, @ViewBuilder content: () -> Content) { self.init(title, content: content) }
}

extension _Env {
    static let listStyle = _EnvName<String>("inset")
    static let listBgHidden = _EnvName<Bool>(false)
}

@MainActor func _listNode(_ content: any View, form: Bool) -> _Node {
    let env = _R.env
    var sections: [_Node] = []
    var loose: [_Node] = []

    func row(_ c: _Child) -> [_Node] {
        let kids = _withEnv({ $0[_Env.inList] = true; $0[_Env.proposal] = nil }) { _withAxis(.h) { _renderChild(c) } }
        if kids.isEmpty { return [] }
        let n = _Node("row", [:], kids)
        if let bg = c.traits["rowbg"] as? String { n.css.append(("background", bg)) }
        if let ins = c.traits["rowinsets"] as? EdgeInsets { n.css.append(("padding", ins.css)) }
        if c.traits["nosep"] != nil { n.p["nosep"] = true }
        var swipe: [_Node] = []
        if let del = c.traits["delete"] as? () -> Void {
            swipe.append(_at(c.key) { _Node("btn", ["tap": _R.handler("del") { del() }, "kind": "swipe", "role": "destructive"], [_Node("sym", ["n": "trash.fill"])]) })
        }
        if let s = c.traits["swipe"] as? any View {
            swipe += _at(_mix(c.key, 9)) { _withEnv({ $0[_Env.buttonStyle] = nil; $0[_Env.buttonKind] = "swipe"; $0[_Env.inList] = false; $0[_Env.labelStyle] = "icon" }) { _renderAny(s) } }
        }
        if !swipe.isEmpty { n.c.append(_Node("swipe", [:], swipe)) }
        return [n]
    }
    func flush() {
        if !loose.isEmpty { sections.append(_Node("section", [:], loose)); loose = [] }
    }

    for c in _children(content) {
        if let s = c.view as? _SectionLike {
            flush()
            _at(c.key) {
                var kids: [_Node] = []
                let h = _withEnv({ $0[_Env.inList] = false }) { s._header() }
                if !h.isEmpty { kids.append(_Node("sechead", [:], h)) }
                for r in s._rows() { kids += row(r) }
                let f = _withEnv({ $0[_Env.inList] = false }) { s._footer() }
                if !f.isEmpty { kids.append(_Node("secfoot", [:], f)) }
                if !kids.isEmpty { sections.append(_Node("section", [:], kids)) }
            }
        } else {
            loose += row(c)
        }
    }
    flush()
    let n = _Node("list", ["style": .s(form ? "inset" : env[_Env.listStyle]), "k": .n(_id(_R.path))], sections)
    if env[_Env.listBgHidden] { n.p["nobg"] = true }
    if let r = env[_Env.refresh] {
        n.p["refresh"] = _R.handler("refresh") { Task { @MainActor in await r(); _R.message(["k": "refreshed"]) } }
    }
    n.gw = true; n.gh = true
    return n
}

public struct List<SelectionValue: Hashable, Content: View>: View, _Primitive {
    public typealias Body = Never
    let content: Content
    public func _render() -> [_Node] { [_withEnv({ $0[_Env.refresh] = nil }) { _listNode(content, form: false) }].map { n in
        if let r = _R.env[_Env.refresh] { n.p["refresh"] = _R.handler("refresh") { Task { @MainActor in await r(); _R.message(["k": "refreshed"]) } } }
        return n
    } }
}

extension List where SelectionValue == Never {
    nonisolated public init(@ViewBuilder content: () -> Content) { self.content = content() }
    nonisolated public init<Data: RandomAccessCollection, Row: View>(_ data: Data, @ViewBuilder rowContent: @escaping (Data.Element) -> Row) where Content == ForEach<Data, Data.Element.ID, Row>, Data.Element: Identifiable {
        content = ForEach(data, content: rowContent)
    }
    nonisolated public init<Data: RandomAccessCollection, ID: Hashable, Row: View>(_ data: Data, id: KeyPath<Data.Element, ID>, @ViewBuilder rowContent: @escaping (Data.Element) -> Row) where Content == ForEach<Data, ID, Row> {
        content = ForEach(data, id: id, content: rowContent)
    }
}

extension List {
    nonisolated public init(selection: Binding<SelectionValue?>?, @ViewBuilder content: () -> Content) { self.content = content() }
    nonisolated public init(selection: Binding<Set<SelectionValue>>?, @ViewBuilder content: () -> Content) { self.content = content() }
}

public struct Form<Content: View>: View, _Primitive {
    public typealias Body = Never
    let content: Content
    nonisolated public init(@ViewBuilder content: () -> Content) { self.content = content() }
    public func _render() -> [_Node] { [_listNode(content, form: true)] }
}

public protocol ListStyle { var _k: String { get } }
public struct DefaultListStyle: ListStyle { public init() {}; public var _k: String { "inset" } }
public struct PlainListStyle: ListStyle { public init() {}; public var _k: String { "plain" } }
public struct InsetGroupedListStyle: ListStyle { public init() {}; public var _k: String { "inset" } }
public struct GroupedListStyle: ListStyle { public init() {}; public var _k: String { "inset" } }
public struct InsetListStyle: ListStyle { public init() {}; public var _k: String { "plain" } }
public struct SidebarListStyle: ListStyle { public init() {}; public var _k: String { "inset" } }
extension ListStyle where Self == DefaultListStyle { public static var automatic: DefaultListStyle { .init() } }
extension ListStyle where Self == PlainListStyle { public static var plain: PlainListStyle { .init() } }
extension ListStyle where Self == InsetGroupedListStyle { public static var insetGrouped: InsetGroupedListStyle { .init() } }
extension ListStyle where Self == GroupedListStyle { public static var grouped: GroupedListStyle { .init() } }
extension ListStyle where Self == InsetListStyle { public static var inset: InsetListStyle { .init() } }
extension ListStyle where Self == SidebarListStyle { public static var sidebar: SidebarListStyle { .init() } }

public protocol FormStyle {}
public struct GroupedFormStyle: FormStyle { public init() {} }
extension FormStyle where Self == GroupedFormStyle { public static var grouped: GroupedFormStyle { .init() }; public static var automatic: GroupedFormStyle { .init() }; public static var columns: GroupedFormStyle { .init() } }

public struct SwipeActionsConfiguration {}
public enum ListSectionSpacing: Sendable { case `default`, compact; public static func custom(_ v: CGFloat) -> ListSectionSpacing { .default } }
public enum EditMode: Sendable { case inactive, transient, active; public var isEditing: Bool { self != .inactive } }

extension View {
    public func listStyle<S: ListStyle>(_ s: S) -> some View { _env { $0[_Env.listStyle] = s._k } }
    public func formStyle<S: FormStyle>(_ s: S) -> some View { self }
    public func scrollContentBackground(_ v: Visibility) -> some View { _env { $0[_Env.listBgHidden] = v == .hidden } }
    public func listRowBackground<V: View>(_ v: V?) -> some View {
        let css = (v as? Color)?.css ?? (v == nil ? nil : "transparent")
        return _Trait(content: self, key: "rowbg", value: css ?? "transparent")
    }
    public func listRowInsets(_ i: EdgeInsets?) -> some View { _Trait(content: self, key: "rowinsets", value: i ?? EdgeInsets(top: 11, leading: 16, bottom: 11, trailing: 16)) }
    public func listRowSeparator(_ v: Visibility, edges: Edge.Set = .all) -> some View { v == .hidden ? AnyView(_Trait(content: self, key: "nosep", value: true)) : AnyView(self) }
    public func listRowSeparatorTint(_ c: Color?, edges: Edge.Set = .all) -> some View { self }
    public func listRowSpacing(_ s: CGFloat?) -> some View { self }
    public func listSectionSeparator(_ v: Visibility, edges: Edge.Set = .all) -> some View { self }
    public func listSectionSpacing(_ s: ListSectionSpacing) -> some View { self }
    public func listSectionSpacing(_ s: CGFloat) -> some View { self }
    public func listItemTint(_ c: Color?) -> some View { self }
    public func headerProminence(_ p: Prominence) -> some View { self }
    public func swipeActions<T: View>(edge: HorizontalEdge = .trailing, allowsFullSwipe: Bool = true, @ViewBuilder content: () -> T) -> some View {
        _Trait(content: self, key: "swipe", value: content() as any View)
    }
    public func deleteDisabled(_ d: Bool) -> some View { self }
    public func moveDisabled(_ d: Bool) -> some View { self }
    public func badge(_ n: Int) -> some View { _Trait(content: self, key: "badge", value: n > 0 ? "\(n)" : "") }
    public func badge(_ s: String?) -> some View { _Trait(content: self, key: "badge", value: s ?? "") }
    public func badge(_ t: Text?) -> some View { _Trait(content: self, key: "badge", value: t?.plain ?? "") }
    public func tabItem<V: View>(@ViewBuilder _ label: () -> V) -> some View { _Trait(content: self, key: "tabItem", value: label() as any View) }
}

public enum Prominence: Sendable { case standard, increased }

// MARK: Navigation

final class _NavEntry {
    let id: UInt64
    let view: any View
    var title = ""
    init(id: UInt64, view: any View) { self.id = id; self.view = view }
}

@MainActor final class _Nav {
    var stack: [_NavEntry] = []
    var rootTitle = ""
    var next: UInt64 = 1
    func push(_ v: any View) {
        next += 1
        stack.append(_NavEntry(id: next, view: v))
        _R.message(["k": "nav", "dir": "push"])
    }
    func pop() {
        guard !stack.isEmpty else { return }
        stack.removeLast()
        _R.message(["k": "nav", "dir": "pop"])
    }
}

/** Sammelt, was eine Seite ihrer Navigationsleiste mitgibt */
@MainActor final class _Prefs {
    var title: String?
    var titleView: [_Node]?
    var inline = false
    var barHidden = false
    var backHidden = false
    var leading: [_Node] = []
    var trailing: [_Node] = []
    var principal: [_Node] = []
    var bottom: [_Node] = []
}

@MainActor final class _SheetPrefs {
    var detents: [String] = []
    var locked = false
}

extension _Env {
    static let prefs = _EnvName<_Prefs?>(nil)
    static let sheetPrefs = _EnvName<_SheetPrefs?>(nil)
}

public struct NavigationPath: Equatable {
    var items: [AnyHashable] = []
    nonisolated public init() {}
    public var count: Int { items.count }
    public var isEmpty: Bool { items.isEmpty }
    public mutating func append<V: Hashable>(_ v: V) { items.append(AnyHashable(v)) }
    public mutating func removeLast(_ k: Int = 1) { items.removeLast(min(k, items.count)) }
}

public struct NavigationStack<Data, Root: View>: View, _Primitive {
    public typealias Body = Never
    let root: Root

    public func _render() -> [_Node] {
        let R = _R
        let nav = R.slot(_mix(R.path, 91)) { _Nav() }.value as! _Nav
        let prefs = _Prefs()
        let level = nav.stack.count
        let base = _mix(R.path, 92)
        for (i, e) in nav.stack.enumerated() where i < level - 1 { R.retain(_mix(base, e.id)) }
        if level > 0 { R.retain(_mix(base, 0)) }
        let ownerId = _mix(base, level == 0 ? 0 : nav.stack[level - 1].id)
        let parentDismiss = R.env[_Env.dismiss]
        let content: [_Node] = _withEnv({ e in
            e[_Env.nav] = nav
            e[_Env.prefs] = prefs
            e[_Env.proposal] = nil
            e[_Env.inList] = false
            e[_Env.buttonStyle] = nil
            e[_Env.buttonKind] = "auto"
            if level > 0 { e[_Env.dismiss] = DismissAction(f: { nav.pop() }) } else { e[_Env.dismiss] = parentDismiss }
        }) {
            R.owned(ownerId) {
                _at(ownerId) { _withAxis(.z) { level == 0 ? SwiftUI._render(root) : _renderAny(nav.stack[level - 1].view) } }
            }
        }
        let title = prefs.title ?? ""
        if level == 0 { nav.rootTitle = title } else { nav.stack[level - 1].title = title }
        var p: [String: _J] = ["title": .s(title), "lvl": .n(Double(level)), "k": .n(_id(ownerId))]
        if prefs.inline || level > 0 { p["inline"] = true }
        if prefs.barHidden { p["hidden"] = true }
        if level > 0, !prefs.backHidden {
            p["back"] = R.handler("back") { nav.pop() }
            p["backTitle"] = .s(level == 1 ? nav.rootTitle : nav.stack[level - 2].title)
        }
        let body = _Node("z", [:], content)
        body.gw = true; body.gh = true
        let n = _Node("nav", p, [body, _Node("h", [:], prefs.leading), _Node("h", [:], prefs.principal), _Node("h", [:], prefs.trailing), _Node("h", [:], prefs.bottom)])
        n.gw = true; n.gh = true
        return [n]
    }
}

extension NavigationStack where Data == NavigationPath {
    nonisolated public init(@ViewBuilder root: () -> Root) { self.root = root() }
    nonisolated public init(path: Binding<NavigationPath>, @ViewBuilder root: () -> Root) { self.root = root() }
}

public typealias NavigationView = NavigationStack

public struct NavigationLink<Label: View, Destination: View>: View, _Primitive {
    public typealias Body = Never
    let label: Label
    let destination: () -> Destination

    nonisolated public init(@ViewBuilder destination: @escaping () -> Destination, @ViewBuilder label: () -> Label) { self.destination = destination; self.label = label() }
    nonisolated public init(destination: Destination, @ViewBuilder label: () -> Label) { self.destination = { destination }; self.label = label() }

    public func _render() -> [_Node] {
        let env = _R.env
        let nav = env[_Env.nav]
        let dest = destination
        let h = _R.handler("tap") { nav?.push(dest()) }
        let kids: [_Node]
        var kind = env[_Env.buttonKind]
        if let style = env[_Env.buttonStyle] {
            kids = _withEnv({ $0[_Env.buttonStyle] = nil; $0[_Env.buttonKind] = "auto"; $0[_Env.inList] = false }) { _styled(style, label, nil) }
            kind = "custom"
        } else {
            kids = _withEnv({ $0[_Env.inList] = false }) { SwiftUI._render(label) }
        }
        let n = _Node("btn", ["tap": h, "kind": .s(kind)], kids)
        if env[_Env.inList] { n.p["row"] = true; n.p["chev"] = true; n.p["kind"] = "navrow" }
        if !env[_Env.isEnabled] { n.p["dis"] = true }
        n.gw = kids.contains { $0.gw } || env[_Env.inList]
        return [n]
    }
}

extension NavigationLink where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, @ViewBuilder destination: @escaping () -> Destination) { self.init(destination: destination) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, @ViewBuilder destination: @escaping () -> Destination) { self.init(destination: destination) { Text(title) } }
    nonisolated public init(_ title: LocalizedStringKey, destination: Destination) { self.init(destination: destination) { Text(title) } }
}

public enum NavigationBarItem { public enum TitleDisplayMode: Sendable { case automatic, inline, large } }
public struct ToolbarPlacement: Sendable {
    let k: String
    public static let navigationBar = ToolbarPlacement(k: "nav"), tabBar = ToolbarPlacement(k: "tab"), bottomBar = ToolbarPlacement(k: "bottom"), automatic = ToolbarPlacement(k: "auto")
}
public enum ToolbarRole: Sendable { case automatic, navigationStack, browser, editor }
public enum ToolbarTitleDisplayMode: Sendable { case automatic, large, inline, inlineLarge }

extension View {
    public func navigationTitle(_ t: LocalizedStringKey) -> some View { _wrap { n in _R.env[_Env.prefs]?.title = t.s; return n } }
    @_disfavoredOverload public func navigationTitle<S: StringProtocol>(_ t: S) -> some View { let s = String(t); return _wrap { n in _R.env[_Env.prefs]?.title = s; return n } }
    public func navigationTitle(_ t: Text) -> some View { _wrap { n in _R.env[_Env.prefs]?.title = t.plain; return n } }
    public func navigationBarTitle(_ t: LocalizedStringKey) -> some View { navigationTitle(t) }
    public func navigationBarTitleDisplayMode(_ m: NavigationBarItem.TitleDisplayMode) -> some View { _wrap { n in _R.env[_Env.prefs]?.inline = m == .inline; return n } }
    public func toolbarTitleDisplayMode(_ m: ToolbarTitleDisplayMode) -> some View { _wrap { n in _R.env[_Env.prefs]?.inline = m == .inline; return n } }
    public func navigationBarBackButtonHidden(_ h: Bool = true) -> some View { _wrap { n in if h { _R.env[_Env.prefs]?.backHidden = true }; return n } }
    public func navigationBarHidden(_ h: Bool) -> some View { _wrap { n in if h { _R.env[_Env.prefs]?.barHidden = true }; return n } }
    public func toolbar(_ v: Visibility, for bars: ToolbarPlacement...) -> some View {
        _wrap { n in
            guard v == .hidden else { return n }
            for b in bars {
                if b.k == "nav" { _R.env[_Env.prefs]?.barHidden = true }
                if b.k == "tab" { _tabBarHidden = true }
            }
            return n
        }
    }
    public func toolbarBackground<S: ShapeStyle>(_ s: S, for bars: ToolbarPlacement...) -> some View { self }
    public func toolbarBackground(_ v: Visibility, for bars: ToolbarPlacement...) -> some View { self }
    public func toolbarBackgroundVisibility(_ v: Visibility, for bars: ToolbarPlacement...) -> some View { self }
    public func toolbarColorScheme(_ s: ColorScheme?, for bars: ToolbarPlacement...) -> some View { self }
    public func toolbarRole(_ r: ToolbarRole) -> some View { self }
    public func navigationDestination<D: Hashable, C: View>(for data: D.Type, @ViewBuilder destination: @escaping (D) -> C) -> some View { self }
    public func navigationDestination<V: View>(isPresented: Binding<Bool>, @ViewBuilder destination: () -> V) -> some View {
        _Pushed(content: self, on: isPresented.wrappedValue, close: { isPresented.wrappedValue = false }, dest: destination())
    }
    public func searchable(text: Binding<String>, placement: Any? = nil, prompt: LocalizedStringKey = "Suchen") -> some View { self }

    public func toolbar<C: ToolbarContent>(@ToolbarContentBuilder content: () -> C) -> some View {
        let items = content()._items
        return _Mod(content: self, wrap: { nodes in
            guard let prefs = _R.env[_Env.prefs] else { return nodes }
            for (i, item) in items.enumerated() {
                let kids = _at(UInt64(900 + i)) { _withAxis(.h) {
                    _withEnv({ e in e[_Env.inToolbar] = true; e[_Env.buttonStyle] = nil; e[_Env.buttonKind] = "auto"; e[_Env.inList] = false; e[_Env.labelStyle] = "icon" }) { _renderAny(item.view) }
                } }
                switch item.placement.k {
                case "leading", "cancel": prefs.leading += kids
                case "principal": prefs.principal += kids
                case "bottom", "status": prefs.bottom += kids
                case "keyboard": break
                case "confirm": prefs.trailing += _css(kids, .inherit, [("font-weight", "600")])
                default: prefs.trailing += kids
                }
            }
            return nodes
        })
    }
}

/** navigationDestination(isPresented:): schiebt die Seite auf den Stapel, solange das Binding an ist */
struct _Pushed<C: View, D: View>: View, _Primitive {
    typealias Body = Never
    let content: C, on: Bool, close: () -> Void, dest: D
    func _render() -> [_Node] {
        _at(58) {
            let nodes = SwiftUI._render(content)
            guard let nav = _R.env[_Env.nav] else { return nodes }
            let l = _R.life(_R.path)
            let was = l.last as? Bool ?? false
            if on, !was { let d = dest; _R.post.append { nav.push(d) } }
            l.last = on
            return nodes
        }
    }
}

@MainActor var _tabBarHidden = false

// MARK: Leisten-Inhalt

public struct ToolbarItemPlacement: Sendable {
    let k: String
    public static let automatic = ToolbarItemPlacement(k: "auto"), principal = ToolbarItemPlacement(k: "principal")
    public static let navigation = ToolbarItemPlacement(k: "leading"), primaryAction = ToolbarItemPlacement(k: "trailing"), secondaryAction = ToolbarItemPlacement(k: "trailing")
    public static let confirmationAction = ToolbarItemPlacement(k: "confirm"), cancellationAction = ToolbarItemPlacement(k: "cancel"), destructiveAction = ToolbarItemPlacement(k: "trailing")
    public static let topBarLeading = ToolbarItemPlacement(k: "leading"), topBarTrailing = ToolbarItemPlacement(k: "trailing")
    public static let navigationBarLeading = ToolbarItemPlacement(k: "leading"), navigationBarTrailing = ToolbarItemPlacement(k: "trailing")
    public static let bottomBar = ToolbarItemPlacement(k: "bottom"), keyboard = ToolbarItemPlacement(k: "keyboard"), status = ToolbarItemPlacement(k: "status")
}

public struct _ToolbarEntry {
    let placement: ToolbarItemPlacement
    let view: any View
}

@MainActor public protocol ToolbarContent {
    var _items: [_ToolbarEntry] { get }
}

public struct ToolbarItem<ID, Content: View>: ToolbarContent {
    let placement: ToolbarItemPlacement
    let content: Content
    public var _items: [_ToolbarEntry] { [_ToolbarEntry(placement: placement, view: content)] }
}

extension ToolbarItem where ID == () {
    nonisolated public init(placement: ToolbarItemPlacement = .automatic, @ViewBuilder content: () -> Content) { self.placement = placement; self.content = content() }
}

public struct ToolbarItemGroup<Content: View>: ToolbarContent {
    let placement: ToolbarItemPlacement
    let content: Content
    nonisolated public init(placement: ToolbarItemPlacement = .automatic, @ViewBuilder content: () -> Content) { self.placement = placement; self.content = content() }
    public var _items: [_ToolbarEntry] { [_ToolbarEntry(placement: placement, view: content)] }
}

public struct _ToolbarList: ToolbarContent {
    public let _items: [_ToolbarEntry]
}

@MainActor @resultBuilder public struct ToolbarContentBuilder {
    public static func buildBlock() -> _ToolbarList { _ToolbarList(_items: []) }
    public static func buildBlock<each C: ToolbarContent>(_ c: repeat each C) -> _ToolbarList {
        var list: [_ToolbarEntry] = []
        repeat list.append(contentsOf: (each c)._items)
        return _ToolbarList(_items: list)
    }
    public static func buildExpression<C: ToolbarContent>(_ c: C) -> C { c }
    @_disfavoredOverload public static func buildExpression<V: View>(_ v: V) -> _ToolbarList { _ToolbarList(_items: [_ToolbarEntry(placement: .automatic, view: v)]) }
    public static func buildIf<C: ToolbarContent>(_ c: C?) -> _ToolbarList { _ToolbarList(_items: c?._items ?? []) }
    public static func buildEither<A: ToolbarContent>(first: A) -> _ToolbarList { _ToolbarList(_items: first._items) }
    public static func buildEither<B: ToolbarContent>(second: B) -> _ToolbarList { _ToolbarList(_items: second._items) }
    public static func buildLimitedAvailability<C: ToolbarContent>(_ c: C) -> _ToolbarList { _ToolbarList(_items: c._items) }
}

// MARK: Tabs

public struct TabView<SelectionValue: Hashable, Content: View>: View, _Primitive {
    public typealias Body = Never
    let selection: Binding<SelectionValue>?
    let content: Content

    nonisolated public init(selection: Binding<SelectionValue>?, @ViewBuilder content: () -> Content) { self.selection = selection; self.content = content() }

    public func _render() -> [_Node] {
        let R = _R
        let kids = _children(content)
        let own = R.slot(_mix(R.path, 93)) { 0 }
        var index = own.value as? Int ?? 0
        if let selection {
            let cur = AnyHashable(selection.wrappedValue)
            index = kids.firstIndex { c in (c.traits["tag"] as? AnyHashable).map { _same($0, cur) } ?? false } ?? 0
        }
        index = min(index, max(0, kids.count - 1))
        let sel = selection
        let h = R.handler("tab") { (v: _J) in
            guard let i = v.number.map({ Int($0) }), kids.indices.contains(i) else { return }
            if let sel, let tag = kids[i].traits["tag"] as? AnyHashable, let value = tag.base as? SelectionValue { sel.wrappedValue = value }
            else { own.value = i; _R.invalidate() }
        }
        let base = _mix(R.path, 94)
        for (i, c) in kids.enumerated() where i != index { R.retain(_mix(base, c.key)) }
        _tabBarHidden = false
        var body: [_Node] = []
        if kids.indices.contains(index) {
            let c = kids[index]
            body = _withEnv({ $0[_Env.proposal] = nil }) { R.owned(_mix(base, c.key)) { _withAxis(.z) { _renderChild(c) } } }
        }
        let page = _Node("z", [:], body)
        page.gw = true; page.gh = true
        page.p["k"] = .n(Double(index))
        var items: [_Node] = []
        for (i, c) in kids.enumerated() {
            let label = (c.traits["tabItem"] as? any View).map { v in _at(_mix(c.key, 95)) { _withEnv({ $0[_Env.labelStyle] = "both" }) { _renderAny(v) } } } ?? []
            let t = _Node("tab", ["on": .b(i == index)], label)
            if let b = c.traits["badge"] as? String, !b.isEmpty { t.p["badge"] = .s(b) }
            items.append(t)
        }
        let n = _Node("tabs", ["h": h, "sel": .n(Double(index))], [page] + items)
        if _tabBarHidden { n.p["hidden"] = true }
        n.gw = true; n.gh = true
        return [n]
    }
}

extension TabView where SelectionValue == Int {
    nonisolated public init(@ViewBuilder content: () -> Content) { self.init(selection: nil, content: content) }
}

public protocol TabViewStyle {}
public struct DefaultTabViewStyle: TabViewStyle { public init() {} }
public struct PageTabViewStyle: TabViewStyle {
    public enum IndexDisplayMode: Sendable { case automatic, always, never }
    nonisolated public init(indexDisplayMode: IndexDisplayMode = .automatic) {}
}
extension TabViewStyle where Self == DefaultTabViewStyle { public static var automatic: DefaultTabViewStyle { .init() } }
extension TabViewStyle where Self == PageTabViewStyle {
    public static var page: PageTabViewStyle { .init() }
    public static func page(indexDisplayMode: PageTabViewStyle.IndexDisplayMode) -> PageTabViewStyle { .init() }
}
extension View { public func tabViewStyle<S: TabViewStyle>(_ s: S) -> some View { self } }

// MARK: Sheets

public struct PresentationDetent: Hashable, Sendable {
    let k: String
    public static let medium = PresentationDetent(k: "0.5"), large = PresentationDetent(k: "1")
    public static func fraction(_ f: CGFloat) -> PresentationDetent { PresentationDetent(k: _num(Double(f))) }
    public static func height(_ h: CGFloat) -> PresentationDetent { PresentationDetent(k: _px(h)) }
}

struct _SheetMod<C: View>: View, _Primitive {
    typealias Body = Never
    let content: C
    let presented: () -> (key: UInt64, view: any View)?
    let close: () -> Void
    let full: Bool
    var onDismiss: (() -> Void)?

    func _render() -> [_Node] {
        let nodes = _at(51) { SwiftUI._render(content) }
        guard let p = presented() else { return nodes }
        _at(_mix(52, p.key)) {
            let R = _R
            let prefs = _SheetPrefs()
            let closeNow = close, done = onDismiss
            let dismiss = { closeNow(); done?() }
            let node = _Node("sheet", ["k": .n(_id(R.path))])
            if full { node.p["full"] = true }
            R.portals.append(node)
            let kids = _withEnv({ e in
                e[_Env.dismiss] = DismissAction(f: dismiss)
                e[_Env.isPresented] = true
                e[_Env.nav] = nil; e[_Env.prefs] = nil; e[_Env.sheetPrefs] = prefs; e[_Env.proposal] = nil
                e[_Env.inList] = false; e[_Env.buttonStyle] = nil; e[_Env.buttonKind] = "auto"; e[_Env.refresh] = nil
                e[_Env.isEnabled] = true; e[_Env.labelStyle] = "auto"; e[_Env.pickerStyle] = "auto"; e[_Env.afterTap] = nil
            }) { _withAxis(.z) { _renderAny(p.view) } }
            node.c = kids
            node.p["dismiss"] = R.handler("dismiss") { dismiss() }
            if !prefs.detents.isEmpty { node.p["detents"] = .a(prefs.detents.map { .s($0) }) }
            if prefs.locked { node.p["locked"] = true }
        }
        return nodes
    }
}

extension View {
    public func sheet<V: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> V) -> some View {
        _SheetMod(content: self, presented: { isPresented.wrappedValue ? (1, content()) : nil }, close: { isPresented.wrappedValue = false }, full: false, onDismiss: onDismiss)
    }
    public func sheet<Item: Identifiable, V: View>(item: Binding<Item?>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping (Item) -> V) -> some View {
        _SheetMod(content: self, presented: { item.wrappedValue.map { (_hash($0.id), content($0)) } }, close: { item.wrappedValue = nil }, full: false, onDismiss: onDismiss)
    }
    public func fullScreenCover<V: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> V) -> some View {
        _SheetMod(content: self, presented: { isPresented.wrappedValue ? (1, content()) : nil }, close: { isPresented.wrappedValue = false }, full: true, onDismiss: onDismiss)
    }
    public func fullScreenCover<Item: Identifiable, V: View>(item: Binding<Item?>, onDismiss: (() -> Void)? = nil, @ViewBuilder content: @escaping (Item) -> V) -> some View {
        _SheetMod(content: self, presented: { item.wrappedValue.map { (_hash($0.id), content($0)) } }, close: { item.wrappedValue = nil }, full: true, onDismiss: onDismiss)
    }
    public func popover<V: View>(isPresented: Binding<Bool>, attachmentAnchor: Any? = nil, arrowEdge: Edge = .top, @ViewBuilder content: @escaping () -> V) -> some View {
        sheet(isPresented: isPresented, content: content)
    }
    public func presentationDetents(_ d: Set<PresentationDetent>) -> some View { _wrap { n in _R.env[_Env.sheetPrefs]?.detents = d.map(\.k).sorted(); return n } }
    public func presentationDetents(_ d: Set<PresentationDetent>, selection: Binding<PresentationDetent>) -> some View { presentationDetents(d) }
    public func presentationDragIndicator(_ v: Visibility) -> some View { self }
    public func presentationBackground<S: ShapeStyle>(_ s: S) -> some View { self }
    public func presentationCornerRadius(_ r: CGFloat?) -> some View { self }
    public func presentationBackgroundInteraction(_ i: Any) -> some View { self }
    public func presentationContentInteraction(_ i: Any) -> some View { self }
    public func presentationCompactAdaptation(_ a: Any) -> some View { self }
    public func presentationSizing(_ s: Any) -> some View { self }
    public func interactiveDismissDisabled(_ d: Bool = true) -> some View { _wrap { n in if d { _R.env[_Env.sheetPrefs]?.locked = true }; return n } }
}

// MARK: Hinweise und Auswahl-Dialoge

struct _DialogMod<C: View>: View, _Primitive {
    typealias Body = Never
    let content: C
    let kind: String
    let title: String
    let titleVisible: Bool
    let presented: () -> Bool
    let close: () -> Void
    let actions: () -> any View
    let message: () -> (any View)?

    func _render() -> [_Node] {
        let nodes = _at(51) { SwiftUI._render(content) }
        guard presented() else { return nodes }
        _at(52) {
            let closeNow = close
            let env: (inout EnvironmentValues) -> Void = { e in
                e[_Env.buttonStyle] = nil; e[_Env.buttonKind] = "dialog"; e[_Env.inList] = false; e[_Env.afterTap] = closeNow
                e[_Env.isEnabled] = true; e[_Env.labelStyle] = "auto"; e[_Env.proposal] = nil
            }
            let acts = _at(1) { _withAxis(.v) { _withEnv(env) { _renderAny(actions()) } } }
            let msg = _at(2) { message().map { m in _withEnv({ $0[_Env.buttonKind] = "auto"; $0[_Env.proposal] = nil }) { _renderAny(m) } } ?? [] }
            let n = _Node(kind, ["title": .s(titleVisible ? title : ""), "dismiss": _R.handler("dismiss") { closeNow() }],
                          [_Node("v", [:], msg), _Node("v", [:], acts)])
            _R.portals.append(n)
        }
        return nodes
    }
}

extension View {
    public func alert<A: View, M: View>(_ title: LocalizedStringKey, isPresented: Binding<Bool>, @ViewBuilder actions: @escaping () -> A, @ViewBuilder message: @escaping () -> M) -> some View {
        _DialogMod(content: self, kind: "alert", title: title.s, titleVisible: true, presented: { isPresented.wrappedValue }, close: { isPresented.wrappedValue = false }, actions: { actions() }, message: { message() })
    }
    @_disfavoredOverload public func alert<S: StringProtocol, A: View, M: View>(_ title: S, isPresented: Binding<Bool>, @ViewBuilder actions: @escaping () -> A, @ViewBuilder message: @escaping () -> M) -> some View {
        _DialogMod(content: self, kind: "alert", title: String(title), titleVisible: true, presented: { isPresented.wrappedValue }, close: { isPresented.wrappedValue = false }, actions: { actions() }, message: { message() })
    }
    public func alert<A: View>(_ title: LocalizedStringKey, isPresented: Binding<Bool>, @ViewBuilder actions: @escaping () -> A) -> some View {
        _DialogMod(content: self, kind: "alert", title: title.s, titleVisible: true, presented: { isPresented.wrappedValue }, close: { isPresented.wrappedValue = false }, actions: { actions() }, message: { nil })
    }
    @_disfavoredOverload public func alert<S: StringProtocol, A: View>(_ title: S, isPresented: Binding<Bool>, @ViewBuilder actions: @escaping () -> A) -> some View {
        _DialogMod(content: self, kind: "alert", title: String(title), titleVisible: true, presented: { isPresented.wrappedValue }, close: { isPresented.wrappedValue = false }, actions: { actions() }, message: { nil })
    }
    public func alert<A: View, M: View, T>(_ title: LocalizedStringKey, isPresented: Binding<Bool>, presenting data: T?, @ViewBuilder actions: @escaping (T) -> A, @ViewBuilder message: @escaping (T) -> M) -> some View {
        _DialogMod(content: self, kind: "alert", title: title.s, titleVisible: true, presented: { isPresented.wrappedValue && data != nil }, close: { isPresented.wrappedValue = false },
                   actions: { data.map { actions($0) as any View } ?? EmptyView() }, message: { data.map { message($0) as any View } })
    }
    @_disfavoredOverload public func alert<S: StringProtocol, A: View, M: View, T>(_ title: S, isPresented: Binding<Bool>, presenting data: T?, @ViewBuilder actions: @escaping (T) -> A, @ViewBuilder message: @escaping (T) -> M) -> some View {
        _DialogMod(content: self, kind: "alert", title: String(title), titleVisible: true, presented: { isPresented.wrappedValue && data != nil }, close: { isPresented.wrappedValue = false },
                   actions: { data.map { actions($0) as any View } ?? EmptyView() }, message: { data.map { message($0) as any View } })
    }
    public func alert<A: View, T>(_ title: LocalizedStringKey, isPresented: Binding<Bool>, presenting data: T?, @ViewBuilder actions: @escaping (T) -> A) -> some View {
        _DialogMod(content: self, kind: "alert", title: title.s, titleVisible: true, presented: { isPresented.wrappedValue && data != nil }, close: { isPresented.wrappedValue = false },
                   actions: { data.map { actions($0) as any View } ?? EmptyView() }, message: { nil })
    }
    public func alert<E: LocalizedError, A: View>(isPresented: Binding<Bool>, error: E?, @ViewBuilder actions: @escaping () -> A) -> some View {
        _DialogMod(content: self, kind: "alert", title: error?.errorDescription ?? "", titleVisible: true, presented: { isPresented.wrappedValue && error != nil }, close: { isPresented.wrappedValue = false }, actions: { actions() }, message: { nil })
    }

    public func confirmationDialog<A: View, M: View>(_ title: LocalizedStringKey, isPresented: Binding<Bool>, titleVisibility: Visibility = .automatic, @ViewBuilder actions: @escaping () -> A, @ViewBuilder message: @escaping () -> M) -> some View {
        _DialogMod(content: self, kind: "dialog", title: title.s, titleVisible: titleVisibility == .visible, presented: { isPresented.wrappedValue }, close: { isPresented.wrappedValue = false }, actions: { actions() }, message: { message() })
    }
    @_disfavoredOverload public func confirmationDialog<S: StringProtocol, A: View, M: View>(_ title: S, isPresented: Binding<Bool>, titleVisibility: Visibility = .automatic, @ViewBuilder actions: @escaping () -> A, @ViewBuilder message: @escaping () -> M) -> some View {
        _DialogMod(content: self, kind: "dialog", title: String(title), titleVisible: titleVisibility == .visible, presented: { isPresented.wrappedValue }, close: { isPresented.wrappedValue = false }, actions: { actions() }, message: { message() })
    }
    public func confirmationDialog<A: View>(_ title: LocalizedStringKey, isPresented: Binding<Bool>, titleVisibility: Visibility = .automatic, @ViewBuilder actions: @escaping () -> A) -> some View {
        _DialogMod(content: self, kind: "dialog", title: title.s, titleVisible: titleVisibility == .visible, presented: { isPresented.wrappedValue }, close: { isPresented.wrappedValue = false }, actions: { actions() }, message: { nil })
    }
    @_disfavoredOverload public func confirmationDialog<S: StringProtocol, A: View>(_ title: S, isPresented: Binding<Bool>, titleVisibility: Visibility = .automatic, @ViewBuilder actions: @escaping () -> A) -> some View {
        _DialogMod(content: self, kind: "dialog", title: String(title), titleVisible: titleVisibility == .visible, presented: { isPresented.wrappedValue }, close: { isPresented.wrappedValue = false }, actions: { actions() }, message: { nil })
    }
    public func confirmationDialog<A: View, M: View, T>(_ title: LocalizedStringKey, isPresented: Binding<Bool>, titleVisibility: Visibility = .automatic, presenting data: T?, @ViewBuilder actions: @escaping (T) -> A, @ViewBuilder message: @escaping (T) -> M) -> some View {
        _DialogMod(content: self, kind: "dialog", title: title.s, titleVisible: titleVisibility == .visible, presented: { isPresented.wrappedValue && data != nil }, close: { isPresented.wrappedValue = false },
                   actions: { data.map { actions($0) as any View } ?? EmptyView() }, message: { data.map { message($0) as any View } })
    }
    @_disfavoredOverload public func confirmationDialog<S: StringProtocol, A: View, T>(_ title: S, isPresented: Binding<Bool>, titleVisibility: Visibility = .automatic, presenting data: T?, @ViewBuilder actions: @escaping (T) -> A) -> some View {
        _DialogMod(content: self, kind: "dialog", title: String(title), titleVisible: titleVisibility == .visible, presented: { isPresented.wrappedValue && data != nil }, close: { isPresented.wrappedValue = false },
                   actions: { data.map { actions($0) as any View } ?? EmptyView() }, message: { nil })
    }
    public func confirmationDialog<A: View, T>(_ title: LocalizedStringKey, isPresented: Binding<Bool>, titleVisibility: Visibility = .automatic, presenting data: T?, @ViewBuilder actions: @escaping (T) -> A) -> some View {
        _DialogMod(content: self, kind: "dialog", title: title.s, titleVisible: titleVisibility == .visible, presented: { isPresented.wrappedValue && data != nil }, close: { isPresented.wrappedValue = false },
                   actions: { data.map { actions($0) as any View } ?? EmptyView() }, message: { nil })
    }
}
