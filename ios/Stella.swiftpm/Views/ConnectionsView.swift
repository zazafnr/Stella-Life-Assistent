import AuthenticationServices
import SwiftUI
import VisionKit
import WebKit

/// Verbindungen einrichten – so weit es geht mit „anmelden“ statt Passwörter abtippen:
/// Gmail über Google, Schulbücher auf der echten Anbieter-Seite, WebUntis per QR-Code.
@MainActor
struct ConnectionsView: View {
    @Environment(Store.self) private var store
    @Environment(\.webAuthenticationSession) private var webAuth
    @Environment(\.openURL) private var openURL
    @State private var accounts: [MailAccount] = []
    @State private var loginPages: [String: LoginPage] = [:]
    @State private var bookLogin: BookProvider?
    @State private var shelf: [ShelfEntry] = []
    @State private var showICloud = false
    @State private var showScanner = false
    @State private var showUntisForm = false
    @State private var busy: String?
    @State private var message: (ok: Bool, text: String)?

    struct ShelfEntry: Identifiable {
        var provider: String
        var book: ShelfBook
        var id: String { book.url }
    }

    struct BookProvider: Identifiable {
        var id: String
        var name: String
    }

    private let providers = [BookProvider(id: "scook", name: "scook"), BookProvider(id: "digi4school", name: "digi4school")]

    var body: some View {
        Form {
            if let message {
                Section {
                    Label(message.text, systemImage: message.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(message.ok ? Theme.green : Theme.pinkText)
                }
            }

            mailSection
            booksSection
            untisSection
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("Verbindungen")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(busy != nil)
        .overlay { if let busy { BusyOverlay(text: busy) } }
        .sheet(item: $bookLogin) { p in
            if let page = loginPages[p.id] {
                BookLoginSheet(name: p.name, page: page) { cookies in
                    bookLogin = nil
                    Task { await saveBookCookies(provider: p.id, name: p.name, cookies: cookies) }
                }
            }
        }
        .sheet(isPresented: $showICloud) { ICloudSheet { await loadAccounts() } }
        .sheet(isPresented: $showScanner) {
            QRScannerSheet { code in
                showScanner = false
                Task { await connectUntis(["qr": code]) }
            }
        }
        .sheet(isPresented: $showUntisForm) { UntisForm { fields in await connectUntis(fields) } }
        .task {
            await loadAccounts()
            loginPages = (try? await API.shared.get("/api/integrations/books/login-pages", as: [String: LoginPage].self)) ?? [:]
        }
    }

    // MARK: E-Mail

    private var mailSection: some View {
        Section {
            ForEach(accounts) { a in
                HStack(spacing: 12) {
                    Text(a.provider == "gmail" ? "📮" : a.provider == "icloud" ? "☁️" : "✉️").font(.system(size: 22))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(a.label).font(.system(size: 16, weight: .semibold))
                        Text(a.lastError ?? a.user)
                            .font(.system(size: 13))
                            .foregroundStyle(a.lastError == nil ? Theme.muted : Theme.pinkText)
                            .lineLimit(2)
                    }
                    Spacer()
                    Pill(text: a.auth == "google" ? "Google" : "App-Passwort", tone: a.auth == "google" ? .green : .gray)
                }
                .swipeActions {
                    Button("Entfernen", role: .destructive) { Task { await deleteAccount(a) } }
                    if a.provider == "gmail" && store.me?.integrations.googleSignIn == true {
                        Button("Google") { Task { await signInWithGoogle(email: a.user) } }.tint(Theme.blue)
                    }
                }
            }
            if store.me?.integrations.googleSignIn == true {
                Button { Task { await signInWithGoogle() } } label: {
                    HStack(spacing: 10) {
                        Text("G").font(.system(size: 17, weight: .heavy, design: .rounded))
                            .foregroundStyle(LinearGradient(colors: [Color(hex: 0x4285F4), Color(hex: 0xEA4335), Color(hex: 0xFBBC05), Color(hex: 0x34A853)], startPoint: .topLeading, endPoint: .bottomTrailing))
                        Text("Mit Google anmelden").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.text)
                    }
                }
            }
            Button { showICloud = true } label: { Label("iCloud-Mail hinzufügen", systemImage: "icloud") }
        } header: {
            Text("E-Mail")
        } footer: {
            Text(store.me?.integrations.googleSignIn == true
                 ? "Gmail: anmelden und „Zulassen“ – kein Passwort nötig. Zeigt Google „App nicht überprüft“: „Erweitert“ → „Weiter zu Stella“ – das ist deine eigene Stella."
                 : "Gmail mit Google-Anmeldung muss auf dem Server einmal eingerichtet werden (docs/google-oauth.md).")
        }
    }

