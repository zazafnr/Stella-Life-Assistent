import Foundation

// Datenformen wie in shared/src/types.ts (API-Verträge mit dem Server).

struct Attachment: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    var caption: String?
    /** Sprachnachricht: Länge in Sekunden, Rohtext von Whisper und aufgeräumter Text */
    var duration: Int?
    var transcriptRaw: String?
    var transcript: String?
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
    /** kam über diesen Kanal herein bzw. ging dorthin: "telegram" (kleines Symbol) */
    var via: String?

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
    /** "places", "spending" oder "news_ask" (Frage am ersten Tag) */
    var type: String
    /** Läden-Karte */
    var category: String?
    var label: String
    var itemId: String?
    /** Ausgaben-Karte */
    var currency: String?
    var totalCents: Int?
    var count: Int?
    var categories: [SpendingLine]?
    /** Restaurant-Karte */
    var when: String?
    var people: Int?
    var restaurants: [RestaurantItem]?
    /** Verfügbarkeits-Karte */
    var product: String?
    var checkedAt: String?
    var availability: [AvailabilityEntry]?

    enum CodingKeys: String, CodingKey { case type, category, label, itemId, currency, totalCents, count, categories, when, people, items, product, checkedAt }

    // Karten ohne Beschriftung (news_ask) sollen nicht am Decodieren scheitern
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        category = try c.decodeIfPresent(String.self, forKey: .category)
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        itemId = try c.decodeIfPresent(String.self, forKey: .itemId)
        currency = try c.decodeIfPresent(String.self, forKey: .currency)
        totalCents = try c.decodeIfPresent(Int.self, forKey: .totalCents)
        count = try c.decodeIfPresent(Int.self, forKey: .count)
        categories = try c.decodeIfPresent([SpendingLine].self, forKey: .categories)
        when = try c.decodeIfPresent(String.self, forKey: .when)
        people = try c.decodeIfPresent(Int.self, forKey: .people)
        product = try c.decodeIfPresent(String.self, forKey: .product)
        checkedAt = try c.decodeIfPresent(String.self, forKey: .checkedAt)
        // „items“ heißt in beiden Karten gleich, hat aber je Art einen anderen Inhalt
        if type == "restaurants" { restaurants = try c.decodeIfPresent([RestaurantItem].self, forKey: .items) }
        if type == "availability" { availability = try c.decodeIfPresent([AvailabilityEntry].self, forKey: .items) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encodeIfPresent(category, forKey: .category)
        try c.encode(label, forKey: .label)
        try c.encodeIfPresent(itemId, forKey: .itemId)
        try c.encodeIfPresent(currency, forKey: .currency)
        try c.encodeIfPresent(totalCents, forKey: .totalCents)
        try c.encodeIfPresent(count, forKey: .count)
        try c.encodeIfPresent(categories, forKey: .categories)
        try c.encodeIfPresent(when, forKey: .when)
        try c.encodeIfPresent(people, forKey: .people)
        try c.encodeIfPresent(product, forKey: .product)
        try c.encodeIfPresent(checkedAt, forKey: .checkedAt)
        if let restaurants { try c.encode(restaurants, forKey: .items) }
        if let availability { try c.encode(availability, forKey: .items) }
    }
}

/** Ein Vorschlag auf der Restaurant-Karte */
struct RestaurantItem: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var kind: String
    var cuisine: [String]
    var distanceM: Int
    var openNow: Bool?
    var openingHours: String?
    var address: String?
    var phone: String?
    var website: String?
    var appleMapsUrl: String
    var bookingUrl: String?
    var bookingService: String?
}

/** Ein Händler auf der Verfügbarkeits-Karte */
struct AvailabilityEntry: Codable, Hashable, Identifiable {
    var retailer: String
    var store: String?
    var status: String
    var source: String
    var url: String?
    var phone: String?
    var note: String?
    var id: String { retailer + (store ?? "") }
}

