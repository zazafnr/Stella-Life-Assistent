// Knöpfe, Eingabefelder, Auswahl

public struct ButtonRole: Equatable, Sendable {
    let k: String
    public static let destructive = ButtonRole(k: "destructive")
    public static let cancel = ButtonRole(k: "cancel")
}

@MainActor public protocol ButtonStyle {
    associatedtype Body: View
    typealias Configuration = ButtonStyleConfiguration
    @ViewBuilder func makeBody(configuration: Configuration) -> Body
}

public struct ButtonStyleConfiguration {
    public struct Label: View, _Primitive {
        public typealias Body = Never
        let v: any View
        public func _render() -> [_Node] { _at(61) { _renderAny(v) } }
    }
    public let role: ButtonRole?
    public let label: Label
    public let isPressed: Bool
}

public protocol PrimitiveButtonStyle { var _kind: String { get } }
public struct DefaultButtonStyle: PrimitiveButtonStyle { public init() {}; public var _kind: String { "auto" } }
public struct PlainButtonStyle: PrimitiveButtonStyle { public init() {}; public var _kind: String { "plain" } }
public struct BorderlessButtonStyle: PrimitiveButtonStyle { public init() {}; public var _kind: String { "borderless" } }
public struct BorderedButtonStyle: PrimitiveButtonStyle { public init() {}; public var _kind: String { "bordered" } }
public struct BorderedProminentButtonStyle: PrimitiveButtonStyle { public init() {}; public var _kind: String { "prominent" } }
extension PrimitiveButtonStyle where Self == DefaultButtonStyle { public static var automatic: DefaultButtonStyle { .init() } }
extension PrimitiveButtonStyle where Self == PlainButtonStyle { public static var plain: PlainButtonStyle { .init() } }
extension PrimitiveButtonStyle where Self == BorderlessButtonStyle { public static var borderless: BorderlessButtonStyle { .init() } }
extension PrimitiveButtonStyle where Self == BorderedButtonStyle { public static var bordered: BorderedButtonStyle { .init() } }
extension PrimitiveButtonStyle where Self == BorderedProminentButtonStyle { public static var borderedProminent: BorderedProminentButtonStyle { .init() } }

public struct ButtonBorderShape: Sendable {
    public static let automatic = ButtonBorderShape(), capsule = ButtonBorderShape(), roundedRectangle = ButtonBorderShape(), circle = ButtonBorderShape()
    public static func roundedRectangle(radius: CGFloat) -> ButtonBorderShape { .init() }
}

extension _Env { static let afterTap = _EnvName<(() -> Void)?>(nil) }

extension View {
    public func buttonStyle<S: ButtonStyle>(_ s: S) -> some View { _env { $0[_Env.buttonStyle] = s; $0[_Env.buttonKind] = "custom" } }
    public func buttonStyle<S: PrimitiveButtonStyle>(_ s: S) -> some View { _env { $0[_Env.buttonStyle] = nil; $0[_Env.buttonKind] = s._kind } }
    public func buttonBorderShape(_ s: ButtonBorderShape) -> some View { self }
    public func controlSize(_ s: ControlSize) -> some View { _Mod(content: self, env: { $0[_Env.controlSize] = s }, wrap: { _css($0, .inherit, [("--cs", s == .mini ? "0.7" : s == .small ? "0.82" : s == .large ? "1.2" : "1")]) }) }
}

public struct Button<Label: View>: View, _Primitive {
    public typealias Body = Never
    let action: () -> Void
    let label: Label
    var role: ButtonRole?

    nonisolated public init(action: @escaping @MainActor () -> Void, @ViewBuilder label: () -> Label) { self.action = { MainActor.assumeIsolated { action() } }; self.label = label() }
    nonisolated public init(role: ButtonRole?, action: @escaping @MainActor () -> Void, @ViewBuilder label: () -> Label) { self.action = { MainActor.assumeIsolated { action() } }; self.label = label(); self.role = role }

    public func _render() -> [_Node] {
        let env = _R.env
        let enabled = env[_Env.isEnabled]
        let after = env[_Env.afterTap]
        let act = action
        let h = _R.handler("tap") { act(); after?() }
        let kids: [_Node]
        var kind = env[_Env.buttonKind]
        if let style = env[_Env.buttonStyle] {
            kids = _withEnv({ $0[_Env.buttonStyle] = nil; $0[_Env.buttonKind] = "auto"; $0[_Env.inList] = false }) { _styled(style, label, role) }
            kind = "custom"
        } else {
            kids = _withEnv({ $0[_Env.inList] = false }) { SwiftUI._render(label) }
        }
        let n = _Node("btn", ["tap": h, "kind": .s(kind)], kids)
        if let role { n.p["role"] = .s(role.k) }
        if !enabled { n.p["dis"] = true }
        if env[_Env.inList] { n.p["row"] = true }
        n.gw = kids.contains { $0.gw }
        n.gh = kids.contains { $0.gh }
        return [n]
    }
}