    private func loadAccounts() async {
        accounts = (try? await API.shared.get("/api/mail/accounts", as: [MailAccount].self)) ?? accounts
    }

    private func deleteAccount(_ a: MailAccount) async {
        if let list = try? await API.shared.send("DELETE", "/api/mail/accounts/\(a.id)", as: [MailAccount].self) { accounts = list }
        await store.refreshMe()
    }

    /** Google im Systemfenster (ASWebAuthenticationSession) – Stella fängt die Rückkehr über stella-auth:// ab */
    private func signInWithGoogle(email: String? = nil) async {
        struct Body: Encodable { var client = "ios"; var email: String? }
        do {
            struct Start: Decodable { var url: String }
            let start = try await API.shared.send("POST", "/api/oauth/google/start", body: Body(email: email), as: Start.self)
            guard let url = URL(string: start.url) else { return }
            let callback = try await webAuth.authenticate(using: url, callbackURLScheme: "stella-auth")
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let ok = items.first { $0.name == "ok" }?.value == "1"
            let text = items.first { $0.name == "message" }?.value ?? (ok ? "Gmail ist verbunden." : "Hat nicht geklappt.")
            show(ok, text)
            await loadAccounts()
            await store.refreshMe()
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            // abgebrochen – nichts anzeigen
        } catch {
            show(false, error.localizedDescription)
        }
    }

    // MARK: Schulbücher

    private var booksSection: some View {
        Section {
            ForEach(providers) { p in
                let state = store.me?.integrations.books[p.id]
                Button { bookLogin = p } label: {
                    HStack {
                        Label(state?.connected == true ? "\(p.name) – neu anmelden" : "Bei \(p.name) anmelden", systemImage: "books.vertical")
                        Spacer()
                        if state?.connected == true { Pill(text: "verbunden", icon: "checkmark", tone: .green) }
                    }
                }
                .disabled(loginPages[p.id] == nil)
            }
            ForEach(shelf) { entry in
                Picker(selection: Binding(
                    get: { store.me?.settings.books?.first { $0.url == entry.book.url }?.subject ?? "" },
                    set: { subject in Task { await assign(entry.book, provider: entry.provider, subject: subject) } }
                )) {
                    Text("Fach …").tag("")
                    ForEach(Self.subjects, id: \.self) { Text($0).tag($0) }
                } label: {
                    Text(entry.book.title.isEmpty ? entry.book.url : entry.book.title).lineLimit(2)
                }
            }
        } header: {
            Text("Schulbücher")
        } footer: {
            Text(shelf.isEmpty
                 ? "Du meldest dich auf der echten Seite an – auch mit Schul- oder Microsoft-Login. Stella übernimmt nur die Anmeldung, dein Passwort sieht sie nie."
                 : "Wähl zu jedem Buch das Fach – dann weiß Stella, wo sie bei „Latein HÜ S. 45“ nachschauen muss.")
        }
    }

    static let subjects = ["Mathe", "Deutsch", "Englisch", "Latein", "Französisch", "Spanisch", "Italienisch", "Biologie",
                           "Chemie", "Physik", "Geschichte", "Geografie", "Informatik", "Musik", "Religion", "Psychologie"]

    private struct CookiesBody: Encodable { var cookies: [WebCookie]; var verify = true }
    private struct VerifyResponse: Decodable { var ok: Bool; var shelf: [ShelfBook]? }

    private func saveBookCookies(provider: String, name: String, cookies: [WebCookie]) async {
        guard !cookies.isEmpty else { show(false, "Keine Anmeldung gefunden – bitte erst fertig einloggen, dann „Fertig“."); return }
        busy = "Prüfe die Anmeldung bei \(name) …"
        defer { busy = nil }
        do {
            let res = try await API.shared.send("PUT", "/api/integrations/books/\(provider)", body: CookiesBody(cookies: cookies), as: VerifyResponse.self)
            shelf.removeAll { $0.provider == provider }
            shelf += (res.shelf ?? []).map { ShelfEntry(provider: provider, book: $0) }
            show(true, res.shelf?.isEmpty == false ? "Angemeldet! Ordne deine Bücher unten einem Fach zu." : "Angemeldet bei \(name).")
            await store.refreshMe()
        } catch {
            show(false, error.localizedDescription)
        }
    }

