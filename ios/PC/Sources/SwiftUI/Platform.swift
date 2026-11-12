// Was am PC nicht da ist (Kamera, Schrittzähler, Mikrofon …), gibt es hier so, dass die App
// sauber auf „nicht verfügbar“ läuft. Was der PC kann (Fotos wählen, Mitteilungen, Zwischenablage,
// Ton abspielen, Links öffnen), geht über das Fenster.

public typealias OSStatus = Int32

// MARK: UIKit

public final class UIImage: @unchecked Sendable {
    let data: Data
    let mime: String
    public let size: CGSize
    public var scale: CGFloat { 1 }

    nonisolated public init?(data: Data) {
        guard let info = _imageInfo(data) else { return nil }
        self.data = data; mime = info.0; size = info.1
    }
    nonisolated public convenience init?(systemName: String) { return nil }
    nonisolated public convenience init?(named: String) { return nil }
    nonisolated public convenience init?(contentsOfFile path: String) {
        guard let d = FileManager.default.contents(atPath: path) else { return nil }
        self.init(data: d)
    }
    /** Am PC wird nicht neu kodiert: das Original geht zum Server */
    public func jpegData(compressionQuality: CGFloat) -> Data? { data }
    public func pngData() -> Data? { data }
    public func draw(in rect: CGRect) {}
    public func preparingThumbnail(of size: CGSize) -> UIImage? { self }
}

/** Format und Größe aus dem Dateikopf (PNG, JPEG, GIF, WebP) */
func _imageInfo(_ d: Data) -> (String, CGSize)? {
    let b = [UInt8](d.prefix(64 * 1024))
    if b.count > 24, b[0] == 0x89, b[1] == 0x50 {
        let w = Int(b[16]) << 24 | Int(b[17]) << 16 | Int(b[18]) << 8 | Int(b[19])
        let h = Int(b[20]) << 24 | Int(b[21]) << 16 | Int(b[22]) << 8 | Int(b[23])
        return ("image/png", CGSize(width: w, height: h))
    }
    if b.count > 10, b[0] == 0x47, b[1] == 0x49 { return ("image/gif", CGSize(width: Int(b[6]) | Int(b[7]) << 8, height: Int(b[8]) | Int(b[9]) << 8)) }
    if b.count > 30, b[0] == 0x52, b[1] == 0x49, b[8] == 0x57 { return ("image/webp", CGSize(width: 1000, height: 1000)) }
    if b.count > 4, b[0] == 0xFF, b[1] == 0xD8 {
        var i = 2
        while i + 9 < b.count {
            guard b[i] == 0xFF else { i += 1; continue }
            let m = b[i + 1]
            let len = Int(b[i + 2]) << 8 | Int(b[i + 3])
            if (0xC0...0xCF).contains(m), m != 0xC4, m != 0xC8, m != 0xCC {
                let h = Int(b[i + 5]) << 8 | Int(b[i + 6]), w = Int(b[i + 7]) << 8 | Int(b[i + 8])
                return ("image/jpeg", CGSize(width: w, height: h))
            }
            i += 2 + len
        }
        return ("image/jpeg", CGSize(width: 1000, height: 1000))
    }
    if b.count > 12, b[4] == 0x66, b[5] == 0x74, b[6] == 0x79, b[7] == 0x70 { return ("image/heic", CGSize(width: 1000, height: 1000)) }
    return nil
}

public final class UIGraphicsImageRendererFormat {
    public var scale: CGFloat = 1
    public var opaque = false
    nonisolated public init() {}
    public static func `default`() -> UIGraphicsImageRendererFormat { .init() }
}

public final class UIGraphicsImageRendererContext {}

public final class UIGraphicsImageRenderer {
    nonisolated public init(size: CGSize, format: UIGraphicsImageRendererFormat = .default()) {}
    nonisolated public init(size: CGSize) {}
    /** Ohne Grafik-Bibliothek: es bleibt das zuletzt gezeichnete Bild */
    public func image(actions: (UIGraphicsImageRendererContext) -> Void) -> UIImage {
        _drawn = nil
        actions(UIGraphicsImageRendererContext())
        return _drawn ?? UIImage(data: Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]))!
    }
}
nonisolated(unsafe) var _drawn: UIImage?

extension UIImage {
    /** im Renderer gezeichnet: am PC einfach das Bild selbst übernehmen */
    public func draw(at p: CGPoint) { _drawn = self }
}

