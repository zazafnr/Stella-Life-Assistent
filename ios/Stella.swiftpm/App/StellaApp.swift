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
        case "inbox": return .inbox
        default: return .today
        }
    }()
    /** Ziele haben keinen eigenen Tab mehr, sie öffnen sich als Blatt (von „Heute“, aus dem Briefing, aus Stellas Plan) */
    @State private var showGoals = Demo.tab == "goals"

    /** Tab wechseln; `.goals` öffnet stattdessen das Ziele-Blatt */
    private func open(_ t: Tab) {
        if t == .goals { showGoals = true } else { tab = t }
    }

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
        // Sprache des Kontos übernehmen (gilt für die ganze App)
        .onChange(of: store.me?.settings.locale) { _, l in if let l { I18n.shared.set(l) } }
        .task { if let l = store.me?.settings.locale { I18n.shared.set(l) } }
    }

    @ViewBuilder private var content: some View {
        if store.loggedIn {
            TabView(selection: $tab) {
                TodayView(go: { open($0) })
                    .tabItem { Label(L("nav.today"), systemImage: "sparkles") }
                    .tag(Tab.today)
                ChatView()
                    .tabItem { Label(L("nav.chat"), systemImage: "bubble.left.and.bubble.right") }
                    .tag(Tab.chat)
                PlannerView()
                    .tabItem { Label(L("nav.planner"), systemImage: "calendar") }
                    .tag(Tab.planner)
                    .badge(store.openHomework)
                if store.me?.has("mails") != false {
                    InboxView()
                        .tabItem { Label(L("nav.inbox"), systemImage: "tray") }
                        .tag(Tab.inbox)
                }
            }
            .sheet(isPresented: $showGoals) {
                GoalsView()
                    .environment(store)
                    .presentationDragIndicator(.visible)
            }
            .task { store.start() }
            .task(id: store.me?.id) { if store.me != nil { WeatherService.shared.start(permission: store.me?.settings.locationPermission) } }
            // Bildschirmzeit (nur im Xcode-Build): gesammelte Ereignisse der Erweiterung zum Server schicken
            .task(id: store.me?.id) {
                #if canImport(FamilyControls) && STELLA_SCREENTIME
                if store.me != nil { await ScreenTimeManager.shared.syncEvents() }
                #endif
            }
            .transition(.opacity)
        } else {
            LoginView()
                .transition(.opacity)
        }
    }
}