    private func assign(_ book: ShelfBook, provider: String, subject: String) async {
        guard !subject.isEmpty else { return }
        var books = (store.me?.settings.books ?? []).filter { $0.subject != subject && $0.url != book.url }
        books.append(BookConfig(subject: subject, provider: provider, url: book.url, pageOffset: 0))
        struct Body: Encodable { var books: [BookConfig] }
        do {
            store.me = try await API.shared.send("PATCH", "/api/settings", body: Body(books: books), as: Me.self)
            Haptics.success()
        } catch {
            show(false, error.localizedDescription)
        }
    }

    // MARK: WebUntis

    private var untisSection: some View {
        Section {
            if DataScannerViewController.isSupported {
                Button { showScanner = true } label: { Label("QR-Code aus der Untis-App scannen", systemImage: "qrcode.viewfinder") }
            }
            Button { showUntisForm = true } label: { Label("Mit Schule und Passwort", systemImage: "person.badge.key") }
            if store.me?.integrations.webuntis == true {
                Button("WebUntis trennen", role: .destructive) {
                    Task {
                        _ = try? await API.shared.send("DELETE", "/api/integrations/webuntis", as: OK.self)
                        await store.refreshMe()
                    }
                }
            }
        } header: {
            HStack {
                Text("WebUntis")
                if store.me?.integrations.webuntis == true { Spacer(); Pill(text: "verbunden", icon: "checkmark", tone: .green) }
            }
        } footer: {
            Text("QR-Code: in der Untis-App (oder auf webuntis.com) → Profil → Freigaben → Zugriff über Untis Mobile → „Anzeigen“.")
        }
    }

    private func connectUntis(_ fields: [String: String]) async {
        busy = "Verbinde mit WebUntis …"
        defer { busy = nil }
        do {
            _ = try await API.shared.send("PUT", "/api/integrations/webuntis", body: fields, as: OK.self)
            show(true, "WebUntis ist verbunden – dein Stundenplan kommt gleich.")
            showUntisForm = false
            await store.refreshMe()
        } catch {
            show(false, error.localizedDescription)
        }
    }

    private func show(_ ok: Bool, _ text: String) {
        withAnimation(.spring) { message = (ok, text) }
        if ok { Haptics.success() }
    }
}

// MARK: - Bausteine

struct BusyOverlay: View {
    var text: String
    var body: some View {
        VStack(spacing: 14) {
            HoppingStar(size: 30)
            Text(text).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.text).multilineTextAlignment(.center)
        }
        .padding(28)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: Theme.blue.opacity(0.15), radius: 20)
        .padding(40)
        .transition(.scale.combined(with: .opacity))
    }
}

/** Cookie in der Form, die der Server versteht (books.ts → normalizeCookies) */
struct WebCookie: Encodable {
    var name: String
    var value: String
    var domain: String
    var path: String
    var expires: Double?
    var httpOnly: Bool
    var secure: Bool
    var sameSite: String?

    init(_ c: HTTPCookie) {
        name = c.name
        value = c.value
        domain = c.domain
        path = c.path
        expires = c.expiresDate?.timeIntervalSince1970
        httpOnly = c.isHTTPOnly
        secure = c.isSecure
        sameSite = c.sameSitePolicy?.rawValue
    }
}

/// Echte Anmeldeseite des Anbieters in einer eigenen, flüchtigen Sitzung.
/// „Fertig“ übernimmt die Cookies der Anbieter-Domains.
@MainActor
struct BookLoginSheet: View {
    var name: String
    var page: LoginPage
    var onDone: ([WebCookie]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var webView = WKWebView(frame: .zero, configuration: {
        let c = WKWebViewConfiguration()
        c.websiteDataStore = .nonPersistent()
        return c
    }())
    @State private var loading = true

    var body: some View {
        NavigationStack {
            WebViewBox(webView: webView, url: URL(string: page.url), loading: $loading)
                .ignoresSafeArea(edges: .bottom)
                .overlay(alignment: .top) {
                    if loading { ProgressView().padding(.top, 12) }
                }
                .safeAreaInset(edge: .top) {
                    Text("Melde dich ganz normal an und tippe dann auf „Fertig“.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(Theme.blueTint)
                }
                .navigationTitle(name)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Fertig") { Task { await finish() } }.fontWeight(.semibold)
                    }
                }
        }
    }

    private func finish() async {
        let pattern = try? NSRegularExpression(pattern: page.domains, options: .caseInsensitive)
        let all = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        let picked = all.filter { c in
            let d = c.domain.hasPrefix(".") ? String(c.domain.dropFirst()) : c.domain
            return pattern?.firstMatch(in: d, range: NSRange(d.startIndex..., in: d)) != nil
        }
        onDone(picked.map(WebCookie.init))
    }
}

