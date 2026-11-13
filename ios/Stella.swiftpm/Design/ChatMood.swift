import SwiftUI

// Sprechblasen im Wetter-Look (Design-Auswahl „Blasen B“): Die Nachrichten liegen direkt auf dem Himmel,
// jede Wetterlage hat eigene Blasen – Sonne warm und golden, Regen mit Tropfen, Schnee frostig, Nacht dunkel mit Leuchten.

enum ChatMood: Equatable {
    case sun, cloud, rain, snow, night

    /** aus dem aktuellen Wetter; ohne Wetter oder bei ausgeschalteter Animation: neutrales Glas wie bei Wolken */
    @MainActor static var current: ChatMood {
        let s = WeatherService.shared
        guard s.animMode != "off", let w = s.current else { return .cloud }
        if !w.day { return .night }
        switch w.type {
        case "clear", "partly": return .sun
        case "snow", "sleet": return .snow
        case "drizzle", "rain", "heavy_rain", "thunder": return .rain
        default: return .cloud
        }
    }

    /** Text in Stellas Blasen */
    var stellaText: Color { self == .night ? Color(hex: 0xEEF3FF) : Theme.text }
    var stellaFaint: Color { self == .night ? Color(hex: 0xEEF3FF).opacity(0.6) : Theme.faint }

    /** Hintergrund deiner eigenen Blasen */
    var mine: LinearGradient {
        let c: [Color]
        switch self {
        case .sun: c = [Color(hex: 0x2E86FF), Color(hex: 0x36B6FF)]
        case .rain: c = [Color(hex: 0x245A8F), Color(hex: 0x3B7BB8)]
        case .snow: c = [Color(hex: 0x7B8CFF), Color(hex: 0x5AA8FF)]
        case .night: c = [Color(hex: 0x6D4AFF), Color(hex: 0xA35BFF)]
        case .cloud: c = [Theme.blue, Theme.blue.opacity(0.85)]
        }
        return LinearGradient(colors: c, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    var mineGlow: Color { self == .night ? Color(hex: 0xA05AFF).opacity(0.4) : Theme.blue.opacity(0.22) }
}

/** Hintergrund einer Blase von Stella je Wetter (Form, Füllung, Rand, Schmuck) */
struct StellaBubbleBackground: View {
    var mood: ChatMood
    var shape = BubbleShape(mine: false)

    var body: some View {
        switch mood {
        case .sun:
            shape.fill(LinearGradient(colors: [Color(hex: 0xFFFCF0, alpha: 0.94), Color(hex: 0xFFF4D6, alpha: 0.86)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(shape.stroke(Color(hex: 0xFFD678, alpha: 0.85), lineWidth: 1))
                .shadow(color: Color(hex: 0xFFAA28, alpha: 0.18), radius: 10, y: 4)
        case .cloud:
            shape.fill(.ultraThinMaterial)
                .overlay(shape.fill(.white.opacity(0.35)))
                .overlay(shape.stroke(.white.opacity(0.7), lineWidth: 1))
                .shadow(color: Theme.blue.opacity(0.08), radius: 8, y: 3)
        case .rain:
            shape.fill(.ultraThinMaterial)
                .overlay(shape.fill(Color(hex: 0xECF3FA, alpha: 0.45)))
                .overlay(shape.stroke(.white.opacity(0.6), lineWidth: 1))
                .overlay(alignment: .topTrailing) { Droplets().padding(.top, 4).padding(.trailing, 12) }
                .shadow(color: .black.opacity(0.08), radius: 8, y: 3)
        case .snow:
            shape.fill(.white.opacity(0.88))
                .overlay(shape.stroke(Color(hex: 0xDBE9FB), lineWidth: 1.5))
                .overlay(alignment: .topTrailing) {
                    Image(systemName: "snowflake").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color(hex: 0x8FB6E6)).offset(x: 4, y: -6)
                }
                .shadow(color: .white.opacity(0.5), radius: 4)
        case .night:
            shape.fill(Color(hex: 0x162248, alpha: 0.74))
                .overlay(shape.stroke(Color(hex: 0x96AAFF, alpha: 0.35), lineWidth: 1))
                .overlay(alignment: .topLeading) {
                    Image(systemName: "sparkle").font(.system(size: 10, weight: .bold)).foregroundStyle(Color(hex: 0xFFD98A)).offset(x: -3, y: -6)
                }
                .shadow(color: Color(hex: 0x788CFF, alpha: 0.25), radius: 12)
        }
    }
}

/** drei kleine Regentropfen oben am Blasenrand */
private struct Droplets: View {
    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Circle().frame(width: 4, height: 4)
            Circle().frame(width: 3, height: 3).padding(.top, 3)
            Circle().frame(width: 4.5, height: 4.5)
        }
        .foregroundStyle(.white.opacity(0.9))
        .accessibilityHidden(true)
    }
}