public final class UIColor: @unchecked Sendable {
    let color: Color
    nonisolated public init(red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat) { color = Color(.sRGB, red: Double(red), green: Double(green), blue: Double(blue), opacity: Double(alpha)) }
    nonisolated public init(white: CGFloat, alpha: CGFloat) { color = Color(.sRGB, white: Double(white), opacity: Double(alpha)) }
    nonisolated public init(_ c: Color) { color = c }
    public static let white = UIColor(white: 1, alpha: 1), black = UIColor(white: 0, alpha: 1), clear = UIColor(white: 0, alpha: 0)
    public static let systemBackground = UIColor(white: 1, alpha: 1), secondarySystemBackground = UIColor(Color(0xF2F2F7)), label = UIColor(white: 0, alpha: 1)
    public static let systemGroupedBackground = UIColor(Color(0xF2F2F7)), secondaryLabel = UIColor(Color(0x3C3C43, 0.6)), separator = UIColor(Color(0x3C3C43, 0.29))
}

public final class UIScreen {
    public static let main = UIScreen()
    public var bounds: CGRect { MainActor.assumeIsolated { CGRect(origin: .zero, size: _R.screen) } }
    public var scale: CGFloat { 2 }
}

public enum UIUserInterfaceIdiom: Int, Sendable { case unspecified = -1, phone, pad, tv, carPlay, mac, vision }

public final class UIDevice {
    public static let current = UIDevice()
    public var userInterfaceIdiom: UIUserInterfaceIdiom { .phone }
    public var name: String { "PC" }
    public var model: String { "PC" }
    public var systemName: String {
        #if os(Windows)
        return "Windows"
        #else
        return "Linux"
        #endif
    }
    public var systemVersion: String { ProcessInfo.processInfo.operatingSystemVersionString }
    public var identifierForVendor: UUID? { UUID() }
}

public final class UIApplication {
    public static let shared = UIApplication()
    public static let openSettingsURLString = "app-settings:"
    public static let openNotificationSettingsURLString = "app-settings:notifications"
    public var applicationIconBadgeNumber = 0
    public func open(_ url: URL, options: [String: Any] = [:], completionHandler: ((Bool) -> Void)? = nil) {
        MainActor.assumeIsolated { _R.message(["k": "open", "url": .s(url.absoluteString)]) }
        completionHandler?(true)
    }
    public func canOpenURL(_ url: URL) -> Bool { url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto" }
    public func registerForRemoteNotifications() {}
    public enum State: Sendable { case active, inactive, background }
    public var applicationState: State { .active }
    public func setAlternateIconName(_ n: String?) async throws {}
}

public final class UIPasteboard {
    public static let general = UIPasteboard()
    var local: String?
    public var string: String? {
        get { local }
        set { local = newValue; if let v = newValue { MainActor.assumeIsolated { _R.message(["k": "copy", "s": .s(v)]) } } }
    }
    public var hasStrings: Bool { local != nil }
    public var url: URL?
    public var image: UIImage?
}

public final class UIImpactFeedbackGenerator {
    public enum FeedbackStyle: Int, Sendable { case light, medium, heavy, soft, rigid }
    nonisolated public init(style: FeedbackStyle = .medium) {}
    public func impactOccurred() {}
    public func impactOccurred(intensity: CGFloat) {}
    public func prepare() {}
}

public final class UINotificationFeedbackGenerator {
    public enum FeedbackType: Int, Sendable { case success, warning, error }
    nonisolated public init() {}
    public func notificationOccurred(_ t: FeedbackType) {}
    public func prepare() {}
}

public final class UISelectionFeedbackGenerator {
    nonisolated public init() {}
    public func selectionChanged() {}
}

open class UIResponder: NSObject {}
open class UIView: UIResponder {
    nonisolated public override init() {}
    nonisolated public init(frame: CGRect) {}
}
open class UIViewController: UIResponder {
    nonisolated public override init() {}
    open func dismiss(animated: Bool, completion: (() -> Void)? = nil) {}
}
public protocol UINavigationControllerDelegate: AnyObject {}

open class UIImagePickerController: UIViewController {
    public enum SourceType: Int, Sendable { case photoLibrary, camera, savedPhotosAlbum }
    public struct InfoKey: Hashable, Sendable { let v: String; public static let originalImage = InfoKey(v: "o"), editedImage = InfoKey(v: "e") }
    public var sourceType: SourceType = .photoLibrary
    public var allowsEditing = false
    public weak var delegate: (UIImagePickerControllerDelegate & UINavigationControllerDelegate)?
    public static func isSourceTypeAvailable(_ t: SourceType) -> Bool { t != .camera }
}

public protocol UIImagePickerControllerDelegate: AnyObject {
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any])
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController)
}
extension UIImagePickerControllerDelegate {
    public func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {}
    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {}
}

// MARK: UIKit in SwiftUI einbetten – am PC ein Hinweis statt der nativen Ansicht