@MainActor func _styled<S: ButtonStyle>(_ s: S, _ label: any View, _ role: ButtonRole?) -> [_Node] {
    _at(_hash(ObjectIdentifier(S.self))) {
        _link(s)
        return _render(s.makeBody(configuration: ButtonStyleConfiguration(role: role, label: .init(v: label), isPressed: false)))
    }
}

extension Button where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, action: @escaping @MainActor () -> Void) { self.init(action: action) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, action: @escaping @MainActor () -> Void) { self.init(action: action) { Text(title) } }
    nonisolated public init(_ title: LocalizedStringKey, role: ButtonRole?, action: @escaping @MainActor () -> Void) { self.init(role: role, action: action) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, role: ButtonRole?, action: @escaping @MainActor () -> Void) { self.init(role: role, action: action) { Text(title) } }
}

extension Button where Label == SwiftUI.Label<Text, Image> {
    nonisolated public init(_ title: LocalizedStringKey, systemImage: String, action: @escaping @MainActor () -> Void) { self.init(action: action) { SwiftUI.Label(title, systemImage: systemImage) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, systemImage: String, action: @escaping @MainActor () -> Void) { self.init(action: action) { SwiftUI.Label(title, systemImage: systemImage) } }
    nonisolated public init(_ title: LocalizedStringKey, systemImage: String, role: ButtonRole?, action: @escaping @MainActor () -> Void) { self.init(role: role, action: action) { SwiftUI.Label(title, systemImage: systemImage) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, systemImage: String, role: ButtonRole?, action: @escaping @MainActor () -> Void) { self.init(role: role, action: action) { SwiftUI.Label(title, systemImage: systemImage) } }
}

// MARK: Link

public struct Link<Label: View>: View {
    let url: URL
    let label: Label
    @Environment(\.openURL) private var openURL
    nonisolated public init(destination: URL, @ViewBuilder label: () -> Label) { url = destination; self.label = label() }
    public var body: some View { Button { openURL(url) } label: { label } }
}

extension Link where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, destination: URL) { self.init(destination: destination) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, destination: URL) { self.init(destination: destination) { Text(title) } }
}

public struct ShareLink<Label: View>: View {
    let text: String
    let label: Label
    nonisolated public init<I>(item: I, @ViewBuilder label: () -> Label) { text = "\(item)"; self.label = label() }
    public var body: some View { Button { _R.message(["k": "copy", "s": .s(text)]) } label: { label } }
}

extension ShareLink where Label == SwiftUI.Label<Text, Image> {
    nonisolated public init<I>(item: I) { self.init(item: item) { SwiftUI.Label("Teilen", systemImage: "square.and.arrow.up") } }
    nonisolated public init<I>(_ title: LocalizedStringKey, item: I) { self.init(item: item) { SwiftUI.Label(title, systemImage: "square.and.arrow.up") } }
}

// MARK: Schalter

public struct Toggle<Label: View>: View, _Primitive {
    public typealias Body = Never
    let isOn: Binding<Bool>
    let label: Label
    nonisolated public init(isOn: Binding<Bool>, @ViewBuilder label: () -> Label) { self.isOn = isOn; self.label = label() }
    public func _render() -> [_Node] {
        let b = isOn
        let h = _R.handler("toggle") { (v: _J) in b.wrappedValue = v.bool ?? !b.wrappedValue }
        let kids = SwiftUI._render(label)
        let n = _Node("toggle", ["on": .b(b.wrappedValue), "h": h], [_Node("h", [:], kids)])
        if !_R.env[_Env.isEnabled] { n.p["dis"] = true }
        n.gw = true
        return [n]
    }
}

extension Toggle where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, isOn: Binding<Bool>) { self.init(isOn: isOn) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, isOn: Binding<Bool>) { self.init(isOn: isOn) { Text(title) } }
}

