import SwiftUI

// Neue Karten für „Heute“ (Design-Auswahl „News B“ und „Extras 1“):
// - WeatherHeroCard: Begrüßung als große Karte im aktuellen Wetter
// - NewsStoriesView: News als Story-Karussell mit Vorschaubild, Themen-Chip und Quelle

/** Begrüßung oben auf „Heute“ in einer Karte, die wie das Wetter draußen aussieht */
struct WeatherHeroCard: View {
    var greeting: String
    var offline: Bool
    var onSettings: () -> Void

    private var weather: WeatherState? { WeatherService.shared.current }

    /** kräftige Verläufe je Wetter, damit weiße Schrift überall gut lesbar ist */
    private var colors: [Color] {
        guard let w = weather else { return [Color(hex: 0x3E8FE8), Color(hex: 0x79BDFF)] }
        if !w.day { return [Color(hex: 0x0A1230), Color(hex: 0x2A3A6B)] }
        switch w.type {
        case "clear": return [Color(hex: 0x3E8FE8), Color(hex: 0x79BDFF)]
        case "partly": return [Color(hex: 0x5A9BDE), Color(hex: 0x93C2EE)]
        case "cloudy", "fog": return [Color(hex: 0x7F93AA), Color(hex: 0xA9B8C9)]
        case "drizzle", "rain": return [Color(hex: 0x5E7690), Color(hex: 0x8499AF)]
        case "heavy_rain", "thunder": return [Color(hex: 0x2F3A4C), Color(hex: 0x4C5A6E)]
        case "snow", "sleet": return [Color(hex: 0x8FA6C4), Color(hex: 0xB9C9DD)]
        default: return [Color(hex: 0x3E8FE8), Color(hex: 0x79BDFF)]
        }
    }

    private var symbol: String {
        guard let w = weather else { return "sun.max.fill" }
        switch w.type {
        case "clear": return w.day ? "sun.max.fill" : "moon.stars.fill"
        case "partly": return w.day ? "cloud.sun.fill" : "cloud.moon.fill"
        case "fog": return "cloud.fog.fill"
        case "drizzle": return "cloud.drizzle.fill"
        case "rain", "heavy_rain": return "cloud.rain.fill"
        case "thunder": return "cloud.bolt.rain.fill"
        case "snow": return "cloud.snow.fill"
        case "sleet": return "cloud.sleet.fill"
        default: return "cloud.fill"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top) {
                    Text(Date().formatted(.dateTime.locale(Day.locale).weekday(.wide).day().month(.wide)))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                    Spacer()
                    Button(action: onSettings) {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 17))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(.white.opacity(0.22), in: Circle())
                    }
                    .accessibilityLabel(L("nav.settings"))
                }
                Spacer(minLength: 18)
                if let w = weather {
                    Text("\(w.temp)°")
                        .font(.system(size: 44, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                        .accessibilityLabel(L("weather.chip", ["type": L("weather.type.\(w.type)"), "temp": w.temp]))
                }
                Text(greeting)
                    .font(Theme.display(28))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                if let w = weather {
                    Text(L("weather.type.\(w.type)"))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.9))
                }
                if offline {
                    Label(L("ios.offline.i.will.sync"), systemImage: "wifi.slash")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.9))
                }
            }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 190, alignment: .topLeading)
        // großes Wetter-Symbol unten rechts als Bild
        .background(alignment: .bottomTrailing) {
            Image(systemName: symbol)
                .symbolRenderingMode(.multicolor)
                .font(.system(size: 92))
                .opacity(0.9)
                .offset(x: 14, y: 16)
                .accessibilityHidden(true)
        }
        .background(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: colors[0].opacity(0.35), radius: 18, y: 8)
        .padding(.top, 8)
    }
}

/** Farbe je News-Thema für den kleinen Chip */
enum NewsTopicLook {
    static func colors(_ topic: String?) -> (fg: Color, bg: Color) {
        switch topic {
        case "tech", "science": return (Theme.blue, Theme.blueTint)
        case "climate", "environment", "health": return (Theme.green, Theme.greenTint)
        case "sport", "culture", "entertainment": return (Theme.pinkText, Theme.pinkTint)
        default: return (Color(hex: 0xA86B00), Color(hex: 0xFFF3D6))
        }
    }
}

/** Story-Karussell: große Bildkarten zum Durchwischen, Titel auf dem Bild */
struct NewsStoriesView: View {
    var news: [NewsEntry]
    var open: (NewsEntry) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 12) {
                ForEach(Array(news.enumerated()), id: \.element.id) { i, n in
                    Button { open(n) } label: { NewsStoryCard(entry: n, index: i) }
                        .buttonStyle(PressableStyle())
                        .accessibilityHint(L("news.card.open"))
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, 20)
            .padding(.vertical, 6)
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollClipDisabled()
        .padding(.horizontal, -20)
    }
}

struct NewsStoryCard: View {
    var entry: NewsEntry
    var index: Int

    /** Ersatzbild ohne Vorschaubild: ein Verlauf je Platz, damit die Karten nebeneinander verschieden aussehen */
    private var fallback: LinearGradient {
        let sets: [[Color]] = [
            [Color(hex: 0x4B8FE0), Color(hex: 0x173A6B)], [Color(hex: 0xB9A7FF), Color(hex: 0x5B43D8)],
            [Color(hex: 0xFF9FC2), Color(hex: 0xC0306E)], [Color(hex: 0x7BD3A0), Color(hex: 0x1F7A4D)],
        ]
        return LinearGradient(colors: sets[index % sets.count], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Rectangle().fill(fallback).frame(width: 220, height: 270)
            if let s = entry.image, let url = URL(string: s) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill().frame(width: 220, height: 270).clipped()
                    } else { Color.clear }
                }
            }
            LinearGradient(colors: [.clear, .black.opacity(0.15), .black.opacity(0.78)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 6) {
                if let topic = entry.topic {
                    let c = NewsTopicLook.colors(topic)
                    Text(L("news.topic.\(topic)"))
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(c.fg)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(c.bg, in: Capsule())
                }
                Text(entry.sentence)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .lineLimit(4)
                HStack(spacing: 5) {
                    if entry.favorite == true { Image(systemName: "star.fill").font(.system(size: 10)) }
                    Text(entry.source)
                    if let d = ISO.parse(entry.publishedAt) { Text("· \(d.formatted(.relative(presentation: .named).locale(Day.locale)))") }
                }
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(1)
            }
            .padding(14)
        }
        .frame(width: 220, height: 270)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: Color(hex: 0x0F2A4A).opacity(0.18), radius: 12, y: 6)
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}
