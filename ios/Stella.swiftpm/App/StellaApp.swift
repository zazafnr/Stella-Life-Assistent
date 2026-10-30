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

enum Tab: Hashable { case today, chat, planner, goals, inbox }

struct RootView: View {
    @Environment(Store.self) private var store
    @AppStorage("evolsiorIntroShown") private var introShown = false
    @State private var launchDelayPassed = false
    @State private var tab: Tab = {
        switch Demo.tab {
        case "chat": return .chat
        case "planner": return .planner
        case "goals": return .goals
        case "inbox": return .inbox
        default: return .today
        }
    }()

    /** das EVOLSIOR-Intro läuft nur beim allerersten Start (nicht in den Screenshot-Läufen der CI) */
    private var showIntro: Bool { !introShown && Demo.token == nil }
    /** Ladebildschirm nur, wenn das Laden länger als 0,3 s dauert, damit nichts flackert */
    private var showLaunch: Bool { !store.ready && (launchDelayPassed || showIntro) }

    var body: some View {
        ZStack {
            content
            if showLaunch {
                LaunchView()
                    .transition(.opacity)
                    .zIndex(1)
            }
            if showIntro {
                IntroView { introShown = true }
                    .zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.2), value: showLaunch)
        .fullScreenCover(item: Binding(get: { store.loggedIn ? store.activeOnboarding : nil }, set: { if $0 == nil { store.onboardingRequest = nil } })) { start in
            OnboardingView(startAt: start)
                .environment(store)
        }
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            launchDelayPassed = true
        }
    }

    @ViewBuilder private var content: some View {
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
                if store.me?.has("goals") != false {
                    GoalsView()
                        .tabItem { Label("Ziele", systemImage: "target") }
                        .tag(Tab.goals)
                }
                if store.me?.has("mails") != false {
                    InboxView()
                        .tabItem { Label("Inbox", systemImage: "tray") }
                        .tag(Tab.inbox)
                }
            }
            .task { store.start() }
            .transition(.opacity)
        } else {
            LoginView()
                .transition(.opacity)
        }
    }
}
