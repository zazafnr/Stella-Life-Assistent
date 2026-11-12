// State, Binding, Environment und Verwandte

@MainActor func _stateChanged(_ slot: _Slot?) {
    let R = _R
    if let a = R.txAnim {
        if let slot { slot.anim = a; R.animSlots.append(slot) }
        if R.globalAnim == nil { R.globalAnim = a._once }
    }
    R.invalidate()
}

@propertyWrapper public struct State<Value>: _DynProp {
    final class Box { var value: Value; var slot: _Slot?; init(_ v: Value) { value = v } }
    let box: Box

    nonisolated public init(wrappedValue: Value) { box = Box(wrappedValue) }
    nonisolated public init(initialValue: Value) { box = Box(initialValue) }
    nonisolated public init<V>() where Value == V? { box = Box(nil) }

    public var wrappedValue: Value {
        get { MainActor.assumeIsolated { (box.slot?.value as? Value) ?? box.value } }
        nonmutating set {
            MainActor.assumeIsolated {
                if let s = box.slot { s.value = newValue } else { box.value = newValue }
                _stateChanged(box.slot)
            }
        }
    }

    public var projectedValue: Binding<Value> {
        let b = box
        return Binding(get: { MainActor.assumeIsolated { (b.slot?.value as? Value) ?? b.value } },
                       set: { v in MainActor.assumeIsolated { if let s = b.slot { s.value = v } else { b.value = v }; _stateChanged(b.slot) } })
    }

    func _link(_ key: UInt64) {
        let s = _R.slot(key) { box.value }
        box.slot = s
        if let a = s.anim { _R.curAnim = a }
    }
}

@propertyWrapper @dynamicMemberLookup public struct Binding<Value> {
    let getter: () -> Value
    let setter: (Value) -> Void

    nonisolated public init(get: @escaping () -> Value, set: @escaping (Value) -> Void) { getter = get; setter = set }
    nonisolated public init(projectedValue: Binding<Value>) { self = projectedValue }

    public var wrappedValue: Value {
        get { getter() }
        nonmutating set { setter(newValue) }
    }
    public var projectedValue: Binding<Value> { self }

    public static func constant(_ v: Value) -> Binding<Value> { Binding(get: { v }, set: { _ in }) }

    public subscript<T>(dynamicMember kp: WritableKeyPath<Value, T>) -> Binding<T> {
        Binding<T>(get: { self.getter()[keyPath: kp] }, set: { v in var x = self.getter(); x[keyPath: kp] = v; self.setter(x) })
    }

    public func animation(_ a: Animation? = .default) -> Binding<Value> {
        Binding(get: getter, set: { v in withAnimation(a) { self.setter(v) } })
    }

    /** Binding<T> → Binding<T?> */
    nonisolated public init<V>(_ base: Binding<V>) where Value == V? {
        self.init(get: { base.wrappedValue }, set: { if let v = $0 { base.wrappedValue = v } })
    }
}

extension Binding: @unchecked Sendable {}

extension Binding: Identifiable where Value: Identifiable {
    public var id: Value.ID { wrappedValue.id }
}

// MARK: Bindable (für @Observable-Objekte)

@propertyWrapper @dynamicMemberLookup public struct Bindable<Value: AnyObject> {
    public var wrappedValue: Value
    nonisolated public init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
    nonisolated public init(_ v: Value) { wrappedValue = v }
    public var projectedValue: Bindable<Value> { self }
    public subscript<T>(dynamicMember kp: ReferenceWritableKeyPath<Value, T>) -> Binding<T> {
        let o = wrappedValue
        return Binding(get: { o[keyPath: kp] }, set: { o[keyPath: kp] = $0; MainActor.assumeIsolated { _stateChanged(nil) } })
    }
}

// MARK: Environment

public protocol EnvironmentKey {
    associatedtype Value
    static var defaultValue: Value { get }
}

public struct EnvironmentValues {
    var s: [ObjectIdentifier: Any] = [:]
    nonisolated public init() {}

    public subscript<K: EnvironmentKey>(key: K.Type) -> K.Value {
        get { s[ObjectIdentifier(key)] as? K.Value ?? K.defaultValue }
        set { s[ObjectIdentifier(key)] = newValue }
    }