public struct UIViewControllerRepresentableContext<R: UIViewControllerRepresentable> {
    public let coordinator: R.Coordinator
    public var environment: EnvironmentValues { MainActor.assumeIsolated { _R.env } }
    public var transaction: Transaction { Transaction() }
}
public struct UIViewRepresentableContext<R: UIViewRepresentable> {
    public let coordinator: R.Coordinator
    public var environment: EnvironmentValues { MainActor.assumeIsolated { _R.env } }
    public var transaction: Transaction { Transaction() }
}

@MainActor public protocol UIViewControllerRepresentable: View, _Primitive where Body == Never {
    associatedtype UIViewControllerType
    associatedtype Coordinator = Void
    typealias Context = UIViewControllerRepresentableContext<Self>
    func makeUIViewController(context: Context) -> UIViewControllerType
    func updateUIViewController(_ c: UIViewControllerType, context: Context)
    func makeCoordinator() -> Coordinator
}

@MainActor public protocol UIViewRepresentable: View, _Primitive where Body == Never {
    associatedtype UIViewType
    associatedtype Coordinator = Void
    typealias Context = UIViewRepresentableContext<Self>
    func makeUIView(context: Context) -> UIViewType
    func updateUIView(_ v: UIViewType, context: Context)
    func makeCoordinator() -> Coordinator
}


extension UIViewControllerRepresentable where Coordinator == Void { public func makeCoordinator() -> Void {} }
extension UIViewRepresentable where Coordinator == Void { public func makeCoordinator() -> Void {} }

extension UIViewControllerRepresentable {
    public func _render() -> [_Node] {
        let l = _R.life(_mix(_R.path, 71))
        if l.last == nil {
            let c = makeCoordinator()
            let vc = makeUIViewController(context: UIViewControllerRepresentableContext(coordinator: c))
            l.last = (c, vc)
            if let n = vc as? _Native { return [n._node()] }
        } else if let (_, vc) = l.last as? (Coordinator, UIViewControllerType), let n = vc as? _Native {
            return [n._node()]
        }
        return [_unavailable("Diese Funktion gibt es nur auf dem iPhone.")]
    }
}

extension UIViewRepresentable {
    public func _render() -> [_Node] {
        let l = _R.life(_mix(_R.path, 72))
        if l.last == nil {
            let c = makeCoordinator()
            let v = makeUIView(context: UIViewRepresentableContext(coordinator: c))
            l.last = (c, v)
            if let n = v as? _Native { return [n._node()] }
        } else if let (_, v) = l.last as? (Coordinator, UIViewType), let n = v as? _Native {
            return [n._node()]
        }
        return [_unavailable("Diese Funktion gibt es nur auf dem iPhone.")]
    }
}

/** Native Ansicht, die am PC etwas Eigenes zeigt */
@MainActor protocol _Native { func _node() -> _Node }

@MainActor func _unavailable(_ text: String, url: String? = nil) -> _Node {
    var p: [String: _J] = ["s": .s(text)]
    if let url { p["url"] = .s(url); p["open"] = _R.handler("open") { _R.message(["k": "open", "url": .s(url)]) } }
    let n = _Node("native", p)
    n.gw = true; n.gh = true
    return n
}


// MARK: SafariServices

public final class SFSafariViewController: UIViewController, _Native {
    let url: URL
    nonisolated public init(url: URL) {
        self.url = url
        super.init()
        MainActor.assumeIsolated { _R.message(["k": "open", "url": .s(url.absoluteString)]) }
    }
    public struct Configuration { public init() {}; public var entersReaderIfAvailable = false; public var barCollapsingEnabled = true }
    nonisolated public convenience init(url: URL, configuration: Configuration) { self.init(url: url) }
    public var preferredControlTintColor: UIColor?
    func _node() -> _Node { _unavailable("Die Seite ist in deinem Browser geöffnet.", url: url.absoluteString) }
}

// MARK: WebKit

public final class WKWebsiteDataStore {
    public static func nonPersistent() -> WKWebsiteDataStore { WKWebsiteDataStore() }
    public static func `default`() -> WKWebsiteDataStore { WKWebsiteDataStore() }
    public let httpCookieStore = WKHTTPCookieStore()
}
public final class WKHTTPCookieStore {
    public func allCookies() async -> [HTTPCookie] { [] }
    public func getAllCookies(_ done: @escaping ([HTTPCookie]) -> Void) { done([]) }
}
public final class WKWebViewConfiguration {
    nonisolated public init() {}
    public var websiteDataStore = WKWebsiteDataStore()
}
public final class WKNavigation {}
public struct WKFrameInfo { public var isMainFrame = true }
public final class WKNavigationAction { public var request = URLRequest(url: URL(string: "about:blank")!); public var targetFrame: WKFrameInfo? }
public final class WKWindowFeatures {}
public protocol WKNavigationDelegate: AnyObject {}
public protocol WKUIDelegate: AnyObject {}

