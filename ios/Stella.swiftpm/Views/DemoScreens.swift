import SwiftUI

/** Weitere Screens für die Klick-Vorschau (CI): `-open subscription|news|memory|perms|lists|history`.
 Im normalen Betrieb wird nichts davon geöffnet. */
extension Demo {
    static let extraScreens = ["subscription", "news", "memory", "perms", "lists", "history"]
    static var opensExtra: Bool { extraScreens.contains(UserDefaults.standard.string(forKey: "open") ?? "") }
}

struct DemoScreenSheet: View {
    var body: some View {
        switch UserDefaults.standard.string(forKey: "open") ?? "" {
        case "subscription": NavigationStack { PlanSettingsView() }
        case "news": NavigationStack { NewsSettingsView() }
        case "memory": NavigationStack { MemoryView() }
        case "perms": NavigationStack { PermissionsView() }
        case "lists": ShoppingListSheet()
        case "history": ChatHistorySheet()
        default: EmptyView()
        }
    }
}
