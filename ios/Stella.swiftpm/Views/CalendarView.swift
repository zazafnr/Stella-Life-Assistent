import SwiftUI

// Kalender: Monat → Tag. Die Daten kommen von GET /api/calendar (Blöcke je Tag, freie Zeiten), neue Termine über POST /api/calendar/items
// (laufen als Aktion mit Rückgängig). Wischen links/rechts wechselt den Monat. Ersetzt im normalen Stella den Stundenplan.

private struct CalBlock: Decodable, Identifiable, Hashable {
    var id: String
    var kind: String
    var title: String
    var date: String
    var start: String?
    var end: String?
    var status: String
    var location: String?
    var soft: Bool?
}
private struct CalDay: Decodable, Identifiable, Hashable {
    var date: String
    var blocks: [CalBlock]
    var freeMinutes: Int
    var load: Double
    var id: String { date }
}
private struct CalResponse: Decodable { var today: String; var days: [CalDay] }
private struct NewEvent: Encodable { var title: String; var due: String; var time: String?; var duration: Int?; var kind: String }

@MainActor
struct CalendarView: View {
    @Environment(\.dismiss) private var dismiss
    /** erster Tag des angezeigten Monats (JJJJ-MM-TT) */
    @State private var month: String = CalendarView.firstOfMonth(Day.today)
    @State private var selected: String = Day.today
    @State private var days: [String: CalDay] = [:]
    @State private var error: String?
    @State private var showNew = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)

    static func firstOfMonth(_ ymd: String) -> String {
        guard let d = Day.parse(ymd), let first = Day.calendar.date(from: Day.calendar.dateComponents([.year, .month], from: d)) else { return ymd }
        return Day.string(first)
    }

    /** Montag der Woche, in der der Monat beginnt – von dort 42 Tage (6 Wochen) */
    private var gridStart: String {
        guard let d = Day.parse(month) else { return month }
        let weekday = Day.calendar.component(.weekday, from: d) // 1 = Sonntag
        return Day.add(-((weekday + 5) % 7), to: month)
    }
    private var gridDays: [String] { (0..<42).map { Day.add($0, to: gridStart) } }

    private var monthTitle: String {
        guard let d = Day.parse(month) else { return month }
        return d.formatted(.dateTime.locale(Locale(identifier: I18n.shared.locale)).month(.wide).year())
    }

    private var weekdayHeads: [String] {
        var c = Day.calendar
        c.locale = Locale(identifier: I18n.shared.locale)
        let s = c.shortWeekdaySymbols
        return Array(s[1...6]) + [s[0]]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header
                    LazyVGrid(columns: columns, spacing: 4) {
                        ForEach(weekdayHeads, id: \.self) { w in
                            Text(w).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
                        }
                        ForEach(gridDays, id: \.self) { d in cell(d) }
                    }
                    .gesture(DragGesture(minimumDistance: 40).onEnded { v in
                        if abs(v.translation.width) > abs(v.translation.height) { shift(v.translation.width < 0 ? 1 : -1) }
                    })
                    dayList
                    if let error { Text(error).font(.system(size: 14)).foregroundStyle(Theme.pinkText) }
                }
                .padding(16)
            }
            .background(Theme.bg)
            .navigationTitle(L("calendar.calendarView"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("common.close")) { dismiss() } }
                ToolbarItem(placement: .primaryAction) { Button { showNew = true } label: { Image(systemName: "plus") }.accessibilityLabel(L("calendar.new")) }
            }
            .sheet(isPresented: $showNew) { NewEventSheet(day: selected) { await load() } }
            .task(id: month) { await load() }
        }
    }

    private var header: some View {
        HStack {
            Button { shift(-1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel(L("calendar.previous"))
            Spacer()
            Text(monthTitle).font(.system(size: 20, weight: .bold)).foregroundStyle(Theme.text)
            Spacer()
            Button { shift(1) } label: { Image(systemName: "chevron.right") }.accessibilityLabel(L("calendar.next"))
        }
        .padding(.horizontal, 4)
    }

    private func shift(_ delta: Int) {
        guard let d = Day.parse(month), let n = Day.calendar.date(byAdding: .month, value: delta, to: d) else { return }
        month = Day.string(n)
    }

    private func cell(_ d: String) -> some View {
        let inMonth = String(d.prefix(7)) == String(month.prefix(7))
        let isToday = d == Day.today
        let on = d == selected
        let count = days[d]?.blocks.filter { $0.soft != true }.count ?? 0
        let n = Int(d.suffix(2)) ?? 0
        return Button { selected = d } label: {
            VStack(spacing: 3) {
                Text("\(n)")
                    .font(.system(size: 15, weight: isToday ? .bold : .regular))
                    .foregroundStyle(on ? Color.white : (inMonth ? Theme.text : Theme.faint))
                    .frame(width: 30, height: 30)
                    .background(on ? Theme.blue : (isToday ? Theme.blueTint : Color.clear), in: Circle())
                HStack(spacing: 2) {
                    ForEach(0..<min(count, 3), id: \.self) { _ in Circle().fill(Theme.blue.opacity(0.6)).frame(width: 4, height: 4) }
                }
                .frame(height: 5)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Day.long(d))
    }

    private var dayList: some View {
        let day = days[selected]
        let blocks = day?.blocks ?? []
        return VStack(alignment: .leading, spacing: 8) {
            Text(Day.long(selected)).font(.system(size: 17, weight: .bold)).foregroundStyle(Theme.text)
            if let m = day?.freeMinutes, m > 0, selected >= Day.today {
                Text(L("calendar.free.minutes", ["minutes": "\(m / 60) h \(m % 60) min"])).font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
            if blocks.isEmpty {
                Text(L("calendar.nothing")).font(.system(size: 15)).foregroundStyle(Theme.muted)
            }
            ForEach(blocks) { b in
                HStack(alignment: .top, spacing: 12) {
                    Text(b.start.map { s in b.end.map { "\(s)–\($0)" } ?? s } ?? L("calendar.untimed"))
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 96, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(b.title).font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(b.status == "cancelled" ? Theme.faint : Theme.text)
                            .strikethrough(b.status == "cancelled" || b.status == "done")
                        Text(L("calendar.kind.\(b.kind)") + (b.location.map { " · \($0)" } ?? ""))
                            .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 0)
                }
                .padding(12)
                .background(b.soft == true ? Theme.surface.opacity(0.6) : Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.border.opacity(0.7), lineWidth: 1))
            }
        }
    }

    private func load() async {
        let from = gridStart
        let to = Day.add(41, to: from)
        do {
            let r: CalResponse = try await API.shared.get("/api/calendar?from=\(from)&to=\(to)")
            var map: [String: CalDay] = [:]
            for d in r.days { map[d.date] = d }
            days = map
            error = nil
        } catch {
            if days.isEmpty { self.error = L("calendar.offline") }
        }
    }
}

/// Neuer Termin: Titel, Tag, Uhrzeit (optional), Dauer
@MainActor
private struct NewEventSheet: View {
    @Environment(\.dismiss) private var dismiss
    var day: String
    var done: () async -> Void
    init(day: String, done: @escaping () async -> Void) { self.day = day; self.done = done }

    @State private var title = ""
    @State private var date = Date()
    @State private var withTime = true
    @State private var minutes = 60
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { TextField(L("calendar.field.title"), text: $title) }
                Section {
                    DatePicker(L("calendar.field.date"), selection: $date, displayedComponents: .date)
                    Toggle(L("calendar.field.start"), isOn: $withTime)
                    if withTime {
                        DatePicker(L("calendar.field.start"), selection: $date, displayedComponents: .hourAndMinute)
                        Stepper(L("calendar.duration", ["count": minutes]), value: $minutes, in: 15...480, step: 15)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.pinkText) } }
            }
            .navigationTitle(L("calendar.sheet.new"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("calendar.save")) { Task { await save() } }.disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { if let d = Day.parse(day) { date = Day.calendar.date(bySettingHour: 9, minute: 0, second: 0, of: d) ?? d } }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        let body = NewEvent(title: title.trimmingCharacters(in: .whitespaces), due: Day.string(date), time: withTime ? f.string(from: date) : nil,
                            duration: withTime ? minutes : nil, kind: "event")
        do {
            let _: OK = try await API.shared.send("POST", "/api/calendar/items", body: body)
            await done()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