public final class WKWebView: UIView, _Native {
    public let configuration: WKWebViewConfiguration
    public weak var navigationDelegate: WKNavigationDelegate?
    public weak var uiDelegate: WKUIDelegate?
    var url: URL?
    nonisolated public init(frame: CGRect, configuration: WKWebViewConfiguration) { self.configuration = configuration; super.init() }
    @discardableResult public func load(_ r: URLRequest) -> WKNavigation? { url = r.url; return nil }
    func _node() -> _Node {
        _unavailable("Die Anmeldeseite des Anbieters öffnet sich am PC im Browser. Für die App-Anmeldung hier bitte am iPhone verbinden.", url: url?.absoluteString)
    }
}

// MARK: VisionKit

open class DataScannerViewController: UIViewController {
    public enum QualityLevel: Sendable { case fast, balanced, accurate }
    public enum RecognizedDataType: Sendable { case text(languages: [String] = []); case barcode(symbologies: [Symbology] = []) }
    public struct Symbology: Sendable { public static let qr = Symbology() }
    public static var isSupported: Bool { false }
    public static var isAvailable: Bool { false }
    public weak var delegate: DataScannerViewControllerDelegate?
    public var isScanning: Bool { false }
    nonisolated public init(recognizedDataTypes: Set<AnyHashable> = [], qualityLevel: QualityLevel = .balanced, recognizesMultipleItems: Bool = false, isHighFrameRateTrackingEnabled: Bool = true, isPinchToZoomEnabled: Bool = true, isGuidanceEnabled: Bool = true, isHighlightingEnabled: Bool = false) { super.init() }
    nonisolated public convenience init(recognizedDataTypes: [RecognizedDataType], qualityLevel: QualityLevel = .balanced, isHighlightingEnabled: Bool = false) { self.init() }
    public func startScanning() throws {}
    public func stopScanning() {}
}
public protocol DataScannerViewControllerDelegate: AnyObject {}
public enum RecognizedItem: Sendable {
    public struct Barcode: Sendable { public var payloadStringValue: String? }
    public struct Text: Sendable { public var transcript: String }
    case barcode(Barcode)
    case text(Text)
}

// MARK: AuthenticationServices

public struct ASWebAuthenticationSessionError: Error, Sendable {
    public enum Code: Int, Sendable { case canceledLogin = 1, presentationContextNotProvided, presentationContextInvalid }
    public let code: Code
    public static let canceledLogin = Code.canceledLogin
}

public struct WebAuthenticationSession {
    public func authenticate(using url: URL, callbackURLScheme: String, preferredBrowserSession: Any? = nil) async throws -> URL {
        MainActor.assumeIsolated { _R.message(["k": "toast", "s": "Diese Anmeldung kommt am PC nicht in die App zurück. Verbinde das Konto bitte auf der Stella-Website oder am iPhone."]) }
        throw ASWebAuthenticationSessionError(code: .canceledLogin)
    }
    public func authenticate(using url: URL, callback: Any, preferredBrowserSession: Any? = nil, additionalHeaderFields: [String: String] = [:]) async throws -> URL {
        try await authenticate(using: url, callbackURLScheme: "")
    }
}
extension EnvironmentValues { public var webAuthenticationSession: WebAuthenticationSession { WebAuthenticationSession() } }

public final class ASWebAuthenticationSession {
    nonisolated public init(url: URL, callbackURLScheme: String?, completionHandler: @escaping (URL?, Error?) -> Void) { self.done = completionHandler }
    let done: (URL?, Error?) -> Void
    public var prefersEphemeralWebBrowserSession = false
    public var presentationContextProvider: AnyObject?
    @discardableResult public func start() -> Bool { done(nil, ASWebAuthenticationSessionError(code: .canceledLogin)); return false }
    public func cancel() {}
}

// MARK: Security (Schlüsselbund als Datei im Benutzerordner)

public let errSecSuccess: OSStatus = 0
public let errSecItemNotFound: OSStatus = -25300
public let errSecDuplicateItem: OSStatus = -25299
public typealias CFString = String
public typealias CFDictionary = [String: Any]
public typealias CFTypeRef = AnyObject
public let kSecClass = "class", kSecClassGenericPassword = "genp", kSecAttrService = "svce", kSecAttrAccount = "acct"
public let kSecReturnData = "r_Data", kSecMatchLimit = "m_Limit", kSecMatchLimitOne = "m_LimitOne", kSecMatchLimitAll = "m_LimitAll"
public let kSecValueData = "v_Data", kSecAttrAccessible = "pdmn", kSecAttrAccessibleAfterFirstUnlock = "ck", kSecAttrAccessibleWhenUnlocked = "ak"
public let kSecAttrAccessGroup = "agrp", kSecAttrSynchronizable = "sync", kSecAttrLabel = "labl", kSecReturnAttributes = "r_Attributes"

