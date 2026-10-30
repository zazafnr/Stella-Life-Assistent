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
    @State private var showHistory = false
    @State private var showList = false
    @State private var recorder = VoiceRecorder()
    @State private var pressing = false
    @State private var cancelling = false
    @State private var showMicDenied = false
    @Environment(\.openURL) private var openURL
    @FocusState private var focused: Bool

    @State private var hint: String?

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            // der ganze Chat liegt unter einem Himmel mit ziehenden Wolken (bei „Bewegung reduzieren“ stehen sie still)
            Sky(height: UIScreen.main.bounds.height)
            VStack(spacing: 0) {
                header
                messagesList
                composer
            }
            if let hint {
                Text(hint)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Theme.text.opacity(0.9), in: Capsule())
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 130)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring, value: hint)
        .task { await store.loadQuick() }
        .sheet(isPresented: $showHistory) {
            ChatHistorySheet()
        }
        .sheet(isPresented: $showList) {
            ShoppingListSheet()
        }
        .onAppear { recorder.onLimit = { finishRecording(cancel: false) } }
        .onChange(of: recorder.denied) { _, denied in
            if denied { showMicDenied = true; recorder.denied = false }
        }
        .alert("Mikrofon nicht erlaubt", isPresented: $showMicDenied) {
            Button("Einstellungen") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Für Sprachnachrichten braucht Stella das Mikrofon. Du kannst es in den iOS-Einstellungen erlauben.")
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
            Button { showHistory = true } label: {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .background(.white, in: Circle())
                    .shadow(color: Theme.blue.opacity(0.1), radius: 6, y: 2)
            }
            .accessibilityLabel("Alle Chats")
            Button {
                Task { await store.newConversation() }
            } label: {
                Label("Neuer Chat", systemImage: "plus")
                    .font(.system(size: 14, weight: .semibold))
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(.white, in: Capsule())
                    .shadow(color: Theme.blue.opacity(0.1), radius: 6, y: 2)
            }
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
                    if store.messages.isEmpty && !store.thinking { emptyState }
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
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
                // weiche, durchscheinende Spalte in Milchglas – darauf liegen die Nachrichten
                .background(.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(.white.opacity(0.7), lineWidth: 1))
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
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
            if text.isEmpty && images.isEmpty && !focused && !store.messages.isEmpty && !recorder.isRecording {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(store.quick.actions) { a in
                            Button { run(a) } label: {
                                Label(a.label, systemImage: a.symbol)
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(Theme.text)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(.white, in: Capsule())
                                    .overlay(Capsule().stroke(Theme.border))
                            }
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
                if recorder.isRecording {
                    recordingBar
                } else {
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
                }

                if canSend {
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(Theme.blue, in: Circle())
                    }
                    .accessibilityLabel("Senden")
                } else {
                    micButton
                }
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

    // MARK: Schnellaktionen

    /** Begrüßung und vier große Karten, solange der Chat noch leer ist */
    private var emptyState: some View {
        VStack(spacing: 12) {
            HoppingStar(size: 38)
            Text("Hi\(store.me.map { ", \($0.firstName)" } ?? "")!")
                .font(Theme.display(26))
                .foregroundStyle(Theme.text)
            Text("Wobei kann ich dir helfen? Tipp etwas an – oder sprich einfach los.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(store.quick.cards) { a in
                    Button { run(a) } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            Image(systemName: a.symbol)
                                .font(.system(size: 18))
                                .foregroundStyle(Theme.blue)
                                .frame(width: 40, height: 40)
                                .background(Theme.blueTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            Text(a.label)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.text)
                                .multilineTextAlignment(.leading)
                        }
                        .frame(maxWidth: .infinity, minHeight: 100, alignment: .topLeading)
                        .padding(12)
                        .background(.white.opacity(0.92), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .shadow(color: Theme.blue.opacity(0.08), radius: 10, y: 4)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.top, 6)
        }
        .padding(.vertical, 20)
    }

    private func run(_ a: QuickAction) {
        switch a.kind {
        case "send":
            Task { await store.send(text: a.text ?? a.label) }
        case "camera":
            showCamera = true
        case "list":
            showList = true
        case "mic":
            hint = "Halte den Mikrofon-Knopf unten rechts gedrückt"
            Task {
                try? await Task.sleep(for: .seconds(2.5))
                hint = nil
            }
        default:
            text = a.text ?? ""
            focused = true
        }
    }

    // MARK: Sprachnachricht

    /** Gedrückt halten = aufnehmen, loslassen = senden, nach links wischen = abbrechen */
    private var micButton: some View {
        Image(systemName: "mic.fill")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 40, height: 40)
            .background(recorder.isRecording ? (cancelling ? Theme.faint : Theme.pink) : Theme.blue, in: Circle())
            .scaleEffect(recorder.isRecording ? 1.3 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: recorder.isRecording)
            .contentShape(Circle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        if !pressing {
                            pressing = true
                            focused = false
                            Haptics.soft()
                            recorder.begin()
                        }
                        cancelling = drag.translation.width < -80
                    }
                    .onEnded { drag in
                        pressing = false
                        finishRecording(cancel: drag.translation.width < -80)
                        cancelling = false
                    }
            )
            .accessibilityLabel("Sprachnachricht – gedrückt halten zum Aufnehmen")
            .accessibilityAddTraits(.isButton)
    }

    private var recordingBar: some View {
        HStack(spacing: 10) {
            Circle().fill(cancelling ? Theme.faint : Theme.pink).frame(width: 10, height: 10)
                .opacity(recorder.seconds % 2 == 0 ? 1 : 0.4)
            Text(String(format: "%d:%02d", recorder.seconds / 60, recorder.seconds % 60))
                .font(.system(size: 16, weight: .semibold).monospacedDigit())
                .foregroundStyle(Theme.text)
            HStack(spacing: 3) {
                ForEach(0..<7, id: \.self) { i in
                    let weight = [0.2, 0.5, 0.8, 1, 0.8, 0.5, 0.2][i]
                    Capsule().fill(Theme.blue).frame(width: 4, height: 4 + recorder.level * weight * 22)
                }
            }
            .frame(height: 30)
            .animation(.easeOut(duration: 0.08), value: recorder.level)
            Spacer(minLength: 0)
            Text(cancelling ? "loslassen = abbrechen" : "← wischen zum Abbrechen")
                .font(.system(size: 13))
                .foregroundStyle(cancelling ? Theme.pinkText : Theme.muted)
                .lineLimit(1)
        }
        .padding(.leading, 8)
        .frame(height: 40)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func finishRecording(cancel: Bool) {
        guard let rec = recorder.end(cancel: cancel) else {
            if recorder.tooShort { Haptics.soft() }
            return
        }
        Task { await store.sendVoice(fileURL: rec.url, seconds: rec.seconds) }
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
    @Environment(Store.self) private var store

    var body: some View {
        HStack {
            if message.isUser { Spacer(minLength: 48) }
            VStack(alignment: message.isUser ? .trailing : .leading, spacing: 6) {
                if message.attachments.contains(where: { $0.kind != "audio" }) {
                    HStack(spacing: 6) {
                        ForEach(message.attachments.filter { $0.kind != "audio" }) { a in
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
                        ForEach(message.attachments.filter { $0.kind == "audio" }) { a in
                            VoiceBubbleButton(id: a.id, onUser: message.isUser)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Text(Self.markdown(message.text))
                            .font(.system(size: 16))
                            .foregroundStyle(message.isUser ? .white : Theme.text)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                        if message.failedAudioId != nil {
                            Button("Nochmal versuchen") { Task { await store.retryVoice(message.id) } }
                                .buttonStyle(SoftButton(filled: false))
                                .disabled(store.thinking)
                        }
                        if let id = message.actionId { ActionCardView(id: id) }
                        if let card = message.card, card.type == "places" { PlacesCardView(card: card) }
                        if let card = message.card, card.type == "spending" { SpendingCardView(card: card) }
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

/** Play-Knopf mit Wellen für eine Sprachnachricht */
struct VoiceBubbleButton: View {
    var id: String
    var onUser: Bool
    @State private var playback = VoicePlayback()

    var body: some View {
        Button {
            Task { await playback.toggle(id: id) }
        } label: {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(onUser ? Color.white.opacity(0.25) : Theme.blueTint).frame(width: 34, height: 34)
                    if playback.loading {
                        ProgressView().controlSize(.small).tint(onUser ? .white : Theme.blue)
                    } else {
                        Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(onUser ? .white : Theme.blue)
                    }
                }
                HStack(spacing: 2) {
                    ForEach(0..<10, id: \.self) { i in
                        Capsule().frame(width: 3, height: CGFloat([5, 9, 14, 8, 16, 11, 6, 13, 9, 5][i]))
                    }
                }
                .foregroundStyle((onUser ? Color.white : Theme.blue).opacity(0.6))
                Text(playback.failed ? "nicht verfügbar" : "Sprachnachricht")
                    .font(.system(size: 13))
                    .foregroundStyle(onUser ? .white.opacity(0.85) : Theme.muted)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(playback.isPlaying ? "Pausieren" : "Sprachnachricht abspielen")
    }
}
