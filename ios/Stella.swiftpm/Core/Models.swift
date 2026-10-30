import Foundation

// Datenformen wie in shared/src/types.ts (API-Verträge mit dem Server).

struct Attachment: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    var caption: String?
}

struct Item: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    var subject: String?
    var title: String
    var detail: String?
    var notes: String?
    var page: String?
    var exercises: String?
    var due: String?
    var time: String?
    var status: String
    var material: String?
    var parentId: String?
    var attachments: [Attachment]
    var updatedAt: String
    var deleted: Bool

    var isOpen: Bool { status == "open" }
    var isDone: Bool { status == "done" }
    /** Stella hat die HÜ gelöst und ins Heft geschrieben */
    var solvedInNotebook: Bool { attachments.contains { $0.caption?.hasPrefix("Lösung") == true } }
    var dueDate: Date? { due.flatMap(Day.parse) }
}

struct ChatMessage: Codable, Hashable, Identifiable {
    var id: String
    var clientId: String?
    var role: String
    var text: String
    var attachments: [Attachment]
    var createdAt: String
    var pending: Bool?
    /** Karte mit Ja/Nein oder „Rückgängig“ */
    var actionId: String?

    var isUser: Bool { role == "user" }
}

/** Etwas, das Stella getan hat oder vorschlägt */
struct ActionEntry: Codable, Hashable, Identifiable {
    var id: String
    var type: String
    var group: String
    var summary: String
    /** proposed, done, rejected, undone, failed */
    var status: String
    var source: String
    var canUndo: Bool
    var createdAt: String
    var updatedAt: String

    var proposed: Bool { status == "proposed" }
}

struct ActionDecision: Codable {
    var action: ActionEntry
    var items: [Item]
}

/** Was Stella über den Nutzer weiß */
struct Memory: Codable, Hashable, Identifiable {
    struct Schedule: Codable, Hashable {
        var days: [Int]
        var start: String
        var end: String
    }
    var id: String
    var category: String
    var text: String
    var source: String
    var schedule: Schedule?
    var createdAt: String
    var updatedAt: String
}

struct MemoryList: Codable {
    var categories: [String: String]
    var memories: [Memory]
}

/** Ein Bereich in „Was Stella selbst darf“ */
struct PermissionRow: Codable, Hashable, Identifiable {
    var group: String
    var label: String
    var help: String
    var levels: [String]
    var level: String
    var id: String { group }
}

struct ChatResponse: Codable {
    var messages: [ChatMessage]
    var items: [Item]
    var userMessage: ChatMessage?
}

struct SyncResponse: Codable {
    var items: [Item]
    var messages: [ChatMessage]
    var serverTime: String
    var busyItems: [String]?
    var actions: [ActionEntry]?
}

struct BookConfig: Codable, Hashable {
    var subject: String
    var provider: String
    var url: String
    var pageOffset: Int?
    var pageUrlTemplate: String?
}

struct UserSettings: Codable, Hashable {
    var eveningTime: String?
    var studyTime: String?
    var stepGoal: Int?
    var homeworkAutopilot: Bool?
    var mailAutoTrash: Bool?
    var books: [BookConfig]?
    /** "nett", "frech" oder "cool" */
    var tone: String?
    /** Morning Briefing: "auto", "off" oder "HH:MM" */
    var briefing: String?
    /** Sonntagabend Wochenplan anbieten: "sunday" oder "off" */
    var weekPlan: String?
}

/** Ein Block im Wochenplan-Vorschlag */
struct PlanBlock: Codable, Hashable, Identifiable {
    var key: String
    var date: String
    var start: String
    var end: String
    var title: String
    var focus: String?
    var subject: String?
    var parentId: String
    /** "exam", "homework" oder "assignment" */
    var why: String
    var id: String { key }
}

struct WeekPlan: Codable {
    var from: String
    var to: String
    var blocks: [PlanBlock]
    var notes: [String]
}

/** Etwas, das Stella bemerkt hat („Was hast du vergessen?“) */
struct Hint: Codable, Hashable, Identifiable {
    var key: String
    var priority: String
    var text: String
    var actionLabel: String?
    var actionId: String?
    var itemId: String?
    /** Knopf, der in den Chat oder die Inbox führt (z. B. „Stoff sagen“, „Antwort schreiben“) */
    var open: HintOpen?
    var id: String { key }
    var high: Bool { priority == "high" }
}

struct HintOpen: Codable, Hashable {
    var tab: String
    var label: String
}

struct BriefingSection: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var lines: [String]
}

struct Briefing: Codable {
    var date: String
    var greeting: String
    var sections: [BriefingSection]
    var hints: [Hint]
    var closing: String
    var text: String
    var time: String?
    var sent: Bool
}

enum Tone: String, CaseIterable, Identifiable {
    case nett, frech, cool
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var emoji: String {
        switch self {
        case .nett: return "🌸"
        case .frech: return "😏"
        case .cool: return "😎"
        }
    }
    var example: String {
        switch self {
        case .nett: return "Notiert! Ich erinnere dich morgen um 19:00. 💫"
        case .frech: return "Schon wieder Latein? Na gut, notiert – ich nerv dich morgen um 19:00."
        case .cool: return "Läuft. Steht drin, Reminder morgen 19:00."
        }
    }
}

