import Foundation

// Datenformen wie in shared/src/types.ts (API-Verträge mit dem Server).

struct Attachment: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    var caption: String?
}

struct PlaceRef: Codable, Hashable {
    var category: String
    var label: String
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
    /** Erledigung mit Ort: beim Erinnern zeigt Stella Läden in der Nähe */
    var place: PlaceRef?

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
    /** nur im Gerät: Sprachnachricht, die Stella nicht abschreiben konnte – „Nochmal versuchen“ nutzt diese Id */
    var failedAudioId: String?
    /** Karte unter der Nachricht, z. B. „Läden in der Nähe“ */
    var card: MessageCard?

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

/** Ein Chat: jeder Tag startet einen neuen, mehrere am Tag bekommen einen Titel */
struct Conversation: Codable, Hashable, Identifiable {
    var id: String
    var title: String?
    /** Titel, sonst „Heute“, „Gestern“ oder „Mi, 4.11.“ */
    var label: String
    var day: String
    var lastMessage: String?
    var updatedAt: String
    var count: Int
}

/** Antwort auf eine Sprachnachricht: wie ChatResponse, dazu das Transkript und die Id der Aufnahme */
struct AudioResponse: Codable {
    var messages: [ChatMessage]
    var items: [Item]
    var userMessage: ChatMessage?
    var conversationId: String?
    var transcript: String
    var audioId: String
}

/** Schnellaktion im Chat: Chip bzw. große Karte im leeren Chat */
struct QuickAction: Codable, Hashable, Identifiable {
    var id: String
    var symbol: String
    var label: String
    /** text = in die Eingabe einfügen, send = sofort schicken, camera = Kamera öffnen, mic = Aufnahme */
    var kind: String
    var text: String?
}

struct QuickActions: Codable {
    var actions: [QuickAction]
    var cards: [QuickAction]
}

/** Karte unter einer Stella-Nachricht (derzeit: Läden in der Nähe) */
struct MessageCard: Codable, Hashable {
    var type: String
    var category: String
    var label: String
    var itemId: String?
}

struct ListEntry: Codable, Hashable, Identifiable {
    var id: String
    var text: String
    var qty: String?
    var done: Bool
    var addedVia: String
    var createdAt: String
}

struct StellaList: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var kind: String
    var items: [ListEntry]
}

/** Ein Ziel mit Stand diese Woche (Montag bis Sonntag) und Verlauf der letzten 8 Wochen */
struct GoalProgress: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var why: String?
    var metric: String
    var unit: String
    /** pro Tag (cadence daily) bzw. pro Woche */
    var target: Double
    /** daily | weekly:n | custom */
    var cadence: String
    var minutes: Int?
    var checkIn: String?
    /** active | paused | done */
    var status: String
    var createdAt: String
    var weekValue: Double
    var weekTarget: Double
    /** älteste Woche zuerst, die letzte ist die aktuelle */
    var history: [Double]
    var recent: [GoalLogEntry]

    var isActive: Bool { status == "active" }

    static func number(_ v: Double) -> String {
        let r = (v * 10).rounded() / 10
        let text = r == r.rounded() ? String(Int(r)) : String(r)
        return text.replacingOccurrences(of: ".", with: ",")
    }

    /** „3×“ bei Einheiten, sonst „12 km“ */
    func amount(_ v: Double) -> String {
        unit == "x" ? "\(Self.number(v))×" : "\(Self.number(v)) \(unit)"
    }

    var rhythm: String {
        if cadence == "daily" { return "täglich" }
        if cadence.hasPrefix("weekly:"), let n = Int(cadence.dropFirst(7)) { return "\(n)× pro Woche" }
        return "\(Self.number(target)) \(unit) pro Woche"
    }
}

struct GoalLogEntry: Codable, Hashable, Identifiable {
    var id: String
    var date: String
    var value: Double
    var note: String?
}

struct GoalsResponse: Codable { var goals: [GoalProgress] }
struct GoalResponse: Codable { var goal: GoalProgress }

struct ListsResponse: Codable { var lists: [StellaList] }
struct ListResponse: Codable { var list: StellaList }

