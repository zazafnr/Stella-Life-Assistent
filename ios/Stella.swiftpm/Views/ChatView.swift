import PhotosUI
import SwiftUI

@MainActor
struct ChatView: View {
    @Environment(Store.self) private var store
    @State private var text = ""
    @State private var photos: [PhotosPickerItem] = []
    @State private var images: [UIImage] = []
    @State private var showCamera = false
    @State private var viewing: String?
    @FocusState private var focused: Bool

    private let suggestions = ["Latein HÜ S. 45 Nr. 3 Freitag", "Freitag 15 Uhr Friseur", "erinnere mich in 2 Stunden an die Wäsche", "Hab ich was vergessen?", "Briefing"]

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            Sky(height: 220)
            VStack(spacing: 0) {
                header
                messagesList
                composer
            }
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { image in images.append(image) }
                .ignoresSafeArea()
        }
        .sheet(item: Binding(get: { viewing.map(Viewing.init) }, set: { viewing = $0?.id })) { ImageViewer(id: $0.id) }
        .onChange(of: photos) { _, items in
            Task {
                for item in items {
                    if let data = try? await item.loadTransferable(type: Data.self), let ui = UIImage(data: data) {
                        images.append(ui)
                    }
                }
                photos = []
            }
        }
    }

    private struct Viewing: Identifiable { var id: String }

    // MARK: Kopf

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(.white).frame(width: 44, height: 44)
                    .shadow(color: Theme.pink.opacity(0.25), radius: 10)
                HoppingStar(size: 20)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Stella")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                HStack(spacing: 5) {
                    Circle().fill(store.online ? Theme.blue : Theme.faint).frame(width: 6, height: 6)
                    Text(status)
                        .font(.system(size: 13))
                        .foregroundStyle(store.online ? Theme.blue : Theme.muted)
                        .lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
    }

    private var status: String {
        if !store.online { return "offline – ich schicke es später" }
        if store.thinking { return "denkt nach …" }
        if let busy = store.busyLabel { return "löst gerade \(busy)" }
        return "online"
    }

    // MARK: Nachrichten

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(store.messages) { m in
                        Bubble(message: m, onImage: { viewing = $0 })
                            .id(m.id)
                            .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                    }
                    if store.thinking {
                        TypingDots()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("typing")
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: 780)
                .frame(maxWidth: .infinity)
                .animation(.spring(response: 0.4, dampingFraction: 0.85), value: store.messages.count)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: store.messages.count) { _, _ in scrollDown(proxy) }
            .onChange(of: store.thinking) { _, _ in scrollDown(proxy) }
            .onAppear { scrollDown(proxy, animated: false) }
        }
    }

    private func scrollDown(_ proxy: ScrollViewProxy, animated: Bool = true) {
        let target = store.thinking ? "typing" : store.messages.last?.id
        guard let target else { return }
        if animated { withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(target, anchor: .bottom) } }
        else { proxy.scrollTo(target, anchor: .bottom) }
    }

    // MARK: Eingabe

    private var composer: some View {
        VStack(spacing: 8) {
            if text.isEmpty && images.isEmpty && !focused {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(suggestions, id: \.self) { s in
                            Button(s) { text = s; focused = true }
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(.white, in: Capsule())
                                .overlay(Capsule().stroke(Theme.border))
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .transition(.opacity)
            }
            if !images.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(images.enumerated()), id: \.offset) { index, image in
                            Image(uiImage: image)
                                .resizable().scaledToFill()
                                .frame(width: 64, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(alignment: .topTrailing) {
                                    Button { images.remove(at: index) } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, Theme.text.opacity(0.7))
                                    }
                                    .offset(x: 5, y: -5)
                                }
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 6)
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    PhotosPicker(selection: $photos, maxSelectionCount: 4, matching: .images) {
                        Label("Fotos", systemImage: "photo.on.rectangle")
                    }
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { showCamera = true } label: { Label("Kamera", systemImage: "camera") }
                    }
                } label: {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.blue)
                        .frame(width: 40, height: 40)
                        .background(Theme.blueTint, in: Circle())
                }
                .accessibilityLabel("Foto anhängen")

                TextField("Schreib Stella …", text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .font(.system(size: 16))
                    .padding(.vertical, 10)
                    .submitLabel(.send)
                    .onSubmit(send)

                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(canSend ? Theme.blue : Theme.blue.opacity(0.35), in: Circle())
                        .scaleEffect(canSend ? 1 : 0.92)
                        .animation(.spring(response: 0.3), value: canSend)
                }
                .disabled(!canSend)
                .accessibilityLabel("Senden")
            }
            .padding(6)
            .background(.white, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .shadow(color: Theme.blue.opacity(0.12), radius: 16, y: 6)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
            .frame(maxWidth: 800)
        }
        .animation(.easeOut(duration: 0.2), value: focused)
    }

    private var canSend: Bool { !text.trimmingCharacters(in: .whitespaces).isEmpty || !images.isEmpty }

    private func send() {
        guard canSend else { return }
        let t = text
        let data = images.compactMap { $0.jpegForUpload() }
        text = ""
        images = []
        Task { await store.send(text: t, images: data) }
    }
}