struct SpendingLine: Codable, Hashable {
    var category: String
    var cents: Int
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

/** Eine Kartenzahlung (nur Betrag, Händler und Kartenname – nie die Nummer). Heißt nicht „Transaction“, weil SwiftUI das schon hat. */
struct Payment: Codable, Hashable, Identifiable {
    var id: String
    var amountCents: Int
    var currency: String
    var merchant: String
    var category: String
    var cardLabel: String?
    var occurredAt: String
    var day: String
    var source: String
}

struct BudgetLine: Codable, Hashable {
    var category: String
    var limitCents: Int
    var spentCents: Int
}

struct SubscriptionLine: Codable, Hashable, Identifiable {
    var merchant: String
    var amountCents: Int
    var currency: String
    var lastDay: String
    var nextDay: String
    var count: Int
    var id: String { "\(merchant)-\(amountCents)" }
}

struct CategorySum: Codable, Hashable, Identifiable {
    var category: String
    var cents: Int
    var count: Int
    var id: String { category }
}

struct FinanceMonth: Codable, Hashable {
    var month: String
    var currency: String
    var totalCents: Int
    var previousTotalCents: Int
    var count: Int
    var otherCurrency: Int
    var categories: [CategorySum]
    var budgets: [BudgetLine]
    var transactions: [Payment]
    var subscriptions: [SubscriptionLine]
}

struct PaymentResponse: Codable { var transaction: Payment }
struct TestPaymentResponse: Codable { var duplicate: Bool; var message: String }

/** Ein Punkt in „Was Stella vorhat“ – die Steuerung kommt vom Server (toggle, time, remove, decision, link) */
struct PlanControl: Codable, Hashable {
    var type: String
    var on: Bool?
    var label: String?
    var value: String?
    var target: String?
}

struct PlanEntry: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    /** week | regular | longterm */
    var group: String
    var title: String
    var when: String
    var at: String?
    var recurrence: String?
    var enabled: Bool
    var controls: [PlanControl]
}

struct PlanResponse: Codable { var entries: [PlanEntry]; var soon: [PlanEntry] }
struct PlanChangeResponse: Codable { var actionId: String; var entries: [PlanEntry]; var soon: [PlanEntry] }

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
    /** Sprache der Oberfläche (en, de, es, fr, it, pt-BR, tr, pl) und Land (ISO-3166) */
    var locale: String?
    var country: String?
    /** Standort aus der Einführung: "granted", "denied" oder "later" */
    var locationPermission: String?
    /** Wer benachrichtigt werden will, wenn FreeNotes startet */
    var notify: NotifySettings?
    /** Wohin Stella von sich aus schreibt: "push" und/oder "telegram" */
    var notifyVia: [String]?
    /** News im Briefing */
    var news: NewsPrefs?
}

struct NewsPrefs: Codable, Hashable {
    var enabled: Bool?
    var asked: Bool?
}

struct NotifySettings: Codable, Hashable {
    var freenotes: Bool?
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

/** Eine Meldung im Briefing: ein neutraler Satz, die Quelle und der Link zum Artikel */
struct NewsEntry: Codable, Hashable, Identifiable {
    var sentence: String
    var source: String
    var url: String
    var publishedAt: String
    var favorite: Bool?
    var id: String { url }
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
    var news: [NewsEntry]?
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

struct ServerFlags: Codable, Hashable {
    var finance: Bool?
    /** Download-Link von FreeNotes, sobald es die App gibt */
    var freenotesUrl: String?
    /** Telegram-Bot ist auf dem Server eingerichtet */
    var telegram: Bool?
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
    /** serverweite Funktions-Schalter (z. B. Finanzen ausgeblendet) */
    var flags: ServerFlags?

    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }

    /** Sieht dieses Profil die Funktion? Ohne Profil (ältere Konten) wie bisher – nur Finanzen braucht eine Einrichtung. */
    func has(_ feature: String) -> Bool {
        // Finanzen ist serverseitig ausgeblendet, solange der Schalter aus ist (der Server entfernt sie auch aus dem Profil)
        if feature == "finance" && flags?.finance != true { return false }
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
    var claude: ClaudeStatus?
    var cost: AICost?
}

struct ClaudeStatus: Codable {
    var configured: Bool
    var light: String
    var heavy: String
    var allowFreeFallback: Bool?
}

struct AICostSummary: Codable {
    var totalMicroUsd: Double
    var requests: Int
}

struct AICost: Codable {
    var today: AICostSummary
    var month: AICostSummary
    var eurPerUsd: Double
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
