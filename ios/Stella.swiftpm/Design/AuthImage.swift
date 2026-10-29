import SwiftUI

/// Bild vom Stella-Server (Buchseite, Foto, gelöste HÜ). Braucht den Login-Token.
struct AuthImage: View {
    var id: String
    var contentMode: ContentMode = .fill
    @State private var image: UIImage?
    @State private var failed = false

    private static let cache = NSCache<NSString, UIImage>()

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else if failed {
                Image(systemName: "photo").foregroundStyle(Theme.faint)
            } else {
                Rectangle().fill(Theme.blueTint).overlay(ProgressView())
            }
        }
        .task(id: id) { await load() }
    }

    private func load() async {
        if let hit = Self.cache.object(forKey: id as NSString) { image = hit; return }
        do {
            let data = try await API.shared.file(id)
            if let ui = UIImage(data: data) {
                Self.cache.setObject(ui, forKey: id as NSString)
                image = ui
            } else {
                failed = true
            }
        } catch {
            failed = true
        }
    }
}

/// Vollbild-Ansicht mit Zoom und Teilen
struct ImageViewer: View {
    var id: String
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1

    var body: some View {
        NavigationStack {
            ScrollView([.horizontal, .vertical]) {
                AuthImage(id: id, contentMode: .fit)
                    .scaleEffect(scale)
                    .gesture(MagnifyGesture().onChanged { scale = max(1, $0.magnification) })
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(Color.black.opacity(0.92))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } }
            }
            .toolbarBackground(.visible, for: .navigationBar)
        }
    }
}
