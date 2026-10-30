import SwiftUI

@main
struct StellaApp: App {
    @State private var store = Store()
    @Environment(\.scenePhase) private var phase

    init() {
        Notifier.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .preferredColorScheme(.light)
                .tint(Theme.blue)
        }
        .onChange(of: phase) { _, p in
            switch p {
            case .active: store.start()
            case .background: store.stop()
            default: break
            }
        }
    }
}

enum Tab: Hashable { case today, chat, planner, inbox }

struct RootView: View {
    @Environment(Store.self) private var store
    @State private var tab: Tab = {
        switch Demo.tab {
        case "chat": return .chat
        case "planner": return .planner
        case "inbox": return .inbox
        default: return .today
        }
    }()

    var body: some View {
        if store.loggedIn {
            TabView(selection: $tab) {
                TodayView(go: { tab = $0 })
                    .tabItem { Label("Heute", systemImage: "sparkles") }
                    .tag(Tab.today)
                ChatView()
                    .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
                    .tag(Tab.chat)
                PlannerView()
                    .tabItem { Label("Planer", systemImage: "calendar") }
                    .tag(Tab.planner)
                    .badge(store.openHomework)
                InboxView()
                    .tabItem { Label("Inbox", systemImage: "tray") }
                    .tag(Tab.inbox)
            }
            .task { store.start() }
            .transition(.opacity)
        } else {
            LoginView()
                .transition(.opacity)
        }
    }
}
