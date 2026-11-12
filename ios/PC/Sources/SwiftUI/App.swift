#if os(Windows)
import ucrt
import WinSDK
#elseif canImport(Glibc)
import Glibc
#elseif canImport(Darwin)
import Darwin
#endif
// App, Scene, WindowGroup – und der Start des Fensters

@MainActor public protocol App {
    associatedtype Body: Scene
    @SceneBuilder var body: Body { get }
    init()
}

extension App {
    @MainActor public static func main() { _Host.run { Self() } }
}

@MainActor public protocol Scene {
    func _view() -> any View
}

public struct WindowGroup<Content: View>: Scene {
    let content: Content
    nonisolated public init(@ViewBuilder content: () -> Content) { self.content = content() }
    nonisolated public init(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) { self.content = content() }
    nonisolated public init(id: String, @ViewBuilder content: () -> Content) { self.content = content() }
    public func _view() -> any View { content }
}

struct _SceneWrap: Scene {
    let make: () -> any View
    func _view() -> any View { make() }
}

extension Scene {
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping (V, V) -> Void) -> some Scene {
        let inner = self
        return _SceneWrap { AnyView(any: inner._view()).onChange(of: value, initial: initial, action) }
    }
    public func onChange<V: Equatable>(of value: V, initial: Bool = false, _ action: @escaping () -> Void) -> some Scene {
        onChange(of: value, initial: initial) { _, _ in action() }
    }
    public func defaultSize(width: CGFloat, height: CGFloat) -> some Scene { self }
    public func windowResizability(_ r: Any) -> some Scene { self }
    public func commands<C>(@_CommandsBuilder content: () -> C) -> some Scene { self }
    public func backgroundTask<D>(_ t: Any, action: @escaping (D) async -> Void) -> some Scene { self }
}

@resultBuilder public struct _CommandsBuilder { public static func buildBlock<each C>(_ c: repeat each C) {} }

@resultBuilder public struct SceneBuilder {
    public static func buildBlock<S: Scene>(_ s: S) -> S { s }
    public static func buildBlock<S: Scene, T: Scene>(_ s: S, _ t: T) -> S { s }
    public static func buildExpression<S: Scene>(_ s: S) -> S { s }
}

/** App ist im Vordergrund, solange das Fenster sichtbar ist */
@MainActor enum _Scene {
    static var phase: ScenePhase = .active
    static func setPhase(_ v: String) {
        let p: ScenePhase = v == "background" ? .background : v == "inactive" ? .inactive : .active
        if p != phase { phase = p; _R.invalidate() }
    }
}

// MARK: Start

@MainActor public enum _Host {
    static var appName: String {
        ProcessInfo.processInfo.environment["STELLA_PC_TITLE"] ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String) ?? ProcessInfo.processInfo.processName
    }

    public static func run<A: App>(_ make: () -> A) {
        let R = _R
        let app = make()
        R.root = {
            _link(app)
            return _at(2) { _withAxis(.z) { _renderAny(app.body._view()) } }
        }
        setvbuf(stdout, nil, _IOLBF, 0)
        _registerSystemLanguage()
        let server = _Server()
        server.title = appName
        R.send = { frame in server.broadcast(frame) }
        server.onMessage = { msg in DispatchQueue.main.async { MainActor.assumeIsolated { _R.handle(msg) } } }
        server.onConnect = { DispatchQueue.main.async { MainActor.assumeIsolated { _R.invalidate() } } }
        let port = server.start()
        guard port > 0 else {
            print("Stella PC: konnte keinen Port auf 127.0.0.1 öffnen.")
            exit(1)
        }
        let url = "http://127.0.0.1:\(port)/?t=\(server.token)"
        print("Stella läuft: \(url)")
        if ProcessInfo.processInfo.environment["STELLA_PC_NO_BROWSER"] == nil { _openWindow(url) }
        R.invalidate()
        RunLoop.main.run()
    }
}