// MARK: - Bausteine

struct Bubble: View {
    var message: ChatMessage
    var onImage: (String) -> Void

    var body: some View {
        HStack {
            if message.isUser { Spacer(minLength: 48) }
            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 6) {
                if !message.attachments.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(message.attachments) { a in
                            Button { onImage(a.id) } label: {
                                AuthImage(id: a.id)
                                    .frame(width: message.attachments.count == 1 ? 220 : 120, height: message.attachments.count == 1 ? 260 : 140)
                                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                        }
                    }
                }
                if !message.text.isEmpty {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(Self.markdown(message.text))
                            .font(.system(size: 16))
                            .foregroundStyle(message.isUser ? .white : Theme.text)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                        if let id = message.actionId { ActionCardView(id: id) }
                        HStack(spacing: 4) {
                            Text(time)
                            if message.pending == true { Image(systemName: "clock") }
                        }
                        .font(.system(size: 11))
                        .foregroundStyle(message.isUser ? .white.opacity(0.75) : Theme.faint)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(message.isUser ? Theme.blue : Theme.surface, in: BubbleShape(mine: message.isUser))
                    .shadow(color: Theme.blue.opacity(message.isUser ? 0.22 : 0.07), radius: 10, y: 4)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 560, alignment: message.isUser ? .trailing : .leading)
                    .textSelection(.enabled)
                }
            }
            if !message.isUser { Spacer(minLength: 48) }
        }
    }

    private var time: String {
        guard let d = ISO.parse(message.createdAt) else { return "" }
        return d.formatted(date: .omitted, time: .shortened)
    }

    /** **fett** und Links wie in der Web-App, Zeilenumbrüche bleiben */
    static func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }
}

struct BubbleShape: Shape {
    var mine: Bool
    func path(in rect: CGRect) -> Path {
        let r: CGFloat = 20, small: CGFloat = 6
        return Path(roundedRect: rect, cornerRadii: RectangleCornerRadii(
            topLeading: r, bottomLeading: mine ? r : small, bottomTrailing: mine ? small : r, topTrailing: r), style: .continuous)
    }
}

struct TypingDots: View {
    @State private var on = false
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { i in
                Circle().fill(Theme.blue.opacity(0.6)).frame(width: 7, height: 7)
                    .offset(y: on ? -4 : 2)
                    .animation(.easeInOut(duration: 0.45).repeatForever().delay(Double(i) * 0.15), value: on)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Theme.surface, in: BubbleShape(mine: false))
        .shadow(color: Theme.blue.opacity(0.07), radius: 10, y: 4)
        .onAppear { on = true }
    }
}

/** Kamera über UIKit – SwiftUI hat keine eigene */
struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let c = UIImagePickerController()
        c.sourceType = .camera
        c.delegate = context.coordinator
        return c
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

extension UIImage {
    /** verkleinert auf höchstens 2000 px und als JPEG – Buchseiten bleiben lesbar */
    func jpegForUpload(maxSide: CGFloat = 2000) -> Data? {
        let longest = max(size.width, size.height)
        let scale = longest > maxSide ? maxSide / longest : 1
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
        return resized.jpegData(compressionQuality: 0.72)
    }
}

/// Unter einer Stella-Nachricht: Vorschlag mit Ja/Nein oder Erledigtes mit „Rückgängig“
@MainActor
struct ActionCardView: View {
    var id: String
    @Environment(Store.self) private var store
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        if let action = store.actions[id] {
            VStack(alignment: .leading, spacing: 6) {
                if action.proposed {
                    HStack(spacing: 8) {
                        Button { run("approve") } label: {
                            Label("Ja, mach das", systemImage: "checkmark")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(Theme.blue, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        Button { run("reject") } label: {
                            Text("Nein")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.blue)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(Theme.blueTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(busy)
                } else {
                    HStack(spacing: 10) {
                        Label(Self.label(action.status), systemImage: action.status == "done" ? "checkmark" : "circle.slash")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(action.status == "done" ? Theme.green : action.status == "failed" ? Theme.pinkText : Theme.muted)
                        if action.canUndo {
                            Button("Rückgängig") { run("undo") }
                                .font(.system(size: 13, weight: .semibold))
                                .disabled(busy)
                        }
                    }
                }
                if let error { Text(error).font(.system(size: 12)).foregroundStyle(Theme.pinkText) }
            }
            .padding(.top, 6)
            .transition(.opacity)
        }
    }

    static func label(_ status: String) -> String {
        switch status {
        case "done": return "Erledigt"
        case "rejected": return "Abgelehnt"
        case "undone": return "Rückgängig gemacht"
        case "failed": return "Hat nicht geklappt"
        default: return "Wartet auf dich"
        }
    }

    private func run(_ decision: String) {
        busy = true
        error = nil
        Task {
            do { try await store.decide(id, decision) } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}
