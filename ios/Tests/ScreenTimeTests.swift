import XCTest

/// Schwellen und Textauswahl der Bildschirmzeit. Dieselben Fälle prüft shared/src/screentime.test.ts für die Server-Seite.
final class ScreenTimeTests: XCTestCase {
    func testThresholdsFor60Minutes() {
        XCTAssertEqual(ScreenTimeRules.thresholds(limitMinutes: 60).prefix(6), [30, 48, 60, 120, 180, 240])
        XCTAssertEqual(ScreenTimeRules.thresholds(limitMinutes: 60).last, 960)
    }

    func testThresholdsFor90AndNoDuplicates() {
        XCTAssertEqual(Array(ScreenTimeRules.thresholds(limitMinutes: 90).prefix(5)), [45, 72, 90, 120, 180])
        XCTAssertEqual(Array(ScreenTimeRules.thresholds(limitMinutes: 240).prefix(6)), [120, 192, 240, 300, 360, 420])
        let t = ScreenTimeRules.thresholds(limitMinutes: 120)
        XCTAssertEqual(t, Array(Set(t)).sorted(), "aufsteigend und ohne Doppelte")
    }

    func testSmallLimitsStaySensible() {
        XCTAssertEqual(Array(ScreenTimeRules.thresholds(limitMinutes: 5).prefix(4)), [3, 4, 5, 60])
    }

    func testKindsIncludingMiddayRule() {
        XCTAssertEqual(ScreenTimeRules.kind(minutes: 30, limitMinutes: 60, hourLocal: 11), .noon)
        XCTAssertEqual(ScreenTimeRules.kind(minutes: 30, limitMinutes: 60, hourLocal: 13), .half)
        XCTAssertEqual(ScreenTimeRules.kind(minutes: 48, limitMinutes: 60, hourLocal: 9), .eighty)
        XCTAssertEqual(ScreenTimeRules.kind(minutes: 60, limitMinutes: 60, hourLocal: 15), .limit)
        XCTAssertEqual(ScreenTimeRules.kind(minutes: 120, limitMinutes: 60, hourLocal: 15), .over)
        XCTAssertNil(ScreenTimeRules.kind(minutes: 35, limitMinutes: 60, hourLocal: 15))
        XCTAssertEqual(ScreenTimeRules.percent(minutes: 48, limitMinutes: 60), 80)
    }

    func testMessageKeysRotateStably() {
        XCTAssertEqual(ScreenTimeRules.messageKey(tone: "nett", kind: .half, seed: 5), "screentime.msg.nett.half")
        XCTAssertEqual(ScreenTimeRules.messageKey(tone: "frech", kind: .limit, seed: 0), "screentime.msg.frech.limit.1")
        XCTAssertEqual(ScreenTimeRules.messageKey(tone: "frech", kind: .limit, seed: 1), "screentime.msg.frech.limit.2")
        XCTAssertEqual(ScreenTimeRules.messageKey(tone: "frech", kind: .limit, seed: 2), "screentime.msg.frech.limit.1")
    }

    func testPreparedTextsCoverEveryThresholdAndKind() {
        let goal = ScreenGoal(id: "abc", name: "TikTok", limitMinutes: 60, shield: false)
        let texts = ScreenTimeShared.prepareTexts(goals: [goal], tone: "cool") { key, vars in "\(key)|\(vars["name"] ?? "")|\(vars["hours"] ?? "")" }
        XCTAssertNotNil(texts["abc:30:noon"])
        XCTAssertNotNil(texts["abc:30:half"])
        XCTAssertEqual(texts["abc:48:eighty"]?.count, 2)
        XCTAssertEqual(texts["abc:60:limit"]?.count, 2)
        XCTAssertEqual(texts["abc:180:over"]?.first, "screentime.msg.cool.over.1|TikTok|3")
        XCTAssertNil(texts["abc:31:half"])
    }

    func testSeedIsStable() {
        XCTAssertEqual(ScreenTimeShared.seed("goal-1"), ScreenTimeShared.seed("goal-1"))
        XCTAssertNotEqual(ScreenTimeShared.seed("goal-1"), ScreenTimeShared.seed("goal-2"))
    }
}