struct WebViewBox: UIViewRepresentable {
    var webView: WKWebView
    var url: URL?
    @Binding var loading: Bool

    func makeUIView(context: Context) -> WKWebView {
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        if let url { webView.load(URLRequest(url: url)) }
        return webView
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(loading: $loading) }

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var loading: Binding<Bool>
        init(loading: Binding<Bool>) { self.loading = loading }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading.wrappedValue = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading.wrappedValue = false }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loading.wrappedValue = false }

        // Login-Popups (z. B. Microsoft) im selben Fenster öffnen
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
            return nil
        }
    }
}

/// iCloud hat keine Anmeldung für fremde Apps – Schritt für Schritt zum App-Passwort.
@MainActor
struct ICloudSheet: View {
    var onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    step(1, "App-Passwort erstellen", "Apple erlaubt fremden Apps kein normales Anmelden – dafür gibt es App-Passwörter. Dein Apple-Passwort bleibt geheim.")
                    Button { if let u = URL(string: "https://account.apple.com/account/manage") { openURL(u) } } label: {
                        Label("account.apple.com öffnen", systemImage: "arrow.up.forward.app")
                    }
                    step(2, "Anmeldung und Sicherheit → App-spezifische Passwörter", "Auf „+“ tippen, Name „Stella“, dann das Passwort kopieren (xxxx-xxxx-xxxx-xxxx).")
                    step(3, "Hier einfügen", "Zusammen mit deiner iCloud-Adresse.")
                }
                Section {
                    TextField("name@icloud.com", text: $email)
                        .keyboardType(.emailAddress).textContentType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("App-Passwort", text: $password)
                    if let error { Text(error).foregroundStyle(Theme.pinkText).font(.system(size: 14)) }
                }
                Section {
                    Button { Task { await save() } } label: {
                        if busy { ProgressView() } else { Text("Verbinden").fontWeight(.semibold) }
                    }
                    .disabled(busy || email.isEmpty || password.count < 8)
                }
            }
            .navigationTitle("iCloud-Mail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
        }
    }

    private func step(_ n: Int, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(Theme.blue, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 15, weight: .semibold))
                Text(text).font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
        }
        .padding(.vertical, 2)
    }

    private func save() async {
        struct Body: Encodable { var provider = "icloud"; var user: String; var pass: String; var label = "iCloud" }
        busy = true
        defer { busy = false }
        do {
            _ = try await API.shared.send("POST", "/api/mail/accounts", body: Body(user: email, pass: password), as: [MailAccount].self)
            await onSaved()
            Haptics.success()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// WebUntis mit Schule, Benutzer und Passwort (wenn kein QR-Code zur Hand ist)
@MainActor
struct UntisForm: View {
    var onSave: ([String: String]) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var server = ""
    @State private var school = ""
    @State private var username = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Server, z. B. neilo.webuntis.com", text: $server)
                    TextField("Schule (wie in der Untis-App)", text: $school)
                    TextField("Benutzername", text: $username)
                    SecureField("Passwort", text: $password)
                } footer: {
                    Text("Den Server siehst du auf webuntis.com in der Adresszeile, nachdem du deine Schule gesucht hast.")
                }
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                Section {
                    Button("Verbinden") {
                        Task { await onSave(["server": server, "school": school, "username": username, "password": password]) }
                    }
                    .disabled(server.isEmpty || school.isEmpty || username.isEmpty || password.isEmpty)
                }
            }
            .navigationTitle("WebUntis")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
        }
    }
}

/// QR-Code der Untis-App mit der Kamera lesen (VisionKit)
struct QRScannerSheet: View {
    var onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            QRScanner(onCode: onCode)
                .ignoresSafeArea()
                .overlay(alignment: .bottom) {
                    Text("Halte die Kamera auf den QR-Code aus der Untis-App.")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 12)
                        .background(.black.opacity(0.55), in: Capsule())
                        .padding(.bottom, 40)
                }
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
        }
    }
}

struct QRScanner: UIViewControllerRepresentable {
    var onCode: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])],
                                                qualityLevel: .balanced, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {
        if !controller.isScanning { try? controller.startScanning() }
    }

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    @MainActor final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        private var done = false
        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for item in addedItems {
                if case .barcode(let code) = item, let text = code.payloadStringValue, text.hasPrefix("untis://") {
                    done = true
                    dataScanner.stopScanning()
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    onCode(text)
                    return
                }
            }
        }
    }
}