    subscript<T>(_ name: _EnvName<T>) -> T {
        get { s[ObjectIdentifier(name)] as? T ?? name.fallback }
        set { s[ObjectIdentifier(name)] = newValue }
    }
}

/** Eingebaute Werte der Umgebung */
final class _EnvName<T> {
    let fallback: T
    init(_ f: T) { fallback = f }
}

@propertyWrapper public struct Environment<Value>: _DynProp {
    final class Box { var env: EnvironmentValues? }
    let read: (EnvironmentValues) -> Value
    let box = Box()

    nonisolated public init(_ kp: KeyPath<EnvironmentValues, Value>) { read = { $0[keyPath: kp] } }

    nonisolated public init(_ type: Value.Type) where Value: AnyObject, Value: Observable {
        read = { e in
            guard let v = e.s[ObjectIdentifier(type)] as? Value else { fatalError("Kein \(type) in der Umgebung – .environment(…) fehlt") }
            return v
        }
    }

    nonisolated public init<T: AnyObject & Observable>(_ type: T.Type) where Value == T? {
        read = { e in e.s[ObjectIdentifier(type)] as? T }
    }

    public var wrappedValue: Value {
        MainActor.assumeIsolated { read(box.env ?? _R.env) }
    }

    func _link(_ key: UInt64) { box.env = _R.env }
}

extension View {
    public func environment<T: AnyObject & Observable>(_ object: T?) -> some View {
        _env { e in e.s[ObjectIdentifier(T.self)] = object }
    }

    public func environment<V>(_ kp: WritableKeyPath<EnvironmentValues, V>, _ value: V) -> some View {
        _env { e in e[keyPath: kp] = value }
    }
}

// MARK: eingebaute Umgebungswerte

public enum ScenePhase: Comparable, Hashable, Sendable { case background, inactive, active }
public enum ColorScheme: Hashable, CaseIterable, Sendable { case light, dark }
public enum UserInterfaceSizeClass: Hashable, Sendable { case compact, regular }
public enum LayoutDirection: Hashable, Sendable { case leftToRight, rightToLeft }
public enum DynamicTypeSize: Hashable, Comparable, CaseIterable, Sendable {
    case xSmall, small, medium, large, xLarge, xxLarge, xxxLarge, accessibility1, accessibility2, accessibility3, accessibility4, accessibility5
    public var isAccessibilitySize: Bool { self >= .accessibility1 }
}

public struct DismissAction {
    let f: () -> Void
    public func callAsFunction() { f() }
}

public struct OpenURLAction {
    public struct Result { public static let handled = Result(); public static let discarded = Result(); public static let systemAction = Result() }
    let f: (URL) -> Void
    nonisolated public init(handler: @escaping (URL) -> Result) { f = { _ = handler($0) } }
    init(f: @escaping (URL) -> Void) { self.f = f }
    public func callAsFunction(_ url: URL) { f(url) }
}

public struct RefreshAction {
    let f: () async -> Void
    public func callAsFunction() async { await f() }
}

@MainActor enum _Env {
    static let scenePhase = _EnvName<ScenePhase>(.active)
    static let reduceMotion = _EnvName<Bool>(false)
    static let colorScheme = _EnvName<ColorScheme>(.light)
    static let dismiss = _EnvName<DismissAction>(DismissAction(f: {}))
    static let isPresented = _EnvName<Bool>(false)
    static let isEnabled = _EnvName<Bool>(true)
    static let locale = _EnvName<Locale>(.current)
    static let refresh = _EnvName<RefreshAction?>(nil)
    static let openURL = _EnvName<OpenURLAction?>(nil)
    static let buttonStyle = _EnvName<(any ButtonStyle)?>(nil)
    static let buttonKind = _EnvName<String>("auto")
    static let labelStyle = _EnvName<String>("auto")
    static let pickerStyle = _EnvName<String>("auto")
    static let inList = _EnvName<Bool>(false)
    static let nav = _EnvName<_Nav?>(nil)
    static let font = _EnvName<Font?>(nil)
    static let lineLimit = _EnvName<Int?>(nil)
    static let controlSize = _EnvName<ControlSize>(.regular)
    static let inToolbar = _EnvName<Bool>(false)
    static let foreground = _EnvName<Color?>(nil)
}