extension Toggle where Label == SwiftUI.Label<Text, Image> {
    nonisolated public init(_ title: LocalizedStringKey, systemImage: String, isOn: Binding<Bool>) { self.init(isOn: isOn) { SwiftUI.Label(title, systemImage: systemImage) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, systemImage: String, isOn: Binding<Bool>) { self.init(isOn: isOn) { SwiftUI.Label(title, systemImage: systemImage) } }
}

public protocol ToggleStyle {}
public struct SwitchToggleStyle: ToggleStyle { public init() {} }
public struct ButtonToggleStyle: ToggleStyle { public init() {} }
extension ToggleStyle where Self == SwitchToggleStyle { public static var `switch`: SwitchToggleStyle { .init() }; public static var automatic: SwitchToggleStyle { .init() } }
extension ToggleStyle where Self == ButtonToggleStyle { public static var button: ButtonToggleStyle { .init() } }
extension View { public func toggleStyle<S: ToggleStyle>(_ s: S) -> some View { self } }

// MARK: Texteingabe

public enum UIKeyboardType: Int, Sendable { case `default`, asciiCapable, numbersAndPunctuation, URL, numberPad, phonePad, namePhonePad, emailAddress, decimalPad, twitter, webSearch, asciiCapableNumberPad }
public struct UITextContentType: Hashable, Sendable {
    let v: String
    public static let name = UITextContentType(v: "name"), givenName = UITextContentType(v: "given-name"), familyName = UITextContentType(v: "family-name")
    public static let emailAddress = UITextContentType(v: "email"), username = UITextContentType(v: "username"), password = UITextContentType(v: "current-password")
    public static let newPassword = UITextContentType(v: "new-password"), oneTimeCode = UITextContentType(v: "one-time-code"), telephoneNumber = UITextContentType(v: "tel")
    public static let URL = UITextContentType(v: "url"), nickname = UITextContentType(v: "nickname"), organizationName = UITextContentType(v: "organization")
    public static let fullStreetAddress = UITextContentType(v: "street-address"), postalCode = UITextContentType(v: "postal-code"), addressCity = UITextContentType(v: "address-level2")
}
public struct TextInputAutocapitalization: Sendable {
    public static let never = TextInputAutocapitalization(), words = TextInputAutocapitalization(), sentences = TextInputAutocapitalization(), characters = TextInputAutocapitalization()
}
public struct SubmitLabel: Sendable {
    public static let done = SubmitLabel(), go = SubmitLabel(), send = SubmitLabel(), join = SubmitLabel(), route = SubmitLabel(), search = SubmitLabel(), `return` = SubmitLabel(), next = SubmitLabel(), `continue` = SubmitLabel()
}
public struct SubmitTriggers: OptionSet, Sendable {
    public let rawValue: Int
    nonisolated public init(rawValue: Int) { self.rawValue = rawValue }
    public static let text = SubmitTriggers(rawValue: 1), search = SubmitTriggers(rawValue: 2)
}
public protocol TextFieldStyle { var _k: String { get } }
public struct DefaultTextFieldStyle: TextFieldStyle { public init() {}; public var _k: String { "plain" } }
public struct PlainTextFieldStyle: TextFieldStyle { public init() {}; public var _k: String { "plain" } }
public struct RoundedBorderTextFieldStyle: TextFieldStyle { public init() {}; public var _k: String { "rounded" } }
extension TextFieldStyle where Self == DefaultTextFieldStyle { public static var automatic: DefaultTextFieldStyle { .init() } }
extension TextFieldStyle where Self == PlainTextFieldStyle { public static var plain: PlainTextFieldStyle { .init() } }
extension TextFieldStyle where Self == RoundedBorderTextFieldStyle { public static var roundedBorder: RoundedBorderTextFieldStyle { .init() } }

extension _Env {
    static let onSubmit = _EnvName<(() -> Void)?>(nil)
    static let keyboard = _EnvName<UIKeyboardType>(.default)
    static let fieldStyle = _EnvName<String>("plain")
    static let contentType = _EnvName<String?>(nil)
}

extension View {
    public func onSubmit(of triggers: SubmitTriggers = .text, _ action: @escaping () -> Void) -> some View {
        _env { e in
            let prev = e[_Env.onSubmit]
            e[_Env.onSubmit] = { action(); prev?() }
        }
    }
    public func keyboardType(_ t: UIKeyboardType) -> some View { _env { $0[_Env.keyboard] = t } }
    public func textContentType(_ t: UITextContentType?) -> some View { _env { $0[_Env.contentType] = t?.v } }
    public func textInputAutocapitalization(_ a: TextInputAutocapitalization?) -> some View { self }
    public func autocorrectionDisabled(_ d: Bool = true) -> some View { self }
    public func autocapitalization(_ a: Any) -> some View { self }
    public func disableAutocorrection(_ d: Bool?) -> some View { self }
    public func submitLabel(_ l: SubmitLabel) -> some View { self }
    public func textFieldStyle<S: TextFieldStyle>(_ s: S) -> some View { _env { $0[_Env.fieldStyle] = s._k } }
    public func scrollDismissesKeyboard(_ m: ScrollDismissesKeyboardMode) -> some View { self }
    public func scrollIndicators(_ v: ScrollIndicatorVisibility, axes: Axis.Set = [.vertical, .horizontal]) -> some View { self }
    public func scrollBounceBehavior(_ b: ScrollBounceBehavior, axes: Axis.Set = [.vertical]) -> some View { self }
    public func scrollDisabled(_ d: Bool) -> some View { self }
    public func scrollClipDisabled(_ d: Bool = true) -> some View { self }
    public func scrollTargetBehavior(_ b: Any) -> some View { self }
    public func scrollTargetLayout(isEnabled: Bool = true) -> some View { self }
    public func defaultScrollAnchor(_ a: UnitPoint?) -> some View { _env { $0[_Env.scrollAnchor] = a == .bottom ? "bottom" : nil } }
    public func contentMargins(_ edges: Edge.Set = .all, _ length: CGFloat?, for placement: ContentMarginPlacement = .automatic) -> some View { self }
}

public struct ContentMarginPlacement: Sendable { public static let automatic = ContentMarginPlacement(), scrollContent = ContentMarginPlacement(), scrollIndicators = ContentMarginPlacement() }

@MainActor func _fieldNode(_ text: Binding<String>, prompt: String, secure: Bool = false, multi: Bool = false) -> _Node {
    let env = _R.env
    let b = text
    let h = _R.handler("input") { (v: _J) in
        let s = v.string ?? ""
        if b.wrappedValue != s { b.wrappedValue = s }
    }
    let n = _Node("field", ["v": .s(b.wrappedValue), "ph": .s(prompt), "h": h])
    if secure { n.p["sec"] = true }
    if multi { n.p["multi"] = true }
    if let submit = env[_Env.onSubmit] { n.p["sub"] = _R.handler("submit") { submit() } }
    let kb = env[_Env.keyboard]
    if kb == .emailAddress { n.p["kb"] = "email" } else if kb == .numberPad || kb == .phonePad { n.p["kb"] = "numeric" } else if kb == .decimalPad { n.p["kb"] = "decimal" } else if kb == .URL { n.p["kb"] = "url" }
    if let ct = env[_Env.contentType] { n.p["ct"] = .s(ct) }
    if env[_Env.fieldStyle] == "rounded" { n.p["fs"] = "rounded" }
    if !env[_Env.isEnabled] { n.p["dis"] = true }
    n.gw = true
    return n
}

public struct TextField<Label: View>: View, _Primitive {
    public typealias Body = Never
    let text: Binding<String>
    let prompt: String
    let multi: Bool
    public func _render() -> [_Node] { [_fieldNode(text, prompt: prompt, multi: multi)] }
}

extension TextField where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, text: Binding<String>, prompt: Text? = nil) { self.text = text; self.prompt = prompt?.plain ?? title.s; multi = false }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, text: Binding<String>, prompt: Text? = nil) { self.text = text; self.prompt = prompt?.plain ?? String(title); multi = false }
    nonisolated public init(_ title: LocalizedStringKey, text: Binding<String>, prompt: Text? = nil, axis: Axis) { self.text = text; self.prompt = prompt?.plain ?? title.s; multi = axis == .vertical }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, text: Binding<String>, prompt: Text? = nil, axis: Axis) { self.text = text; self.prompt = prompt?.plain ?? String(title); multi = axis == .vertical }

    nonisolated public init<F: ParseableFormatStyle>(_ title: LocalizedStringKey, value: Binding<F.FormatInput>, format: F, prompt: Text? = nil) where F.FormatOutput == String {
        self.init(title, text: _formatted(value, format), prompt: prompt)
    }
    @_disfavoredOverload public init<S: StringProtocol, F: ParseableFormatStyle>(_ title: S, value: Binding<F.FormatInput>, format: F, prompt: Text? = nil) where F.FormatOutput == String {
        self.init(title, text: _formatted(value, format), prompt: prompt)
    }
    nonisolated public init<F: ParseableFormatStyle>(_ title: LocalizedStringKey, value: Binding<F.FormatInput?>, format: F, prompt: Text? = nil) where F.FormatOutput == String {
        self.init(title, text: _formattedOptional(value, format), prompt: prompt)
    }
    @_disfavoredOverload public init<S: StringProtocol, F: ParseableFormatStyle>(_ title: S, value: Binding<F.FormatInput?>, format: F, prompt: Text? = nil) where F.FormatOutput == String {
        self.init(title, text: _formattedOptional(value, format), prompt: prompt)
    }
}

