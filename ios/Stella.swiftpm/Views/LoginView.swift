import SwiftUI

@MainActor
struct LoginView: View {
    @Environment(Store.self) private var store
    @State private var register = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var invite = ""
    @State private var code = ""
    /** gesetzt, solange ein Code aus der Bestätigungs-Mail erwartet wird */
    @State private var verifying: String?
    @State private var info: String?
    @State private var wait = 0
    @State private var registration = "invite"
    @State private var hasUsers = true
    @State private var server = API.shared.server
    @State private var showServer = false
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focus: Field?

    enum Field { case name, email, password, invite, code }

    private var canRegister: Bool { !hasUsers || registration != "closed" }
    private var needsInvite: Bool { register && hasUsers && registration == "invite" }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            Sky(height: 420)
            ScrollView {
                VStack(spacing: 14) {
                    HoppingStar(size: 46)
                        .padding(.top, 70)
                    Text("Stella")
                        .font(Theme.display(44))
                        .foregroundStyle(Theme.text)
                    Text("Let Stella handle your life.")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .padding(.bottom, 18)

                    VStack(spacing: 12) {
                        if let verifying {
                            verifyFields(verifying)
                        } else {
                            credentialFields
                        }

                        if let info {
                            Text(info)
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if let error {
                            Text(error)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Theme.pinkText)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .transition(.opacity)
                        }

                        Button {
                            Task { await submit() }
                        } label: {
                            if busy { ProgressView().tint(.white) } else { Text(primaryTitle) }
                        }
                        .buttonStyle(PrimaryButton())
                        .disabled(busy || !canSubmit)
                        .padding(.top, 4)

                        secondaryButtons
                    }
                    .card(padding: 22)
                    .frame(maxWidth: 420)
                    .rise(1)

                    Button("Server: \(server.replacingOccurrences(of: "https://", with: ""))") { showServer = true }
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.faint)
                        .padding(.top, 8)

                    Text("by EVOLSIOR")
                        .font(.system(size: 11, weight: .medium))
                        .tracking(3.5)
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.faint)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .alert("Server-Adresse", isPresented: $showServer) {
            TextField("stella.example.at", text: $server)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Speichern") {
                API.shared.server = server
                server = API.shared.server
            }
            Button("Standard") {
                API.shared.server = API.defaultServer
                server = API.defaultServer
            }
            Button("Abbrechen", role: .cancel) { server = API.shared.server }
        } message: {
            Text("Normalerweise musst du hier nichts ändern.")
        }
        .task {
            if let s: ServerStatus = try? await API.shared.get("/api/status") {
                hasUsers = s.hasUsers
                registration = s.registration ?? "invite"
                if !s.hasUsers { register = true }
            }
        }
        .task(id: wait) {
            guard wait > 0 else { return }
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { wait -= 1 }
        }
    }

    // MARK: Felder

    @ViewBuilder private var credentialFields: some View {
        if register {
            field("Dein Name", text: $name, field: .name)
                .textContentType(.givenName)
        }
        field("E-Mail", text: $email, field: .email)
            .textContentType(.emailAddress)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
        SecureField("Passwort", text: $password)
            .textContentType(register ? .newPassword : .password)
            .focused($focus, equals: .password)
            .submitLabel(needsInvite ? .next : .go)
            .onSubmit { if needsInvite { focus = .invite } else { Task { await submit() } } }
            .modifier(InputStyle())
        if needsInvite {
            TextField("Einladungscode (ABCD-EFGH)", text: $invite)
                .focused($focus, equals: .invite)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .onSubmit { Task { await submit() } }
                .modifier(InputStyle())
        }
    }

    @ViewBuilder private func verifyFields(_ address: String) -> some View {
        Text("Wir haben dir einen 6-stelligen Code an \(address) geschickt. Er gilt 15 Minuten.")
            .font(.system(size: 14))
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
        TextField("123456", text: $code)
            .focused($focus, equals: .code)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .multilineTextAlignment(.center)
            .font(.system(size: 26, weight: .semibold).monospacedDigit())
            .tracking(6)
            .modifier(InputStyle())
            .onChange(of: code) { _, new in
                let digits = new.filter(\.isNumber)
                if digits != new { code = digits }
                if digits.count > 6 { code = String(digits.prefix(6)) }
            }
    }

    @ViewBuilder private var secondaryButtons: some View {
        if let verifying {
            Button(wait > 0 ? "Neuen Code senden (\(wait) s)" : "Neuen Code senden") { Task { await again(verifying) } }
                .font(.system(size: 15, weight: .semibold))
                .disabled(wait > 0)
                .padding(.top, 4)
            Button("Zurück zur Anmeldung") {
                withAnimation { self.verifying = nil; error = nil; info = nil; code = "" }
            }
            .font(.system(size: 14))
            .foregroundStyle(Theme.muted)
        } else if canRegister {
            Button(register ? "Schon ein Konto? Anmelden" : "Noch kein Konto?") {
                withAnimation(.spring) { register.toggle(); error = nil }
            }
            .font(.system(size: 15, weight: .semibold))
            .padding(.top, 4)
        } else {
            Text("Neue Konten sind gerade nicht möglich.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
        }
    }

    private var primaryTitle: String {
        if verifying != nil { return "Bestätigen" }
        return register ? "Konto erstellen" : "Anmelden"
    }

    private var canSubmit: Bool {
        if verifying != nil { return code.count == 6 }
        if email.isEmpty || password.isEmpty { return false }
        if register && password.count < 8 { return false }
        if needsInvite && invite.trimmingCharacters(in: .whitespaces).count < 8 { return false }
        return true
    }

    private func field(_ title: String, text: Binding<String>, field: Field) -> some View {
        TextField(title, text: text)
            .focused($focus, equals: field)
            .autocorrectionDisabled()
            .submitLabel(.next)
            .onSubmit { focus = field == .name ? .email : .password }
            .modifier(InputStyle())
    }

    // MARK: Aktionen

    private func submit() async {
        guard !busy else { return }
        busy = true
        error = nil
        info = nil
        defer { busy = false }
        do {
            if let address = verifying {
                try await store.verify(email: address, code: code)
            } else if let address = try await store.authenticate(register: register, name: name, email: email.trimmingCharacters(in: .whitespaces),
                                                                  password: password, invite: invite) {
                startVerifying(address, note: nil)
            }
        } catch let e as APIError where e.needsVerification {
            startVerifying(e.email ?? email, note: "Dein Konto ist noch nicht bestätigt. Gib den Code aus der Mail ein – oder fordere einen neuen an.")
        } catch {
            withAnimation { self.error = error.localizedDescription }
        }
    }

    private func startVerifying(_ address: String, note: String?) {
        withAnimation {
            verifying = address
            code = ""
            info = note
            wait = 60
        }
        focus = .code
    }

    private func again(_ address: String) async {
        error = nil
        do {
            try await store.resendCode(email: address)
            info = "Neuer Code ist unterwegs."
            wait = 60
        } catch let e as APIError {
            error = e.message
            // „Bitte warte noch 23 Sekunden …“ → Zähler übernehmen
            if let n = e.message.split(separator: " ").compactMap({ Int($0) }).first { wait = n }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct InputStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: 16))
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.border, lineWidth: 1.5))
    }
}
