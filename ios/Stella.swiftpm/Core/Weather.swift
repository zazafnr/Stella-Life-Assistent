import Foundation
import CoreLocation
import Observation

/// Wetter beim Start: zuerst das zuletzt gespeicherte (UserDefaults "lastWeather"), parallel ein frisches – nie blockierend.
/// Der Ablauf und die Abbildung der WMO-Codes sind dieselben wie in shared/src/weather.ts (dort getestet).
struct WeatherState: Codable, Equatable {
    /// clear, partly, cloudy, fog, drizzle, rain, heavy_rain, thunder, snow, sleet
    var type: String
    var day: Bool
    var temp: Int
    /// Wind in Stufen 0–3
    var wind: Int
    /// Zeitpunkt der Messung (Sekunden seit 1970)
    var at: Double

    /// Älter als 3 Stunden: nur noch Startbild
    var isStale: Bool { Date().timeIntervalSince1970 - at > 3 * 3600 }

    static let types = ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "heavy_rain", "thunder", "snow", "sleet"]

    static func type(forWMO code: Int) -> String {
        switch code {
        case 0, 1: return "clear"
        case 2: return "partly"
        case 3: return "cloudy"
        case 45, 48: return "fog"
        case 51...55: return "drizzle"
        case 56, 57, 66, 67: return "sleet"
        case 61, 63, 80, 81: return "rain"
        case 65, 82: return "heavy_rain"
        case 71...77, 85, 86: return "snow"
        case 95...99: return "thunder"
        default: return "cloudy"
        }
    }

    static func windLevel(_ kmh: Double) -> Int { kmh < 15 ? 0 : kmh < 30 ? 1 : kmh < 50 ? 2 : 3 }

    /// Antwort von Open-Meteo `current=…`; nil, wenn sie nicht passt
    static func parse(_ json: Any) -> WeatherState? {
        guard let root = json as? [String: Any], let c = root["current"] as? [String: Any],
              let code = (c["weather_code"] as? NSNumber)?.intValue, let temp = (c["temperature_2m"] as? NSNumber)?.doubleValue else { return nil }
        let isDay = (c["is_day"] as? NSNumber)?.intValue ?? 1
        let wind = (c["wind_speed_10m"] as? NSNumber)?.doubleValue ?? 0
        return WeatherState(type: type(forWMO: code), day: isDay != 0, temp: Int(temp.rounded()), wind: windLevel(wind), at: Date().timeIntervalSince1970)
    }
}

/// Antwort von GET /api/weather/approx
private struct ApproxWeather: Decodable { var weather: WeatherState? }

/// Schneller, ungenauer Standort (Kilometer-Genauigkeit). Fragt nie nach: ohne Freigabe kommt sofort nil.
@MainActor
final class QuickLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func request(timeout: Duration = .milliseconds(1500)) async -> CLLocationCoordinate2D? {
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else { return nil }
        if let last = manager.location, Date().timeIntervalSince(last.timestamp) < 30 * 60 { return last.coordinate }
        Task { [weak self] in
            try? await Task.sleep(for: timeout)
            self?.finish(nil)
        }
        return await withCheckedContinuation { cont in
            continuation = cont
            manager.requestLocation()
        }
    }

    private func finish(_ c: CLLocationCoordinate2D?) {
        continuation?.resume(returning: c)
        continuation = nil
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let c = locations.last?.coordinate
        Task { @MainActor in self.finish(c) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil) }
    }
}

@MainActor
@Observable
final class WeatherService {
    static let shared = WeatherService()

    private static let cacheKey = "lastWeather"
    private static let forceKey = "forceWeather"

    private var real: WeatherState?
    @ObservationIgnored private var started = false
    @ObservationIgnored private let locator = QuickLocation()

    /// Owner-Testschalter: "type" oder "type:night" (Einstellungen → Server → Wetter erzwingen); nil = echtes Wetter
    var forced: String? {
        didSet {
            if let forced { UserDefaults.standard.set(forced, forKey: Self.forceKey) } else { UserDefaults.standard.removeObject(forKey: Self.forceKey) }
        }
    }

    /// Das Wetter, das die Oberfläche zeigt
    var current: WeatherState? {
        if let forced {
            let parts = forced.split(separator: ":").map(String.init)
            guard let type = parts.first, WeatherState.types.contains(type) else { return real }
            return WeatherState(type: type, day: parts.count < 2 || parts[1] != "night", temp: real?.temp ?? 15, wind: real?.wind ?? 1, at: Date().timeIntervalSince1970)
        }
        return real
    }

    private init() {
        forced = UserDefaults.standard.string(forKey: Self.forceKey)
        if let data = UserDefaults.standard.data(forKey: Self.cacheKey), let w = try? JSONDecoder().decode(WeatherState.self, from: data) { real = w }
    }

    /// Einmal pro App-Start; kehrt sofort zurück, der Abruf läuft im Hintergrund
    func start(permission: String?) {
        guard !started else { return }
        started = true
        Task { await refresh(granted: permission == "granted") }
    }

    private func show(_ w: WeatherState) {
        if let data = try? JSONEncoder().encode(w) { UserDefaults.standard.set(data, forKey: Self.cacheKey) }
        real = w
    }

    private func refresh(granted: Bool) async {
        if granted, let c = await locator.request() {
            let lat = (c.latitude * 100).rounded() / 100, lon = (c.longitude * 100).rounded() / 100
            if let w = await Self.fetchOpenMeteo(lat: lat, lon: lon) {
                show(w)
                // nur den gerundeten Ort an den Server melden (Briefing und News)
                _ = try? await API.shared.send("POST", "/api/weather/place", body: ["lat": lat, "lon": lon], as: OK.self)
                return
            }
        }
        if let r = try? await API.shared.get("/api/weather/approx", as: ApproxWeather.self), let w = r.weather { show(w) }
    }

    /// Open-Meteo direkt vom Gerät, Zeitlimit 2 s
    private static func fetchOpenMeteo(lat: Double, lon: Double) async -> WeatherState? {
        var comps = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        comps.queryItems = [
            URLQueryItem(name: "latitude", value: String(lat)), URLQueryItem(name: "longitude", value: String(lon)),
            URLQueryItem(name: "current", value: "weather_code,temperature_2m,is_day,precipitation,wind_speed_10m,cloud_cover"),
            URLQueryItem(name: "daily", value: "sunrise,sunset"), URLQueryItem(name: "timezone", value: "auto"), URLQueryItem(name: "forecast_days", value: "1"),
        ]
        var req = URLRequest(url: comps.url!)
        req.timeoutInterval = 2
        guard let (data, resp) = try? await URLSession.shared.data(for: req), (resp as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return WeatherState.parse(json)
    }
}