func _formatted<F: ParseableFormatStyle>(_ value: Binding<F.FormatInput>, _ format: F) -> Binding<String> where F.FormatOutput == String {
    Binding(get: { format.format(value.wrappedValue) }, set: { s in if let v = try? format.parseStrategy.parse(s) { value.wrappedValue = v } })
}

func _formattedOptional<F: ParseableFormatStyle>(_ value: Binding<F.FormatInput?>, _ format: F) -> Binding<String> where F.FormatOutput == String {
    Binding(get: { value.wrappedValue.map { format.format($0) } ?? "" }, set: { s in value.wrappedValue = s.isEmpty ? nil : try? format.parseStrategy.parse(s) })
}

public struct SecureField<Label: View>: View, _Primitive {
    public typealias Body = Never
    let text: Binding<String>
    let prompt: String
    public func _render() -> [_Node] { [_fieldNode(text, prompt: prompt, secure: true)] }
}

extension SecureField where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, text: Binding<String>, prompt: Text? = nil) { self.text = text; self.prompt = prompt?.plain ?? title.s }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, text: Binding<String>, prompt: Text? = nil) { self.text = text; self.prompt = prompt?.plain ?? String(title) }
}

public struct TextEditor: View, _Primitive {
    public typealias Body = Never
    let text: Binding<String>
    nonisolated public init(text: Binding<String>) { self.text = text }
    public func _render() -> [_Node] {
        let n = _fieldNode(text, prompt: "", multi: true)
        n.p["editor"] = true
        n.gh = true
        return [n]
    }
}