struct NearbyPlace: Codable, Hashable, Identifiable {
    var name: String
    var distanceM: Int
    var openingHours: String?
    /** nil = unbekannt */
    var openNow: Bool?
    var address: String?
    var lat: Double
    var lon: Double
    var appleMapsUrl: String
    var osmUrl: String
    var id: String { "\(lat),\(lon)" }
}

struct NearbyPlaces: Codable {
    var category: String
    var label: String
    var plural: String
    var emoji: String
    var places: [NearbyPlace]
}

struct NewConversation: Codable {
    var id: String
    var conversations: [Conversation]
}

struct ChatResponse: Codable {
    var messages: [ChatMessage]
    var items: [Item]
    var userMessage: ChatMessage?
    var conversationId: String?
}

struct SyncResponse: Codable {
    var items: [Item]
    var messages: [ChatMessage]
    var serverTime: String
    var busyItems: [String]?
    var actions: [ActionEntry]?
    var conversationId: String?
    var current: String?
    var conversations: [Conversation]?
}

struct BookConfig: Codable, Hashable {
    var subject: String
    var provider: String
    var url: String
    var pageOffset: Int?
    var pageUrlTemplate: String?
}

struct WorkHours: Codable, Hashable {
    var days: [Int]
    var start: String
    var end: String
    var commute: Bool?
}

struct SchoolInfo: Codable, Hashable { var level: String }
struct UniversityInfo: Codable, Hashable { var name: String }

/** Wer Stella benutzt und wobei sie helfen soll (Einführung) – steuert, was die App zeigt */
struct UserProfile: Codable, Hashable {
    /** school, university, work, apprenticeship, other */
    var situation: String
    var ageGroup: String?
    var workHours: WorkHours?
    var school: SchoolInfo?
    var university: UniversityInfo?
    /** mails, planner, homework, shopping, goals, finance, health */
    var features: [String]
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
    var profile: UserProfile?
    /** "pending": die Einführung kommt beim nächsten Öffnen; "done": erledigt oder übersprungen */
    var onboarding: String?
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
    /** der erste Nutzer ist "owner" und sieht „Server“ in den Einstellungen */
    var role: String?

    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }

    /** Sieht dieses Profil die Funktion? Ohne Profil (ältere Konten) wie bisher – nur Finanzen braucht eine Einrichtung. */
    func has(_ feature: String) -> Bool {
        guard let p = settings.profile else { return feature != "finance" }
        if feature == "homework" && p.situation != "school" { return false }
        return p.features.contains(feature)
    }
    /** Schulbücher, HÜ-Autopilot, WebUntis – ohne Profil wie bisher */
    var isSchool: Bool { settings.profile.map { $0.situation == "school" } ?? true }
    /** Tests, Lerneinheiten, Lernpläne: Schule oder Studium */
    var isLearner: Bool { settings.profile.map { $0.situation == "school" || $0.situation == "university" } ?? true }
}

struct AuthResponse: Codable {
    var token: String
    var user: Me
}

struct ServerStatus: Codable {
    var ok: Bool
    var hasUsers: Bool
    var registrationOpen: Bool
    /** closed, invite oder open */
    var registration: String?
}

/** Antwort auf Registrieren: Sitzung (erstes Konto) oder „erst Code bestätigen“ */
struct SignupResponse: Decodable {
    var token: String?
    var user: Me?
    var needsVerification: Bool?
    var email: String?
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

enum InboxTab: String, CaseIterable {
    case important = "Wichtig", normal = "Neutral", newsletter = "Unwichtig", trash = "Papierkorb"
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
    /** Wichtig / Neutral / Unwichtig / Papierkorb – Social-Benachrichtigungen zählen zu „Unwichtig“, SMS zu „Wichtig“ */
    var tab: InboxTab {
        if source == "sms" { return .important }
        if source == "social" { return .newsletter }
        if trashed || category == "spam" { return .trash }
        switch category {
        case "important": return .important
        case "newsletter": return .newsletter
        default: return .normal
        }
    }
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