/** Fenster in Phonegröße: Edge/Chrome im App-Modus, sonst der Standardbrowser */
func _openWindow(_ url: String) {
    let fm = FileManager.default
    let size = "--window-size=440,940"
    let profile = _dataDir().appendingPathComponent("window").path
    func launch(_ exe: String, _ args: [String]) -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run(); return true } catch { return false }
    }
    let appArgs = ["--app=\(url)", size, "--user-data-dir=\(profile)", "--no-first-run", "--no-default-browser-check"]
    #if os(Windows)
    let env = ProcessInfo.processInfo.environment
    let candidates = [
        (env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)") + "\\Microsoft\\Edge\\Application\\msedge.exe",
        (env["ProgramFiles"] ?? "C:\\Program Files") + "\\Microsoft\\Edge\\Application\\msedge.exe",
        (env["ProgramFiles"] ?? "C:\\Program Files") + "\\Google\\Chrome\\Application\\chrome.exe",
        (env["LOCALAPPDATA"] ?? "") + "\\Google\\Chrome\\Application\\chrome.exe",
    ]
    for c in candidates where fm.fileExists(atPath: c) { if launch(c, appArgs) { return } }
    _ = launch((env["SystemRoot"] ?? "C:\\Windows") + "\\System32\\cmd.exe", ["/c", "start", "", url])
    #elseif os(macOS)
    for app in ["Google Chrome", "Microsoft Edge", "Chromium"] where fm.fileExists(atPath: "/Applications/\(app).app") {
        if launch("/usr/bin/open", ["-na", app, "--args"] + appArgs) { return }
    }
    _ = launch("/usr/bin/open", [url])
    #else
    for c in ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge", "/opt/pw-browsers/chromium"] where fm.fileExists(atPath: c) {
        if launch(c, appArgs) { return }
    }
    _ = launch("/usr/bin/xdg-open", [url])
    #endif
}

/** Ordner für Daten der PC-Version (Schlüsselbund-Ersatz, Fensterprofil) */
func _dataDir() -> URL {
    let env = ProcessInfo.processInfo.environment
    let base: URL
    #if os(Windows)
    base = URL(fileURLWithPath: env["APPDATA"] ?? NSHomeDirectory())
    #else
    base = URL(fileURLWithPath: env["XDG_DATA_HOME"] ?? (NSHomeDirectory() + "/.local/share"))
    #endif
    let id = env["STELLA_PC_DATA"].map { URL(fileURLWithPath: $0) } ?? base.appendingPathComponent("StellaPC").appendingPathComponent(ProcessInfo.processInfo.processName)
    try? FileManager.default.createDirectory(at: id, withIntermediateDirectories: true)
    return id
}

/** Sprache des PCs für die App (Foundation kennt sie unter Windows/Linux nicht zuverlässig).
    Nur als Vorgabe: was in der App gewählt wurde, gilt weiter. */
func _registerSystemLanguage() {
    let env = ProcessInfo.processInfo.environment
    var raw = env["STELLA_PC_LANG"] ?? ""
    #if os(Windows)
    if raw.isEmpty {
        var buf = [WCHAR](repeating: 0, count: 85)
        if GetUserDefaultLocaleName(&buf, Int32(buf.count)) > 0 { raw = String(decodingCString: buf, as: UTF16.self) }
    }
    #endif
    if raw.isEmpty { raw = env["LC_ALL"] ?? env["LC_MESSAGES"] ?? env["LANG"] ?? "" }
    let tag = raw.split(separator: ".").first.map(String.init)?.replacingOccurrences(of: "_", with: "-") ?? ""
    guard !tag.isEmpty, tag != "C", tag != "POSIX" else { return }
    let parts = tag.split(separator: "-")
    let base = parts.first.map { $0.lowercased() } ?? ""
    let lang = base == "pt" ? "pt-BR" : base
    UserDefaults.standard.register(defaults: ["stella.locale": lang, "pc.systemLocale": tag])
}
