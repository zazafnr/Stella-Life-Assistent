import SwiftUI

// Farben und Formen aus dem hellen Stella-Design (web/src/styles.css).

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }
}

enum Theme {
    static let bg = Color(hex: 0xF5F9FF)
    static let surface = Color.white
    static let text = Color(hex: 0x0F2A4A)
    static let muted = Color(hex: 0x5B7190)
    static let faint = Color(hex: 0x8DA0BA)
    static let border = Color(hex: 0xDCE7F5)
    static let blue = Color(hex: 0x1F6FEB)
    static let blueTint = Color(hex: 0xE6F0FF)
    static let pink = Color(hex: 0xFF7EB3)
    static let pinkText = Color(hex: 0xC0306E)
    static let pinkTint = Color(hex: 0xFFE8F1)
    static let green = Color(hex: 0x138A4B)
    static let greenBright = Color(hex: 0x34C77B)
    static let greenTint = Color(hex: 0xE3F7EC)
    static let skyTop = Color(hex: 0xCFE6FF)
    static let skyMid = Color(hex: 0xE8F3FF)

    static let radius: CGFloat = 20

    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .heavy, design: .rounded) }
}

/** Weiße Karte mit weichem blauem Schatten */
struct CardStyle: ViewModifier {
    var padding: CGFloat = 16
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(Theme.border.opacity(0.7), lineWidth: 1))
            .shadow(color: Theme.blue.opacity(0.08), radius: 16, x: 0, y: 8)
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardStyle(padding: padding)) }

    /** sanftes Hochgleiten beim Erscheinen, gestaffelt über `index` */
    func rise(_ index: Int = 0) -> some View { modifier(Rise(delay: Double(index) * 0.06)) }
}

struct Rise: ViewModifier {
    var delay: Double
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 14)
            .onAppear {
                withAnimation(.spring(response: 0.55, dampingFraction: 0.85).delay(delay)) { shown = true }
            }
    }
}

/** Kleine Kapsel: "Im Heft", "offen", "Stella löst …" */
struct Pill: View {
    enum Tone { case green, blue, gray, pink }
    var text: String
    var icon: String? = nil
    var tone: Tone = .gray

    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 11, weight: .bold)) }
            Text(text)
        }
        .font(.system(size: 12, weight: .semibold))
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .foregroundStyle(fg)
        .background(bg, in: Capsule())
    }

    private var fg: Color {
        switch tone {
        case .green: return Theme.green
        case .blue: return Theme.blue
        case .gray: return Theme.muted
        case .pink: return Theme.pinkText
        }
    }
    private var bg: Color {
        switch tone {
        case .green: return Theme.greenTint
        case .blue: return Theme.blueTint
        case .gray: return Color(hex: 0xEEF3FA)
        case .pink: return Theme.pinkTint
        }
    }
}

/** Großer blauer Knopf */
struct PrimaryButton: ButtonStyle {
    var tint: Color = Theme.blue
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(tint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: tint.opacity(0.3), radius: 12, x: 0, y: 6)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/** Leichtes Einsinken beim Tippen auf Karten */
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/** Fortschrittsring wie auf der Heute-Seite */
struct Ring: View {
    var progress: Double
    var color: Color
    var lineWidth: CGFloat = 6
    var label: String
    @State private var shown = 0.0

    var body: some View {
        ZStack {
            Circle().stroke(Color(hex: 0xE3ECF8), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: shown)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text(label)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.text)
                .minimumScaleFactor(0.6)
                .padding(lineWidth + 2)
        }
        .onAppear { withAnimation(.easeOut(duration: 1.1).delay(0.2)) { shown = min(max(progress, 0), 1) } }
        .onChange(of: progress) { _, p in withAnimation(.easeOut(duration: 0.6)) { shown = min(max(p, 0), 1) } }
    }
}