// MARK: Auswahl

public protocol PickerStyle { var _k: String { get } }
public struct DefaultPickerStyle: PickerStyle { public init() {}; public var _k: String { "auto" } }
public struct SegmentedPickerStyle: PickerStyle { public init() {}; public var _k: String { "segmented" } }
public struct MenuPickerStyle: PickerStyle { public init() {}; public var _k: String { "menu" } }
public struct InlinePickerStyle: PickerStyle { public init() {}; public var _k: String { "inline" } }
public struct WheelPickerStyle: PickerStyle { public init() {}; public var _k: String { "menu" } }
public struct NavigationLinkPickerStyle: PickerStyle { public init() {}; public var _k: String { "menu" } }
public struct PalettePickerStyle: PickerStyle { public init() {}; public var _k: String { "segmented" } }
extension PickerStyle where Self == DefaultPickerStyle { public static var automatic: DefaultPickerStyle { .init() } }
extension PickerStyle where Self == SegmentedPickerStyle { public static var segmented: SegmentedPickerStyle { .init() } }
extension PickerStyle where Self == MenuPickerStyle { public static var menu: MenuPickerStyle { .init() } }
extension PickerStyle where Self == InlinePickerStyle { public static var inline: InlinePickerStyle { .init() } }
extension PickerStyle where Self == WheelPickerStyle { public static var wheel: WheelPickerStyle { .init() } }
extension PickerStyle where Self == NavigationLinkPickerStyle { public static var navigationLink: NavigationLinkPickerStyle { .init() } }
extension PickerStyle where Self == PalettePickerStyle { public static var palette: PalettePickerStyle { .init() } }
extension View { public func pickerStyle<S: PickerStyle>(_ s: S) -> some View { _env { $0[_Env.pickerStyle] = s._k } } }

func _same(_ a: AnyHashable, _ b: AnyHashable) -> Bool {
    if a == b { return true }
    return String(describing: a.base) == String(describing: b.base) || "Optional(\(b.base))" == String(describing: a.base) || "Optional(\(a.base))" == String(describing: b.base)
}

public struct Picker<Label: View, SelectionValue: Hashable, Content: View>: View, _Primitive {
    public typealias Body = Never
    let selection: Binding<SelectionValue>
    let label: Label
    let content: Content

    nonisolated public init(selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) {
        self.selection = selection; self.content = content(); self.label = label()
    }

    public func _render() -> [_Node] {
        let kids = _children(content)
        let current = AnyHashable(selection.wrappedValue)
        let sel = kids.firstIndex { c in (c.traits["tag"] as? AnyHashable).map { _same($0, current) } ?? false } ?? -1
        let b = selection
        let h = _R.handler("pick") { (v: _J) in
            guard let i = v.number.map({ Int($0) }), kids.indices.contains(i), let tag = kids[i].traits["tag"] as? AnyHashable else { return }
            if let value = tag.base as? SelectionValue { b.wrappedValue = value }
        }
        var style = _R.env[_Env.pickerStyle]
        if style == "auto" { style = "menu" }
        let labelNodes = _at(3) { _withEnv({ $0[_Env.inList] = false }) { SwiftUI._render(label) } }
        let options = _withEnv({ $0[_Env.inList] = false; $0[_Env.pickerStyle] = "auto" }) { kids.map { c in _Node("h", [:], _renderChild(c)) } }
        let n = _Node("picker", ["style": .s(style), "sel": .n(Double(sel)), "h": h], [_Node("h", [:], labelNodes)] + options)
        if _R.env[_Env.inList] { n.p["row"] = true }
        if !_R.env[_Env.isEnabled] { n.p["dis"] = true }
        n.gw = style == "segmented" || _R.env[_Env.inList]
        return [n]
    }
}

extension Picker where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content) { self.init(selection: selection, content: content) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content) { self.init(selection: selection, content: content) { Text(title) } }
}

extension Picker where Label == SwiftUI.Label<Text, Image> {
    nonisolated public init(_ title: LocalizedStringKey, systemImage: String, selection: Binding<SelectionValue>, @ViewBuilder content: () -> Content) {
        self.init(selection: selection, content: content) { SwiftUI.Label(title, systemImage: systemImage) }
    }
}

// MARK: Datum

public struct DatePickerComponents: OptionSet, Sendable {
    public let rawValue: Int
    nonisolated public init(rawValue: Int) { self.rawValue = rawValue }
    public static let hourAndMinute = DatePickerComponents(rawValue: 1)
    public static let date = DatePickerComponents(rawValue: 2)
}
public typealias DatePickerDisplayedComponents = DatePickerComponents