enum _Keychain {
    static let lock = NSLock()
    static var file: URL { _dataDir().appendingPathComponent("schluesselbund.json") }
    static func load() -> [String: String] {
        guard let d = try? Data(contentsOf: file), let o = try? JSONSerialization.jsonObject(with: d) as? [String: String] else { return [:] }
        return o
    }
    static func save(_ m: [String: String]) {
        guard let d = try? JSONSerialization.data(withJSONObject: m) else { return }
        try? d.write(to: file, options: .atomic)
    }
    static func key(_ q: [String: Any]) -> String { "\(q[kSecAttrService] as? String ?? "")/\(q[kSecAttrAccount] as? String ?? "")" }
}

public func SecItemCopyMatching(_ q: CFDictionary, _ out: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus {
    _Keychain.lock.lock(); defer { _Keychain.lock.unlock() }
    guard let v = _Keychain.load()[_Keychain.key(q)], let d = Data(base64Encoded: v) else { return errSecItemNotFound }
    out?.pointee = NSData(data: d)
    return errSecSuccess
}

public func SecItemAdd(_ q: CFDictionary, _ out: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus {
    _Keychain.lock.lock(); defer { _Keychain.lock.unlock() }
    var m = _Keychain.load()
    let k = _Keychain.key(q)
    if m[k] != nil { return errSecDuplicateItem }
    guard let d = q[kSecValueData] as? Data else { return -50 }
    m[k] = d.base64EncodedString()
    _Keychain.save(m)
    return errSecSuccess
}

public func SecItemUpdate(_ q: CFDictionary, _ attrs: CFDictionary) -> OSStatus {
    _Keychain.lock.lock(); defer { _Keychain.lock.unlock() }
    var m = _Keychain.load()
    let k = _Keychain.key(q)
    guard m[k] != nil, let d = attrs[kSecValueData] as? Data else { return errSecItemNotFound }
    m[k] = d.base64EncodedString()
    _Keychain.save(m)
    return errSecSuccess
}

@discardableResult public func SecItemDelete(_ q: CFDictionary) -> OSStatus {
    _Keychain.lock.lock(); defer { _Keychain.lock.unlock() }
    var m = _Keychain.load()
    let k = _Keychain.key(q)
    guard m.removeValue(forKey: k) != nil else { return errSecItemNotFound }
    _Keychain.save(m)
    return errSecSuccess
}

// MARK: UserNotifications (über das Fenster als PC-Mitteilung)

public enum UNAuthorizationStatus: Int, Sendable { case notDetermined, denied, authorized, provisional, ephemeral }
public struct UNAuthorizationOptions: OptionSet, Sendable {
    public let rawValue: UInt
    nonisolated public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let badge = UNAuthorizationOptions(rawValue: 1), sound = UNAuthorizationOptions(rawValue: 2), alert = UNAuthorizationOptions(rawValue: 4), provisional = UNAuthorizationOptions(rawValue: 8)
}
public struct UNNotificationPresentationOptions: OptionSet, Sendable {
    public let rawValue: UInt
    nonisolated public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let badge = UNNotificationPresentationOptions(rawValue: 1), sound = UNNotificationPresentationOptions(rawValue: 2), alert = UNNotificationPresentationOptions(rawValue: 4)
    public static let list = UNNotificationPresentationOptions(rawValue: 8), banner = UNNotificationPresentationOptions(rawValue: 16)
}
public final class UNNotificationSound: @unchecked Sendable { public static let `default` = UNNotificationSound() }
public class UNNotificationContent: NSObject, @unchecked Sendable {
    public internal(set) var title = "", subtitle = "", body = ""
    public internal(set) var userInfo: [AnyHashable: Any] = [:]
    public internal(set) var sound: UNNotificationSound?
    public internal(set) var badge: NSNumber?
    public internal(set) var threadIdentifier = ""
}
public final class UNMutableNotificationContent: UNNotificationContent, @unchecked Sendable {
    public override var title: String { get { super.title } set { super.title = newValue } }
    public override var subtitle: String { get { super.subtitle } set { super.subtitle = newValue } }
    public override var body: String { get { super.body } set { super.body = newValue } }
    public override var userInfo: [AnyHashable: Any] { get { super.userInfo } set { super.userInfo = newValue } }
    public override var sound: UNNotificationSound? { get { super.sound } set { super.sound = newValue } }
    public override var badge: NSNumber? { get { super.badge } set { super.badge = newValue } }
    public override var threadIdentifier: String { get { super.threadIdentifier } set { super.threadIdentifier = newValue } }
}
public class UNNotificationTrigger: NSObject, @unchecked Sendable { public let repeats: Bool; init(repeats: Bool) { self.repeats = repeats } }
public final class UNCalendarNotificationTrigger: UNNotificationTrigger, @unchecked Sendable {
    public let dateComponents: DateComponents
    nonisolated public init(dateMatching: DateComponents, repeats: Bool) { dateComponents = dateMatching; super.init(repeats: repeats) }
    public func nextTriggerDate() -> Date? { Calendar.current.date(from: dateComponents) }
}
public final class UNTimeIntervalNotificationTrigger: UNNotificationTrigger, @unchecked Sendable {
    public let timeInterval: TimeInterval
    nonisolated public init(timeInterval: TimeInterval, repeats: Bool) { self.timeInterval = timeInterval; super.init(repeats: repeats) }
    public func nextTriggerDate() -> Date? { Date().addingTimeInterval(timeInterval) }
}
public final class UNNotificationRequest: NSObject, @unchecked Sendable {
    public let identifier: String
    public let content: UNNotificationContent
    public let trigger: UNNotificationTrigger?
    nonisolated public init(identifier: String, content: UNNotificationContent, trigger: UNNotificationTrigger?) { self.identifier = identifier; self.content = content; self.trigger = trigger }
}
public final class UNNotification: NSObject, @unchecked Sendable { public let request: UNNotificationRequest; public let date = Date(); init(_ r: UNNotificationRequest) { request = r } }
public final class UNNotificationResponse: NSObject, @unchecked Sendable { public let notification: UNNotification; public let actionIdentifier = "default"; init(_ n: UNNotification) { notification = n } }
public final class UNNotificationSettings: NSObject, @unchecked Sendable { public let authorizationStatus: UNAuthorizationStatus; init(_ s: UNAuthorizationStatus) { authorizationStatus = s } }
public protocol UNUserNotificationCenterDelegate: AnyObject {}

public final class UNUserNotificationCenter: @unchecked Sendable {
    static let shared = UNUserNotificationCenter()
    public static func current() -> UNUserNotificationCenter { shared }
    public weak var delegate: UNUserNotificationCenterDelegate?
    let lock = NSLock()
    var pending: [String: UNNotificationRequest] = [:]
    var allowed: Bool { UserDefaults.standard.object(forKey: "pc.notifications") as? Bool ?? false }

    public func requestAuthorization(options: UNAuthorizationOptions = []) async throws -> Bool {
        UserDefaults.standard.set(true, forKey: "pc.notifications")
        await MainActor.run { _R.message(["k": "notifyPermission"]) }
        return true
    }
    public func requestAuthorization(options: UNAuthorizationOptions = [], completionHandler: @escaping (Bool, Error?) -> Void) {
        UserDefaults.standard.set(true, forKey: "pc.notifications")
        completionHandler(true, nil)
    }
    public func notificationSettings() async -> UNNotificationSettings { UNNotificationSettings(allowed ? .authorized : .notDetermined) }
    public func getNotificationSettings(completionHandler: @escaping (UNNotificationSettings) -> Void) { completionHandler(UNNotificationSettings(allowed ? .authorized : .notDetermined)) }
    public func pendingNotificationRequests() async -> [UNNotificationRequest] { lock.lock(); defer { lock.unlock() }; return Array(pending.values) }
    public func add(_ r: UNNotificationRequest) async throws {
        lock.lock(); pending[r.identifier] = r; lock.unlock()
        let at: Date?
        if let t = r.trigger as? UNCalendarNotificationTrigger { at = t.nextTriggerDate() } else if let t = r.trigger as? UNTimeIntervalNotificationTrigger { at = t.nextTriggerDate() } else { at = Date() }
        guard let at else { return }
        let msg: [String: _J] = ["k": "notify", "id": .s(r.identifier), "at": .n(at.timeIntervalSince1970 * 1000), "title": .s(r.content.title), "body": .s(r.content.body)]
        await MainActor.run { _R.message(msg) }
    }
    public func add(_ r: UNNotificationRequest, withCompletionHandler done: ((Error?) -> Void)? = nil) { Task { try? await add(r); done?(nil) } }
    public func removePendingNotificationRequests(withIdentifiers ids: [String]) {
        lock.lock(); for i in ids { pending[i] = nil }; lock.unlock()
        let list = ids
        DispatchQueue.main.async { MainActor.assumeIsolated { _R.message(["k": "unnotify", "ids": .a(list.map { .s($0) })]) } }
    }
    public func removeAllPendingNotificationRequests() { removePendingNotificationRequests(withIdentifiers: Array(pending.keys)) }
    public func removeAllDeliveredNotifications() {}
    public func removeDeliveredNotifications(withIdentifiers ids: [String]) {}
    public func deliveredNotifications() async -> [UNNotification] { [] }
    public func setBadgeCount(_ n: Int) async throws {}
}

// MARK: CoreLocation (am PC kein Standort)

public typealias CLLocationDegrees = Double
public typealias CLLocationAccuracy = Double
public typealias CLLocationDistance = Double
public let kCLLocationAccuracyBest: CLLocationAccuracy = -1
public let kCLLocationAccuracyNearestTenMeters: CLLocationAccuracy = 10
public let kCLLocationAccuracyHundredMeters: CLLocationAccuracy = 100
public let kCLLocationAccuracyKilometer: CLLocationAccuracy = 1000
public let kCLLocationAccuracyThreeKilometers: CLLocationAccuracy = 3000
public struct CLLocationCoordinate2D: Sendable, Equatable {
    public var latitude: CLLocationDegrees, longitude: CLLocationDegrees
    nonisolated public init() { latitude = 0; longitude = 0 }
    nonisolated public init(latitude: CLLocationDegrees, longitude: CLLocationDegrees) { self.latitude = latitude; self.longitude = longitude }
}
public final class CLLocation: NSObject, @unchecked Sendable {
    public let coordinate: CLLocationCoordinate2D
    public let timestamp = Date()
    public var horizontalAccuracy: CLLocationAccuracy { 1000 }
    nonisolated public init(latitude: CLLocationDegrees, longitude: CLLocationDegrees) { coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
    public func distance(from l: CLLocation) -> CLLocationDistance {
        let r = 6_371_000.0, d1 = coordinate.latitude * .pi / 180, d2 = l.coordinate.latitude * .pi / 180
        let dl = (l.coordinate.longitude - coordinate.longitude) * .pi / 180, dp = d2 - d1
        let a = sin(dp / 2) * sin(dp / 2) + cos(d1) * cos(d2) * sin(dl / 2) * sin(dl / 2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
public enum CLAuthorizationStatus: Int32, Sendable { case notDetermined, restricted, denied, authorizedAlways, authorizedWhenInUse }
public protocol CLLocationManagerDelegate: AnyObject {}
public struct CLError: Error, Sendable { public enum Code: Int, Sendable { case locationUnknown, denied }; public let code: Code }
public final class CLLocationManager: NSObject {
    public weak var delegate: CLLocationManagerDelegate?
    public var desiredAccuracy: CLLocationAccuracy = kCLLocationAccuracyBest
    public var distanceFilter: CLLocationDistance = 0
    public var authorizationStatus: CLAuthorizationStatus { .denied }
    public var location: CLLocation? { nil }
    public static func locationServicesEnabled() -> Bool { false }
    public func requestWhenInUseAuthorization() {}
    public func requestAlwaysAuthorization() {}
    public func requestLocation() {}
    public func startUpdatingLocation() {}
    public func stopUpdatingLocation() {}
}

// MARK: CoreMotion (kein Schrittzähler)

public enum CMAuthorizationStatus: Int, Sendable { case notDetermined, restricted, denied, authorized }
public final class CMPedometerData: NSObject, @unchecked Sendable { public var numberOfSteps: NSNumber = 0; public var distance: NSNumber? }
public final class CMPedometer: NSObject {
    public static func isStepCountingAvailable() -> Bool { false }
    public static func isDistanceAvailable() -> Bool { false }
    public static func authorizationStatus() -> CMAuthorizationStatus { .restricted }
    public func queryPedometerData(from: Date, to: Date, withHandler h: @escaping (CMPedometerData?, Error?) -> Void) { h(nil, nil) }
    public func startUpdates(from: Date, withHandler h: @escaping (CMPedometerData?, Error?) -> Void) {}
    public func stopUpdates() {}
}

// MARK: AVFoundation (Abspielen übers Fenster, Aufnahme am PC aus)

public let AVFormatIDKey = "AVFormatIDKey", AVSampleRateKey = "AVSampleRateKey", AVNumberOfChannelsKey = "AVNumberOfChannelsKey"
public let AVEncoderBitRateKey = "AVEncoderBitRateKey", AVEncoderAudioQualityKey = "AVEncoderAudioQualityKey"
public let kAudioFormatMPEG4AAC: UInt32 = 0x61616320
public let kAudioFormatLinearPCM: UInt32 = 0x6C70636D

public enum AVAudioQuality: Int, Sendable { case min = 0, low = 0x20, medium = 0x40, high = 0x60, max = 0x7F }

public final class AVAudioApplication {
    public static let shared = AVAudioApplication()
    public static func requestRecordPermission() async -> Bool { false }
    public static func requestRecordPermission(completionHandler: @escaping (Bool) -> Void) { completionHandler(false) }
    public enum RecordPermission: Sendable { case undetermined, denied, granted }
    public var recordPermission: RecordPermission { .denied }
}

public final class AVAudioSession {
    public static func sharedInstance() -> AVAudioSession { AVAudioSession() }
    public struct Category: Sendable { public static let playback = Category(), playAndRecord = Category(), record = Category(), ambient = Category(), soloAmbient = Category() }
    public struct Mode: Sendable { public static let `default` = Mode(), spokenAudio = Mode(), voiceChat = Mode(), measurement = Mode() }
    public struct CategoryOptions: OptionSet, Sendable {
        public let rawValue: UInt
        nonisolated public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let defaultToSpeaker = CategoryOptions(rawValue: 1), mixWithOthers = CategoryOptions(rawValue: 2), duckOthers = CategoryOptions(rawValue: 4), allowBluetooth = CategoryOptions(rawValue: 8)
    }
    public struct SetActiveOptions: OptionSet, Sendable {
        public let rawValue: UInt
        nonisolated public init(rawValue: UInt) { self.rawValue = rawValue }
        public static let notifyOthersOnDeactivation = SetActiveOptions(rawValue: 1)
    }
    public func setCategory(_ c: Category, mode: Mode = .default, options: CategoryOptions = []) throws {}
    public func setCategory(_ c: Category) throws {}
    public func setActive(_ a: Bool, options: SetActiveOptions = []) throws {}
}

public struct _AVUnavailable: LocalizedError { public var errorDescription: String? { "Am PC gibt es keine Sprachaufnahme." } }

public final class AVAudioRecorder: NSObject {
    nonisolated public init(url: URL, settings: [String: Any]) throws { throw _AVUnavailable() }
    public var isMeteringEnabled = false
    public var isRecording: Bool { false }
    public var currentTime: TimeInterval { 0 }
    public func record() -> Bool { false }
    public func stop() {}
    public func updateMeters() {}
    public func averagePower(forChannel c: Int) -> Float { -160 }
    public func peakPower(forChannel c: Int) -> Float { -160 }
    public func deleteRecording() -> Bool { true }
}

public protocol AVAudioPlayerDelegate: AnyObject {
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool)
}

/** spielt im Fenster ab; das Ende meldet das Fenster zurück */
public final class AVAudioPlayer: NSObject {
    let id: String
    public weak var delegate: AVAudioPlayerDelegate?
    public private(set) var isPlaying = false
    public var volume: Float = 1
    public var duration: TimeInterval = 0
    public var currentTime: TimeInterval = 0
    nonisolated public init(data: Data, fileTypeHint: String? = nil) throws {
        let mime = fileTypeHint == "m4a" ? "audio/mp4" : fileTypeHint == "mp3" ? "audio/mpeg" : fileTypeHint.map { "audio/\($0)" } ?? "audio/mp4"
        id = MainActor.assumeIsolated { _resource(data, mime: mime) }
        super.init()
    }
    nonisolated public convenience init(contentsOf url: URL, fileTypeHint: String? = nil) throws {
        try self.init(data: try Data(contentsOf: url), fileTypeHint: fileTypeHint ?? url.pathExtension)
    }
    @discardableResult public func play() -> Bool {
        isPlaying = true
        let me = self
        MainActor.assumeIsolated {
            _hostHooks["audioEnded:\(id)"] = { _ in
                me.isPlaying = false
                me.delegate?.audioPlayerDidFinishPlaying(me, successfully: true)
            }
            _R.message(["k": "audio", "id": .s(id), "do": "play"])
        }
        return true
    }
    public func pause() { isPlaying = false; MainActor.assumeIsolated { _R.message(["k": "audio", "id": .s(id), "do": "pause"]) } }
    public func stop() { isPlaying = false; MainActor.assumeIsolated { _R.message(["k": "audio", "id": .s(id), "do": "stop"]) } }
    public func prepareToPlay() -> Bool { true }
}

extension AVAudioPlayerDelegate {
    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {}
}

// MARK: Foundation-Lücken unter Windows/Linux

extension ProcessInfo {
    public var isLowPowerModeEnabled: Bool { false }
}

public struct HTTPCookieStringPolicy: RawRepresentable, Hashable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public static let sameSiteLax = HTTPCookieStringPolicy(rawValue: "lax"), sameSiteStrict = HTTPCookieStringPolicy(rawValue: "strict")
}

extension HTTPCookie {
    public var sameSitePolicy: HTTPCookieStringPolicy? { nil }
}

extension URLSessionConfiguration {
    /** am PC ohne Wirkung (die App setzt waitsForConnectivity) */
    public var _pcIgnored: Bool { get { false } set {} }
}
