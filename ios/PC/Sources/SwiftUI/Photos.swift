// PhotosUI: Fotos wählen öffnet am PC den Dateidialog

public struct PhotosPickerItem: Equatable, Hashable, Sendable {
    public let itemIdentifier: String?
    let file: String
    public static func == (a: PhotosPickerItem, b: PhotosPickerItem) -> Bool { a.file == b.file }
    public func hash(into h: inout Hasher) { h.combine(file) }
    public var supportedContentTypes: [String] { ["public.image"] }

    public func loadTransferable<T>(type: T.Type) async throws -> T? {
        let d: Data? = { _Server.resLock.lock(); defer { _Server.resLock.unlock() }; return _Server.resources[file]?.1 }()
        guard let d else { return nil }
        if T.self == Data.self { return d as? T }
        if T.self == UIImage.self { return UIImage(data: d) as? T }
        if let t = T.self as? _TransferableImage.Type { return t.init(data: d) as? T }
        return nil
    }
}

public protocol _TransferableImage { init?(data: Data) }
extension Image: _TransferableImage { public init?(data: Data) { guard let u = UIImage(data: data) else { return nil }; self.init(uiImage: u) } }

public struct PHPickerFilter: Sendable {
    public static let images = PHPickerFilter(), videos = PHPickerFilter(), livePhotos = PHPickerFilter(), screenshots = PHPickerFilter()
    public static func any(of f: [PHPickerFilter]) -> PHPickerFilter { .images }
    public static func not(_ f: PHPickerFilter) -> PHPickerFilter { .images }
}

public struct PhotosPickerSelectionBehavior: Sendable { public static let `default` = PhotosPickerSelectionBehavior(), ordered = PhotosPickerSelectionBehavior(), continuous = PhotosPickerSelectionBehavior() }

@MainActor func _photoHandler(_ max: Int, _ set: @escaping ([PhotosPickerItem]) -> Void) -> _J {
    let key = "photos:\(_k53(_R.path))"
    _hostHooks[key] = { msg in
        guard let files = msg["files"]?.array else { return }
        var items: [PhotosPickerItem] = []
        for f in files.prefix(max) {
            guard let b64 = f["b64"]?.string, let d = Data(base64Encoded: b64) else { continue }
            let id = _resource(d, mime: f["mime"]?.string ?? "image/jpeg")
            items.append(PhotosPickerItem(itemIdentifier: id, file: id))
        }
        set(items)
    }
    return .s(key)
}

public struct PhotosPicker<Label: View>: View, _Primitive {
    public typealias Body = Never
    let max: Int
    let set: ([PhotosPickerItem]) -> Void
    let label: Label

    nonisolated public init(selection: Binding<[PhotosPickerItem]>, maxSelectionCount: Int? = nil, selectionBehavior: PhotosPickerSelectionBehavior = .default, matching: PHPickerFilter? = nil, preferredItemEncoding: Any? = nil, @ViewBuilder label: () -> Label) {
        max = maxSelectionCount ?? 99; set = { selection.wrappedValue = $0 }; self.label = label()
    }
    nonisolated public init(selection: Binding<PhotosPickerItem?>, matching: PHPickerFilter? = nil, preferredItemEncoding: Any? = nil, @ViewBuilder label: () -> Label) {
        max = 1; set = { selection.wrappedValue = $0.first }; self.label = label()
    }

    public func _render() -> [_Node] {
        let hook = _photoHandler(max, set)
        let kind = _R.env[_Env.buttonStyle] != nil ? "custom" : _R.env[_Env.buttonKind]
        let after = _R.env[_Env.afterTap]
        let h = _R.handler("tap") { _R.message(["k": "pickPhotos", "hook": hook, "multi": .b(max > 1)]); after?() }
        let kids: [_Node]
        if let style = _R.env[_Env.buttonStyle] {
            kids = _withEnv({ $0[_Env.buttonStyle] = nil; $0[_Env.buttonKind] = "auto" }) { _styled(style, label, nil) }
        } else {
            kids = SwiftUI._render(label)
        }
        return [_Node("btn", ["tap": h, "kind": .s(kind)], kids)]
    }
}

extension PhotosPicker where Label == Text {
    nonisolated public init(_ title: LocalizedStringKey, selection: Binding<[PhotosPickerItem]>, maxSelectionCount: Int? = nil, matching: PHPickerFilter? = nil) {
        self.init(selection: selection, maxSelectionCount: maxSelectionCount, matching: matching) { Text(title) }
    }
    nonisolated public init(_ title: LocalizedStringKey, selection: Binding<PhotosPickerItem?>, matching: PHPickerFilter? = nil) {
        self.init(selection: selection, matching: matching) { Text(title) }
    }
}

extension View {
    public func photosPicker(isPresented: Binding<Bool>, selection: Binding<[PhotosPickerItem]>, maxSelectionCount: Int? = nil, selectionBehavior: PhotosPickerSelectionBehavior = .default, matching: PHPickerFilter? = nil, preferredItemEncoding: Any? = nil) -> some View {
        _PhotosMod(content: self, on: isPresented, max: maxSelectionCount ?? 99, set: { selection.wrappedValue = $0 })
    }
    public func photosPicker(isPresented: Binding<Bool>, selection: Binding<PhotosPickerItem?>, matching: PHPickerFilter? = nil, preferredItemEncoding: Any? = nil) -> some View {
        _PhotosMod(content: self, on: isPresented, max: 1, set: { selection.wrappedValue = $0.first })
    }
}

struct _PhotosMod<C: View>: View, _Primitive {
    typealias Body = Never
    let content: C, on: Binding<Bool>, max: Int, set: ([PhotosPickerItem]) -> Void
    func _render() -> [_Node] {
        let nodes = _at(59) { SwiftUI._render(content) }
        if on.wrappedValue {
            let hook = _at(59) { _photoHandler(max, set) }
            let b = on
            _R.post.append { b.wrappedValue = false; _R.message(["k": "pickPhotos", "hook": hook, "multi": .b(self.max > 1)]) }
        }
        return nodes
    }
}