public protocol DatePickerStyle {}
public struct CompactDatePickerStyle: DatePickerStyle { public init() {} }
extension DatePickerStyle where Self == CompactDatePickerStyle {
    public static var compact: CompactDatePickerStyle { .init() }
    public static var automatic: CompactDatePickerStyle { .init() }
    public static var graphical: CompactDatePickerStyle { .init() }
    public static var wheel: CompactDatePickerStyle { .init() }
}
extension View {
    public func datePickerStyle<S: DatePickerStyle>(_ s: S) -> some View { self }
    public func labelsHidden() -> some View { _prop("nolabel", true) }
}

public struct DatePicker<Label: View>: View, _Primitive {
    public typealias Body = Never
    let selection: Binding<Date>
    let components: DatePickerComponents
    let range: ClosedRange<Date>?
    let label: Label

    nonisolated public init(selection: Binding<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date], @ViewBuilder label: () -> Label) {
        self.selection = selection; components = displayedComponents; range = nil; self.label = label()
    }
    nonisolated public init(selection: Binding<Date>, in range: ClosedRange<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date], @ViewBuilder label: () -> Label) {
        self.selection = selection; components = displayedComponents; self.range = range; self.label = label()
    }
    nonisolated public init(selection: Binding<Date>, in range: PartialRangeFrom<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date], @ViewBuilder label: () -> Label) {
        self.selection = selection; components = displayedComponents; self.range = range.lowerBound...Date.distantFuture; self.label = label()
    }
    nonisolated public init(selection: Binding<Date>, in range: PartialRangeThrough<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date], @ViewBuilder label: () -> Label) {
        self.selection = selection; components = displayedComponents; self.range = Date.distantPast...range.upperBound; self.label = label()
    }

    public func _render() -> [_Node] {
        let cal = Calendar.current
        let d = selection.wrappedValue
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute], from: d)
        let date = String(format: "%04d-%02d-%02d", c.year ?? 2000, c.month ?? 1, c.day ?? 1)
        let time = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
        let b = selection
        let h = _R.handler("date") { (v: _J) in
            var comps = cal.dateComponents([.year, .month, .day, .hour, .minute], from: b.wrappedValue)
            if let s = v["d"]?.string {
                let parts = s.split(separator: "-").compactMap { Int($0) }
                if parts.count == 3 { comps.year = parts[0]; comps.month = parts[1]; comps.day = parts[2] }
            }
            if let s = v["t"]?.string {
                let parts = s.split(separator: ":").compactMap { Int($0) }
                if parts.count >= 2 { comps.hour = parts[0]; comps.minute = parts[1] }
            }
            if let nd = cal.date(from: comps) { b.wrappedValue = nd }
        }
        var p: [String: _J] = ["h": h]
        if components.contains(.date) { p["d"] = .s(date) }
        if components.contains(.hourAndMinute) { p["t"] = .s(time) }
        let n = _Node("date", p, [_Node("h", [:], _withEnv({ $0[_Env.inList] = false }) { SwiftUI._render(label) })])
        n.gw = true
        return [n]
    }
}

extension DatePicker where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, selection: Binding<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date]) { self.init(selection: selection, displayedComponents: displayedComponents) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, selection: Binding<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date]) { self.init(selection: selection, displayedComponents: displayedComponents) { Text(title) } }
    nonisolated public init(_ title: LocalizedStringKey, selection: Binding<Date>, in range: ClosedRange<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date]) { self.init(selection: selection, in: range, displayedComponents: displayedComponents) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, selection: Binding<Date>, in range: ClosedRange<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date]) { self.init(selection: selection, in: range, displayedComponents: displayedComponents) { Text(title) } }
    nonisolated public init(_ title: LocalizedStringKey, selection: Binding<Date>, in range: PartialRangeFrom<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date]) { self.init(selection: selection, in: range, displayedComponents: displayedComponents) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, selection: Binding<Date>, in range: PartialRangeFrom<Date>, displayedComponents: DatePickerComponents = [.hourAndMinute, .date]) { self.init(selection: selection, in: range, displayedComponents: displayedComponents) { Text(title) } }
}

// MARK: Zähler, Regler, Fortschritt

public struct Stepper<Label: View>: View, _Primitive {
    public typealias Body = Never
    let label: Label
    let inc: (() -> Void)?
    let dec: (() -> Void)?

    nonisolated public init(@ViewBuilder label: () -> Label, onIncrement: (() -> Void)?, onDecrement: (() -> Void)?) { self.label = label(); inc = onIncrement; dec = onDecrement }

    nonisolated public init<V: Strideable>(value: Binding<V>, in range: ClosedRange<V>, step: V.Stride = 1, @ViewBuilder label: () -> Label) {
        self.label = label()
        let v = value.wrappedValue
        inc = v < range.upperBound ? { value.wrappedValue = min(range.upperBound, value.wrappedValue.advanced(by: step)) } : nil
        dec = v > range.lowerBound ? { value.wrappedValue = max(range.lowerBound, value.wrappedValue.advanced(by: -step)) } : nil
    }

