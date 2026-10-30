import SwiftUI

/** Server-Schlüssel – nur für den Owner (erster Nutzer). Ein eingetragener Schlüssel wird nie wieder angezeigt. */
@MainActor
struct ServerKeysView: View {
    struct KeyStatus: Codable, Hashable {
        var set: Bool
        var source: String?
        var lastOk: String?
        var lastError: String?
    }
    struct KeysResponse: Codable { var keys: [String: KeyStatus] }
    struct TestResponse: Codable {
        var ok: Bool
        var message: String
        var keys: [String: KeyStatus]
    }
    struct KeyBody: Encodable {
        var name: String
        var value: String?
    }
    struct SmtpValue: Encodable {
        var host: String
        var port: Int
        var user: String
        var pass: String
        var from: String
    }
    struct SmtpBody: Encodable {
        var name = "smtp"
        var value: SmtpValue?
    }

    @State private var keys: [String: KeyStatus] = [:]
    @State private var groqInput = ""
    @State private var openrouterInput = ""
    @State private var host = "smtp.gmail.com"
    @State private var port = "465"
    @State private var user = ""
    @State private var pass = ""
    @State private var from = ""
    @State private var message: String?
    @State private var failed = false
    @State private var busy = false

    var body: some View {
        Form {
            keySection(name: "groq", title: "Groq-API-Key", input: $groqInput, placeholder: "gsk_…",
                       hint: "Mails einordnen, Chat-Titel und Sprachnachrichten. Kostenlos erhältlich auf console.groq.com.")
            keySection(name: "openrouter", title: "OpenRouter-API-Key", input: $openrouterInput, placeholder: "sk-or-…",
                       hint: "Für Chat und Planer. Ohne Eintrag hier gilt der Schlüssel aus der Server-Umgebung.")
            smtpSection
            if let message {
                Section { Text(message).foregroundStyle(failed ? Theme.pinkText : Theme.green) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle("Server")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(busy)
        .task { await load() }
    }

    @ViewBuilder
    private func keySection(name: String, title: String, input: Binding<String>, placeholder: String, hint: String) -> some View {
        let status = keys[name]
        Section {
            Text(statusText(status))
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(status?.set == true ? Theme.green : Theme.pinkText)
            SecureField(status?.set == true ? "Neuen Schlüssel eintragen" : placeholder, text: input)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Speichern") {
                Task { await save(name, input.wrappedValue); input.wrappedValue = "" }
            }
            .disabled(input.wrappedValue.trimmingCharacters(in: .whitespaces).count < 8)
            Button("Testen") { Task { await test(name) } }
                .disabled(status?.set != true)
            if status?.source == "app" {
                Button("Entfernen", role: .destructive) { Task { await save(name, nil) } }
            }
        } header: {
            Text(title)
        } footer: {
            Text(hint)
        }
    }

    private var smtpSection: some View {
        let status = keys["smtp"]
        return Section {
            Text(statusText(status))
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(status?.set == true ? Theme.green : Theme.pinkText)
            TextField("Server", text: $host).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("Port", text: $port).keyboardType(.numberPad)
            TextField("Benutzer", text: $user).textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField("Passwort (App-Passwort)", text: $pass)
            TextField("Absender (optional)", text: $from).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Speichern") { Task { await saveSmtp() } }
                .disabled(host.isEmpty || user.isEmpty || pass.isEmpty || Int(port) == nil)
            Button("Testen") { Task { await test("smtp") } }
                .disabled(status?.set != true)
            if status?.set == true {
                Button("Entfernen", role: .destructive) { Task { await removeSmtp() } }
            }
        } header: {
            Text("E-Mail-Absender (SMTP)")
        } footer: {
            Text("Von hier gehen die Bestätigungs-Codes bei der Registrierung raus. Empfehlung: ein eigenes Gmail-Konto für Stella mit App-Passwort.")
        }
    }

    private func statusText(_ s: KeyStatus?) -> String {
        guard let s, s.set else { return "Fehlt" }
        var text = "Gesetzt"
        if s.source == "env" { text += " (Server-Umgebung)" }
        if s.lastOk != nil { text += " · zuletzt OK" }
        if let e = s.lastError { text += " · \(e)" }
        return text
    }

    private func load() async {
        do {
            let r: KeysResponse = try await API.shared.get("/api/admin/keys")
            keys = r.keys
        } catch {
            show(error.localizedDescription, failed: true)
        }
    }

    private func save(_ name: String, _ value: String?) async {
        await run(value == nil ? "Gelöscht." : "Gespeichert.") {
            let r: KeysResponse = try await API.shared.send("PUT", "/api/admin/keys", body: KeyBody(name: name, value: value))
            keys = r.keys
        }
    }

    private func saveSmtp() async {
        await run("Gespeichert.") {
            let value = SmtpValue(host: host, port: Int(port) ?? 465, user: user, pass: pass, from: from)
            let r: KeysResponse = try await API.shared.send("PUT", "/api/admin/keys", body: SmtpBody(value: value))
            keys = r.keys
            pass = ""
        }
    }

    private func removeSmtp() async {
        await run("Gelöscht.") {
            let r: KeysResponse = try await API.shared.send("PUT", "/api/admin/keys", body: SmtpBody(value: nil))
            keys = r.keys
        }
    }

    private func test(_ name: String) async {
        await run("Hat geklappt.") {
            let r: TestResponse = try await API.shared.send("POST", "/api/admin/keys/\(name)/test")
            keys = r.keys
            if !r.ok { throw APIError(message: r.message, status: 0) }
        }
    }

    private func run(_ ok: String, _ work: () async throws -> Void) async {
        busy = true
        message = nil
        do {
            try await work()
            show(ok, failed: false)
        } catch {
            show(error.localizedDescription, failed: true)
        }
        busy = false
    }

    private func show(_ text: String, failed: Bool) {
        message = text
        self.failed = failed
    }
}