extension EnvironmentValues {
    public var scenePhase: ScenePhase { get { MainActor.assumeIsolated { _Scene.phase } } set {} }
    public var accessibilityReduceMotion: Bool { get { MainActor.assumeIsolated { self[_Env.reduceMotion] } } set { MainActor.assumeIsolated { self[_Env.reduceMotion] = newValue } } }
    public var colorScheme: ColorScheme { get { MainActor.assumeIsolated { self[_Env.colorScheme] } } set { MainActor.assumeIsolated { self[_Env.colorScheme] = newValue } } }
    public var dismiss: DismissAction { MainActor.assumeIsolated { self[_Env.dismiss] } }
    public var isPresented: Bool { MainActor.assumeIsolated { self[_Env.isPresented] } }
    public var isEnabled: Bool { get { MainActor.assumeIsolated { self[_Env.isEnabled] } } set { MainActor.assumeIsolated { self[_Env.isEnabled] = newValue } } }
    public var locale: Locale { get { MainActor.assumeIsolated { self[_Env.locale] } } set { MainActor.assumeIsolated { self[_Env.locale] = newValue } } }
    public var calendar: Calendar { get { .current } set {} }
    public var timeZone: TimeZone { get { .current } set {} }
    public var refresh: RefreshAction? { MainActor.assumeIsolated { self[_Env.refresh] } }
    public var horizontalSizeClass: UserInterfaceSizeClass? { get { .compact } set {} }
    public var verticalSizeClass: UserInterfaceSizeClass? { get { .regular } set {} }
    public var layoutDirection: LayoutDirection { get { .leftToRight } set {} }
    public var dynamicTypeSize: DynamicTypeSize { get { .large } set {} }
    public var displayScale: CGFloat { get { 3 } set {} }
    public var pixelLength: CGFloat { 1.0 / 3 }
    public var font: Font? { get { MainActor.assumeIsolated { self[_Env.font] } } set { MainActor.assumeIsolated { self[_Env.font] = newValue } } }
    public var lineLimit: Int? { get { MainActor.assumeIsolated { self[_Env.lineLimit] } } set { MainActor.assumeIsolated { self[_Env.lineLimit] = newValue } } }
    public var openURL: OpenURLAction {
        get { MainActor.assumeIsolated { self[_Env.openURL] ?? OpenURLAction(f: { url in _R.message(["k": "open", "url": .s(url.absoluteString)]) }) } }
        set { MainActor.assumeIsolated { self[_Env.openURL] = newValue } }
    }
}

// MARK: AppStorage

@propertyWrapper public struct AppStorage<Value>: _DynProp {
    let key: String
    let fallback: Value
    let store: UserDefaults
    let readValue: (UserDefaults, String) -> Value?
    let writeValue: (UserDefaults, String, Value) -> Void

    init(_ key: String, _ fallback: Value, _ store: UserDefaults?, read: @escaping (UserDefaults, String) -> Value?, write: @escaping (UserDefaults, String, Value) -> Void) {
        self.key = key; self.fallback = fallback; self.store = store ?? .standard; readValue = read; writeValue = write
    }

    public var wrappedValue: Value {
        get { readValue(store, key) ?? fallback }
        nonmutating set { writeValue(store, key, newValue); MainActor.assumeIsolated { _stateChanged(nil) } }
    }

    public var projectedValue: Binding<Value> {
        let s = self
        return Binding(get: { s.wrappedValue }, set: { s.wrappedValue = $0 })
    }

    func _link(_ key: UInt64) {}
}