    nonisolated public init<V: Strideable>(value: Binding<V>, step: V.Stride = 1, @ViewBuilder label: () -> Label) {
        self.label = label()
        inc = { value.wrappedValue = value.wrappedValue.advanced(by: step) }
        dec = { value.wrappedValue = value.wrappedValue.advanced(by: -step) }
    }

    public func _render() -> [_Node] {
        var p: [String: _J] = [:]
        if let inc { p["inc"] = _R.handler("inc") { inc() } }
        if let dec { p["dec"] = _R.handler("dec") { dec() } }
        let n = _Node("stepper", p, [_Node("h", [:], _withEnv({ $0[_Env.inList] = false }) { SwiftUI._render(label) })])
        n.gw = true
        return [n]
    }
}

extension Stepper where Label == Text {
    nonisolated public init<V: Strideable>(_ title: LocalizedStringKey, value: Binding<V>, in range: ClosedRange<V>, step: V.Stride = 1) { self.init(value: value, in: range, step: step) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol, V: Strideable>(_ title: S, value: Binding<V>, in range: ClosedRange<V>, step: V.Stride = 1) { self.init(value: value, in: range, step: step) { Text(title) } }
    nonisolated public init<V: Strideable>(_ title: LocalizedStringKey, value: Binding<V>, step: V.Stride = 1) { self.init(value: value, step: step) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol, V: Strideable>(_ title: S, value: Binding<V>, step: V.Stride = 1) { self.init(value: value, step: step) { Text(title) } }
    nonisolated public init(_ title: LocalizedStringKey, onIncrement: (() -> Void)?, onDecrement: (() -> Void)?) { self.init(label: { Text(title) }, onIncrement: onIncrement, onDecrement: onDecrement) }
}

public struct Slider: View, _Primitive {
    public typealias Body = Never
    let get: () -> Double
    let set: (Double) -> Void
    let lo: Double, hi: Double, step: Double?
    nonisolated public init<V: BinaryFloatingPoint>(value: Binding<V>, in range: ClosedRange<V> = 0...1, step: V? = nil, onEditingChanged: @escaping (Bool) -> Void = { _ in }) {
        get = { Double(value.wrappedValue) }; set = { value.wrappedValue = V($0) }
        lo = Double(range.lowerBound); hi = Double(range.upperBound); self.step = step.map { Double($0) }
    }
    public func _render() -> [_Node] {
        let s = set
        let n = _Node("slider", ["v": .n(get()), "lo": .n(lo), "hi": .n(hi), "step": step.map { .n($0) } ?? .null,
                                 "h": _R.handler("slide") { (v: _J) in if let d = v.number { s(d) } }])
        n.gw = true
        return [n]
    }
}

public struct ProgressView<Label: View, CurrentValueLabel: View>: View, _Primitive {
    public typealias Body = Never
    let value: Double?
    let label: Label?
    public func _render() -> [_Node] {
        let kids = label.map { SwiftUI._render($0) } ?? []
        if let value {
            let n = _Node("progress", ["v": .n(max(0, min(1, value)))], kids)
            n.gw = true
            return [n]
        }
        return [_Node("spinner", [:], kids)]
    }
}

extension ProgressView where Label == EmptyView, CurrentValueLabel == EmptyView {
    nonisolated public init() { value = nil; label = nil }
    nonisolated public init<V: BinaryFloatingPoint>(value: V?, total: V = 1.0) { self.value = value.map { Double($0) / Double(total) }; label = nil }
}

extension ProgressView where Label == Text, CurrentValueLabel == EmptyView {
    nonisolated public init(_ title: LocalizedStringKey) { value = nil; label = Text(title) }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S) { value = nil; label = Text(title) }
    nonisolated public init<V: BinaryFloatingPoint>(_ title: LocalizedStringKey, value: V?, total: V = 1.0) { self.value = value.map { Double($0) / Double(total) }; label = Text(title) }
}

extension ProgressView where CurrentValueLabel == EmptyView {
    nonisolated public init(@ViewBuilder label: () -> Label) { value = nil; self.label = label() }
}

public protocol ProgressViewStyle {}
public struct CircularProgressViewStyle: ProgressViewStyle { public init() {} }
public struct LinearProgressViewStyle: ProgressViewStyle { public init() {} }
extension ProgressViewStyle where Self == CircularProgressViewStyle { public static var circular: CircularProgressViewStyle { .init() } }
extension ProgressViewStyle where Self == LinearProgressViewStyle { public static var linear: LinearProgressViewStyle { .init() } }
extension View { public func progressViewStyle<S: ProgressViewStyle>(_ s: S) -> some View { self } }

// MARK: Menü

public struct Menu<Label: View, Content: View>: View, _Primitive {
    public typealias Body = Never
    let label: Label
    let content: Content
    nonisolated public init(@ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) { self.content = content(); self.label = label() }
    public func _render() -> [_Node] {
        let labelNodes = _at(3) { _withEnv({ $0[_Env.inList] = false }) { SwiftUI._render(label) } }
        let items = _at(4) { _withAxis(.v) { _withEnv({ $0[_Env.buttonStyle] = nil; $0[_Env.buttonKind] = "menu"; $0[_Env.inList] = false; $0[_Env.pickerStyle] = "inline" }) { SwiftUI._render(content) } } }
        let n = _Node("menu", [:], [_Node("h", [:], labelNodes), _Node("v", [:], items)])
        if _R.env[_Env.buttonKind] == "plain" || _R.env[_Env.buttonStyle] != nil { n.p["plain"] = true }
        return [n]
    }
}

extension Menu where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) { self.init(content: content) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, @ViewBuilder content: () -> Content) { self.init(content: content) { Text(title) } }
}

