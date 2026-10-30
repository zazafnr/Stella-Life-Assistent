import SwiftUI

@MainActor
struct LoginView: View {
    @Environment(Store.self) private var store
    @State private var register = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var server = API.shared.server
    @State private var showServer = false
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focus: Field?

    enum Field { case name, email, password }

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
                            .submitLabel(.go)
                            .onSubmit { Task { await submit() } }
                            .modifier(InputStyle())

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
                            if busy { ProgressView().tint(.white) } else { Text(register ? "Konto erstellen" : "Anmelden") }
                        }
                        .buttonStyle(PrimaryButton())
                        .disabled(busy || email.isEmpty || password.isEmpty || (register && password.count < 8))
                        .padding(.top, 4)

                        Button(register ? "Schon ein Konto? Anmelden" : "Noch kein Konto?") {
                            withAnimation(.spring) { register.toggle() }
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .padding(.top, 4)
                    }
                    .card(padding: 22)
                    .frame(maxWidth: 420)
                    .rise(1)

                    Button("Server: \(server.replacingOccurrences(of: "https://", with: ""))") { showServer = true }
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.faint)
                        .padding(.top, 8)
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
            if let s: ServerStatus = try? await API.shared.get("/api/status"), !s.hasUsers { register = true }
        }
    }

    private func field(_ title: String, text: Binding<String>, field: Field) -> some View {
        TextField(title, text: text)
            .focused($focus, equals: field)
            .autocorrectionDisabled()
            .submitLabel(.next)
            .onSubmit { focus = field == .name ? .email : .password }
            .modifier(InputStyle())
    }

    private func submit() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await store.authenticate(register: register, name: name, email: email.trimmingCharacters(in: .whitespaces), password: password)
        } catch {
            withAnimation { self.error = error.localizedDescription }
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
