// ERZEUGT von scripts/gen-weather-swift.ts aus shared/src/weather.scene.ts – nicht von Hand ändern.

enum WeatherPalette {
    /// Himmelsverlauf (oben, Horizont) als Hex ohne "#", je Wettertyp für Tag und Nacht
    static let sky: [String: (day: (String, String), night: (String, String))] = [
        "clear": (day: ("6DB3EE", "EAF5FF"), night: ("060C24", "1B2B55")),
        "partly": (day: ("7DB6E8", "E6F0F8"), night: ("0A1230", "222F55")),
        "cloudy": (day: ("A5B6C8", "DDE3EA"), night: ("121A2E", "2A3550")),
        "fog": (day: ("C2CBD3", "E8EBEE"), night: ("1B2233", "3A4458")),
        "drizzle": (day: ("94A6B9", "C9D3DC"), night: ("101828", "26324A")),
        "rain": (day: ("8A9DB1", "B7C4D0"), night: ("0E1626", "243146")),
        "heavy_rain": (day: ("3E4D60", "55657A"), night: ("0A101C", "1D283A")),
        "thunder": (day: ("2F3A4C", "4C5A6E"), night: ("080D18", "1A2232")),
        "snow": (day: ("B6C7DA", "E4EBF3"), night: ("1A2540", "3A4A6B")),
        "sleet": (day: ("A6B4C2", "D3DAE0"), night: ("141C30", "2E3A54")),
    ]

    /// Teilchen auf einem Handy (≈ 390×844)
    static let baseParticles: [String: Int] = [
        "clear": 0,
        "partly": 0,
        "cloudy": 0,
        "fog": 0,
        "drizzle": 60,
        "rain": 180,
        "heavy_rain": 350,
        "thunder": 350,
        "snow": 130,
        "sleet": 110,
    ]

    /// Aufhellen beim Blitz: höchstens so viel Weiß darüber
    static let maxFlash: Double = 0.2
    /// Mindestabstand zweier Blitze in Millisekunden
    static let minLightningGapMs: Double = 5000
    /// Helle Schrift auf dunklen Szenen (Nacht, Gewitter, Starkregen)
    static let darkHeadText = "F2F6FF"
}