extension Menu where Label == SwiftUI.Label<Text, Image> {
    nonisolated public init(_ title: LocalizedStringKey, systemImage: String, @ViewBuilder content: () -> Content) { self.init(content: content) { SwiftUI.Label(title, systemImage: systemImage) } }
}

extension View {
    public func contextMenu<M: View>(@ViewBuilder menuItems: () -> M) -> some View { _ContextMenu(content: self, items: menuItems()) }
    public func menuStyle(_ s: Any) -> some View { self }
    public func menuOrder(_ o: Any) -> some View { self }
    public func menuIndicator(_ v: Visibility) -> some View { self }
}

struct _ContextMenu<C: View, M: View>: View, _Primitive {
    typealias Body = Never
    let content: C, items: M
    func _render() -> [_Node] {
        let main = _at(51) { SwiftUI._render(content) }
        let menu = _at(52) { _withAxis(.v) { _withEnv({ $0[_Env.buttonStyle] = nil; $0[_Env.buttonKind] = "menu"; $0[_Env.inList] = false }) { SwiftUI._render(items) } } }
        return main.map { n in
            let w = _Node("ctx", [:], [n, _Node("v", [:], menu)])
            w.gw = n.gw; w.gh = n.gh
            return w
        }
    }
}

// MARK: Sonstiges

public struct LabeledContent<Label: View, Content: View>: View {
    let label: Label, content: Content
    nonisolated public init(@ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) { self.content = content(); self.label = label() }
    public var body: some View { HStack { label; Spacer(); content.foregroundStyle(.secondary) } }
}

extension LabeledContent where Label == Text, Content == Text {
    nonisolated public init(_ title: LocalizedStringKey, value: String) { self.init(content: { Text(value) }, label: { Text(title) }) }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, value: String) { self.init(content: { Text(value) }, label: { Text(title) }) }
}

extension LabeledContent where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) { self.init(content: content, label: { Text(title) }) }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, @ViewBuilder content: () -> Content) { self.init(content: content, label: { Text(title) }) }
}

public struct ContentUnavailableView<Label: View, Description: View, Actions: View>: View {
    let label: Label, description: Description, actions: Actions
    nonisolated public init(@ViewBuilder label: () -> Label, @ViewBuilder description: () -> Description = { EmptyView() }, @ViewBuilder actions: () -> Actions = { EmptyView() }) {
        self.label = label(); self.description = description(); self.actions = actions()
    }
    public var body: some View {
        VStack(spacing: 10) {
            label.font(.title2.weight(.bold)).labelStyle(.titleAndIcon)
            description.font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            actions
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension ContentUnavailableView where Label == SwiftUI.Label<Text, Image>, Description == Text?, Actions == EmptyView {
    nonisolated public init(_ title: LocalizedStringKey, systemImage: String, description: Text? = nil) {
        self.init(label: { SwiftUI.Label(title, systemImage: systemImage) }, description: { description })
    }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, systemImage: String, description: Text? = nil) {
        self.init(label: { SwiftUI.Label(title, systemImage: systemImage) }, description: { description })
    }
}

public struct DisclosureGroup<Label: View, Content: View>: View {
    let label: Label, content: Content
    let external: Binding<Bool>?
    @State private var open = false
    nonisolated public init(@ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) { self.content = content(); self.label = label(); external = nil }
    nonisolated public init(isExpanded: Binding<Bool>, @ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) { self.content = content(); self.label = label(); external = isExpanded }
    public var body: some View {
        let isOpen = external?.wrappedValue ?? open
        VStack(alignment: .leading, spacing: 8) {
            Button { if let external { external.wrappedValue.toggle() } else { open.toggle() } } label: {
                HStack { label; Spacer(); Image(systemName: isOpen ? "chevron.down" : "chevron.right").font(.system(size: 13, weight: .semibold)) }
            }
            if isOpen { content }
        }
    }
}

extension DisclosureGroup where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) { self.init(content: content) { Text(title) } }
    @_disfavoredOverload public init<S: StringProtocol>(_ title: S, @ViewBuilder content: () -> Content) { self.init(content: content) { Text(title) } }
    nonisolated public init(_ title: LocalizedStringKey, isExpanded: Binding<Bool>, @ViewBuilder content: () -> Content) { self.init(isExpanded: isExpanded, content: content) { Text(title) } }
}
