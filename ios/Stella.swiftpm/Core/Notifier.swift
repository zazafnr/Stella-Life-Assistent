import Foundation
import UserNotifications

/// Plant Stellas Erinnerungen als lokale Mitteilungen ein. Die kommen damit auch ohne Netz
/// und ohne Push-Zertifikat pünktlich (z. B. "Morgen: Latein HÜ" am Vorabend).
final class Notifier: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = Notifier()
    private let center = UNUserNotificationCenter.current()
    private let prefix = "stella-"

    func activate() {
        center.delegate = self
    }

    @discardableResult
    func requestPermission() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func status() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func schedule(_ reminders: [UpcomingReminder]) async {
        guard await status() == .authorized else { return }
        let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        center.removePendingNotificationRequests(withIdentifiers: pending)

        // iOS erlaubt 64 geplante Mitteilungen pro App
        for r in reminders.prefix(60) {
            guard let date = ISO.parse(r.fireAt), date > Date() else { continue }
            let content = UNMutableNotificationContent()
            content.title = "Stella"
            content.body = r.message.replacingOccurrences(of: "**", with: "")
            content.sound = .default
            if let item = r.itemId { content.userInfo = ["itemId": item] }
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: prefix + r.id, content: content, trigger: trigger))
        }
    }

    func clear() {
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    // auch anzeigen, wenn die App gerade offen ist
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }
}