struct MailAccount: Codable, Hashable, Identifiable {
    var id: String
    var label: String
    var provider: String
    var user: String
    var auth: String?
    var lastError: String?
    var checkedAt: String?
}

struct ShelfBook: Codable, Hashable, Identifiable {
    var title: String
    var url: String
    var id: String { url }
}

struct LoginPage: Codable, Hashable {
    var url: String
    var domains: String
}

struct BookIntegration: Codable, Hashable {
    var connected: Bool
    var cookies: Bool?
    var email: String?
}

struct Integrations: Codable, Hashable {
    var books: [String: BookIntegration]
    var webuntis: Bool
    var mailAccounts: Int
    var handwritingFont: Bool
    var freeNotes: Bool?
    var googleSignIn: Bool?
}

struct Me: Codable, Hashable {
    var id: String
    var name: String
    var email: String
    var timeZone: String
    var settings: UserSettings
    var ingestUrl: String
    var integrations: Integrations

    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
}

struct AuthResponse: Codable {
    var token: String
    var user: Me
}

struct ServerStatus: Codable {
    var ok: Bool
    var hasUsers: Bool
    var registrationOpen: Bool
}

struct Lesson: Codable, Hashable, Identifiable {
    var date: String
    var start: String
    var end: String
    var subject: String?
    var code: String?
    var status: String
    var info: String?

    var id: String { "\(date)-\(start)-\(code ?? subject ?? "")" }
    var cancelled: Bool { status == "cancelled" }
    var name: String { subject ?? code ?? "Stunde" }
}

struct InboxEntry: Codable, Hashable, Identifiable {
    var id: String
    var source: String
    var sender: String?
    var text: String?
    var createdAt: String
    var summary: String?
    var category: String?
    var action: String?
    var account: String?
    var platform: String?
    var reason: String?
    var deadline: MailDeadline?
    var needsReply: Bool?
    var handled: Bool?
    var replied: String?
    var draft: MailDraft?
    var deadlineActionId: String?

    var trashed: Bool { action == "trash" }
    var important: Bool { category == "important" }
    var date: Date? { ISO.parse(createdAt) }
    /** „Wichtig für dich“: wichtige Mail der letzten 7 Tage, noch nicht erledigt */
    var focus: Bool {
        guard source == "email", handled != true, !trashed, important || needsReply == true || deadline != nil,
              let d = date else { return false }
        return d > Date().addingTimeInterval(-7 * 86_400)
    }
}

struct MailDeadline: Codable, Hashable {
    var date: String
    var time: String?
    var what: String
}

struct MailDraft: Codable, Hashable {
    var subject: String?
    var body: String
}

struct UpcomingReminder: Codable, Hashable, Identifiable {
    var id: String
    var itemId: String?
    var fireAt: String
    var message: String
}

struct HealthDay: Codable, Hashable {
    var date: String
    var steps: Int?
    var sleepHours: Double?
    var activeMinutes: Int?
}

struct AIStatus: Codable {
    var configured: Bool
    var usedToday: Int
    var dailyLimit: Int
}

struct OK: Codable { var ok: Bool? }

// MARK: - Datum

enum ISO {
    private static let frac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ s: String) -> Date? { frac.date(from: s) ?? plain.date(from: s) }
    static func string(_ d: Date) -> String { frac.string(from: d) }
}

/** Kalendertage als "YYYY-MM-DD" in der Zeitzone des Geräts */
enum Day {
    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.locale = Locale(identifier: "de_AT")
        c.firstWeekday = 2
        return c
    }

    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func parse(_ s: String) -> Date? { fmt.date(from: s) }
    static func string(_ d: Date) -> String { fmt.string(from: d) }
    static var today: String { string(Date()) }
    static func add(_ days: Int, to s: String) -> String {
        guard let d = parse(s), let n = calendar.date(byAdding: .day, value: days, to: d) else { return s }
        return string(n)
    }
    static func diff(from a: String, to b: String) -> Int {
        guard let x = parse(a), let y = parse(b) else { return 0 }
        return calendar.dateComponents([.day], from: x, to: y).day ?? 0
    }

    /** "Freitag, 30.10." */
    static func long(_ s: String) -> String {
        guard let d = parse(s) else { return s }
        return d.formatted(.dateTime.locale(Locale(identifier: "de_AT")).weekday(.wide).day().month(.twoDigits))
    }

    /** "morgen", "heute", "Fr, 30.10." */
    static func relative(_ s: String) -> String {
        let n = diff(from: today, to: s)
        switch n {
        case 0: return "heute"
        case 1: return "morgen"
        case 2: return "übermorgen"
        case -1: return "gestern"
        default:
            guard let d = parse(s) else { return s }
            return d.formatted(.dateTime.locale(Locale(identifier: "de_AT")).weekday(.abbreviated).day().month(.twoDigits))
        }
    }
}
