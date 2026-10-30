import CoreMotion
import Foundation

/// Liest die Schritte direkt vom iPhone (Bewegungssensor) und schickt sie an Stella –
/// ersetzt den Apple-Kurzbefehl. Auf dem iPad gibt es keinen Schrittzähler.
@MainActor
final class Steps {
    static let shared = Steps()
    private let pedometer = CMPedometer()

    var available: Bool { CMPedometer.isStepCountingAvailable() }
    var authorized: Bool { CMPedometer.authorizationStatus() == .authorized }
    var denied: Bool {
        let s = CMPedometer.authorizationStatus()
        return s == .denied || s == .restricted
    }

    func steps(on day: Date) async -> Int? {
        guard available else { return nil }
        let cal = Calendar.current
        let start = cal.startOfDay(for: day)
        let end = min(cal.date(byAdding: .day, value: 1, to: start) ?? Date(), Date())
        return await withCheckedContinuation { cont in
            pedometer.queryPedometerData(from: start, to: end) { data, _ in
                cont.resume(returning: data?.numberOfSteps.intValue)
            }
        }
    }

    /** heute und die letzten 6 Tage an den Server schicken (der Sensor speichert 7 Tage) */
    func upload(ingestUrl: String) async -> Int? {
        guard available, let base = URL(string: ingestUrl) else { return nil }
        var todaySteps: Int?
        for back in 0..<7 {
            guard let day = Calendar.current.date(byAdding: .day, value: -back, to: Date()),
                  let steps = await steps(on: day) else { continue }
            if back == 0 { todaySteps = steps }
            var req = URLRequest(url: base.appendingPathComponent("health"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["date": Day.string(day), "steps": steps])
            _ = try? await URLSession.shared.data(for: req)
        }
        return todaySteps
    }
}