extension AppStorage {
    nonisolated public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == Bool {
        self.init(key, wrappedValue, store, read: { $0.object(forKey: $1) as? Bool }, write: { $0.set($2, forKey: $1) })
    }
    nonisolated public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == Int {
        self.init(key, wrappedValue, store, read: { $0.object(forKey: $1) as? Int }, write: { $0.set($2, forKey: $1) })
    }
    nonisolated public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == Double {
        self.init(key, wrappedValue, store, read: { $0.object(forKey: $1) as? Double }, write: { $0.set($2, forKey: $1) })
    }
    nonisolated public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == String {
        self.init(key, wrappedValue, store, read: { $0.string(forKey: $1) }, write: { $0.set($2, forKey: $1) })
    }
    nonisolated public init(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == Data {
        self.init(key, wrappedValue, store, read: { $0.data(forKey: $1) }, write: { $0.set($2, forKey: $1) })
    }
    nonisolated public init(_ key: String, store: UserDefaults? = nil) where Value == String? {
        self.init(key, nil, store, read: { $0.string(forKey: $1) }, write: { if let v = $2 { $0.set(v, forKey: $1) } else { $0.removeObject(forKey: $1) } })
    }
    nonisolated public init<R: RawRepresentable>(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == R, R.RawValue == String {
        self.init(key, wrappedValue, store, read: { $0.string(forKey: $1).flatMap(R.init(rawValue:)) }, write: { $0.set($2.rawValue, forKey: $1) })
    }
    nonisolated public init<R: RawRepresentable>(wrappedValue: Value, _ key: String, store: UserDefaults? = nil) where Value == R, R.RawValue == Int {
        self.init(key, wrappedValue, store, read: { ($0.object(forKey: $1) as? Int).flatMap(R.init(rawValue:)) }, write: { $0.set($2.rawValue, forKey: $1) })
    }
}

// MARK: FocusState

@propertyWrapper public struct FocusState<Value: Hashable>: _DynProp {
    final class Box { var value: Value; var slot: _Slot?; init(_ v: Value) { value = v } }
    let box: Box

    nonisolated public init() where Value == Bool { box = Box(false) }
    nonisolated public init<T: Hashable>() where Value == T? { box = Box(nil) }

    public var wrappedValue: Value {
        get { MainActor.assumeIsolated { (box.slot?.value as? Value) ?? box.value } }
        nonmutating set {
            MainActor.assumeIsolated {
                if let s = box.slot { s.value = newValue } else { box.value = newValue }
                _R.invalidate()
            }
        }
    }

    public var projectedValue: Binding { Binding(state: self) }

    public struct Binding {
        let state: FocusState<Value>
        public var wrappedValue: Value {
            get { state.wrappedValue }
            nonmutating set { state.wrappedValue = newValue }
        }
    }

    func _link(_ key: UInt64) { box.slot = _R.slot(key) { box.value } }
}

extension View {
    public func focused(_ b: FocusState<Bool>.Binding) -> some View {
        _FocusMod(content: self, isOn: { b.wrappedValue }, set: { b.wrappedValue = $0 })
    }

    public func focused<V: Hashable>(_ b: FocusState<V?>.Binding, equals value: V) -> some View {
        _FocusMod(content: self, isOn: { b.wrappedValue == value }, set: { on in
            if on { b.wrappedValue = value } else if b.wrappedValue == value { b.wrappedValue = nil }
        })
    }
}

struct _FocusMod<C: View>: View, _Primitive {
    typealias Body = Never
    let content: C
    let isOn: () -> Bool
    let set: (Bool) -> Void
    func _render() -> [_Node] {
        _at(43) {
            let nodes = SwiftUI._render(content)
            let h = _R.handler("focus") { (v: _J) in
                let on = v.bool ?? false
                if isOn() != on { set(on) }
            }
            let on = isOn()
            return nodes.map { n in
                let w = _Node("css", ["fc": h, "fo": .b(on)], [n])
                w.gw = n.gw; w.gh = n.gh
                return w
            }
        }
    }
}

// MARK: weitere Hüllen, die die App nicht braucht, aber üblich sind

@propertyWrapper public struct Namespace: _DynProp {
    public struct ID: Hashable, Sendable { let v: Int }
    nonisolated public init() {}
    public var wrappedValue: ID { ID(v: 0) }
    func _link(_ key: UInt64) {}
}

@propertyWrapper public struct ScaledMetric<Value: BinaryFloatingPoint>: _DynProp {
    public var wrappedValue: Value
    nonisolated public init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
    nonisolated public init(wrappedValue: Value, relativeTo: Font.TextStyle) { self.wrappedValue = wrappedValue }
    func _link(_ key: UInt64) {}
}
