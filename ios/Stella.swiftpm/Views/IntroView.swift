import SwiftUI

/** EVOLSIOR-Intro beim allerersten Start (einmal pro Installation, etwa 3 Sekunden) im hellen Stella-Look:
    Himmel-Verlauf, Wolken, rosa Stern, ein Farbschimmer über dem Namen.
    0,0–0,8 s Name blendet ein und zieht sich leicht zusammen, 0,8–2,2 s „Built to become“ Buchstabe für Buchstabe
    (unscharf und etwas tiefer, dann scharf an seinem Platz), 0,7 s Stille, 0,4 s Ausblenden.
    Mit „Bewegung reduzieren“ nur Einblenden, 1,5 s stehen, ausblenden. */
struct IntroView: View {
    var onFinish: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var nameShown = false
    @State private var tagShown = false
    @State private var sceneShown = false
    @State private var shine = false
    @State private var fadingOut = false

    private struct Letter: Identifiable {
        let id: Int
        let text: String
    }

    private struct Spark: Identifiable {
        let id: Int
        let x: CGFloat
        let y: CGFloat
        let size: CGFloat
        let delay: Double
        let pink: Bool
    }

    private let name = IntroView.letters("EVOLSIOR")
    private let tagline = IntroView.letters("Built to become")
    private let sparks = [
        Spark(id: 0, x: 0.24, y: 0.31, size: 18, delay: 0.9, pink: true),
        Spark(id: 1, x: 0.76, y: 0.36, size: 13, delay: 1.3, pink: false),
        Spark(id: 2, x: 0.30, y: 0.62, size: 12, delay: 1.7, pink: false),
        Spark(id: 3, x: 0.70, y: 0.60, size: 17, delay: 1.1, pink: true),
        Spark(id: 4, x: 0.50, y: 0.24, size: 11, delay: 1.5, pink: false),
    ]
    private let nameSize: CGFloat = 32
    private let tagSize: CGFloat = 13

    private static func letters(_ s: String) -> [Letter] {
        s.enumerated().map { Letter(id: $0.offset, text: $0.element == " " ? "\u{00A0}" : String($0.element)) }
    }

    private var nameAnimation: Animation {
        reduceMotion ? Animation.easeOut(duration: 0.8) : Animation.timingCurve(0.2, 0.7, 0.2, 1, duration: 0.8)
    }

    private func letterAnimation(_ index: Int) -> Animation {
        reduceMotion ? Animation.easeOut(duration: 0.8) : Animation.easeOut(duration: 0.3).delay(0.08 * Double(index))
    }

    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.skyTop, Theme.skyMid, .white], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            scene
            VStack(spacing: 20) {
                HoppingStar(size: 46)
                    .scaleEffect(sceneShown ? 1 : 0.4)
                    .opacity(sceneShown ? 1 : 0)
                    .animation(reduceMotion ? .easeOut(duration: 0.8) : .spring(response: 0.7, dampingFraction: 0.55), value: sceneShown)

                nameRow
                    .foregroundStyle(Theme.text)
                    .overlay { shimmer.mask { nameRow } }
                    .opacity(nameShown ? 1 : 0)
                    .animation(nameAnimation, value: nameShown)

                HStack(spacing: tagSize * 0.15) {
                    ForEach(tagline) { letter in
                        Text(letter.text)
                            .opacity(tagShown ? 1 : 0)
                            .blur(radius: tagShown || reduceMotion ? 0 : 8)
                            .offset(y: tagShown || reduceMotion ? 0 : 6)
                            .animation(letterAnimation(letter.id), value: tagShown)
                    }
                }
                .font(.system(size: tagSize, weight: .medium))
                .foregroundStyle(Theme.muted)
            }
            .offset(y: -30)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("EVOLSIOR – Built to become")
        }
        .opacity(fadingOut ? 0 : 1)
        .animation(.easeInOut(duration: 0.4), value: fadingOut)
        .task { await run() }
    }

    private var nameRow: some View {
        HStack(spacing: nameSize * (nameShown || reduceMotion ? 0.4 : 0.5)) {
            ForEach(name) { letter in
                Text(letter.text)
            }
        }
        .font(.system(size: nameSize, weight: .ultraLight))
    }

    /** Farbband, das einmal über den Namen wandert */
    private var shimmer: some View {
        GeometryReader { geo in
            LinearGradient(colors: [.clear, Theme.blue, Theme.pink, .clear], startPoint: .leading, endPoint: .trailing)
                .frame(width: geo.size.width * 0.45)
                .offset(x: shine ? geo.size.width : -geo.size.width * 0.45)
                .animation(.easeInOut(duration: 1.5), value: shine)
        }
        .allowsHitTesting(false)
    }

    /** Wolken, Farbschimmer und Glitzersterne im Hintergrund */
    private var scene: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                Circle().fill(Theme.pink.opacity(0.22)).frame(width: 280).blur(radius: 60)
                    .position(x: w * 0.95, y: h * 0.38)
                Circle().fill(Theme.blue.opacity(0.18)).frame(width: 240).blur(radius: 60)
                    .position(x: w * 0.02, y: h * 0.88)
                cloud(110, x: 0.12, y: 0.10, w: w, h: h, from: -50)
                cloud(140, x: 0.86, y: 0.19, w: w, h: h, from: 50)
                cloud(90, x: 0.16, y: 0.72, w: w, h: h, from: -50)
                cloud(120, x: 0.88, y: 0.82, w: w, h: h, from: 50)
                if !reduceMotion {
                    ForEach(sparks) { s in
                        Sparkle(size: s.size, delay: s.delay, pink: s.pink)
                            .position(x: w * s.x, y: h * s.y)
                    }
                }
            }
        }
        .ignoresSafeArea()
        .opacity(sceneShown ? 1 : 0)
        .animation(.easeOut(duration: 1.2), value: sceneShown)
        .allowsHitTesting(false)
    }

    private func cloud(_ width: CGFloat, x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat, from: CGFloat) -> some View {
        Cloud(width: width)
            .position(x: w * x, y: h * y)
            .offset(x: sceneShown || reduceMotion ? 0 : from)
            .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: 1.4), value: sceneShown)
    }

    private func run() async {
        func wait(_ s: Double) async -> Bool {
            try? await Task.sleep(for: .seconds(s))
            return !Task.isCancelled
        }
        guard await wait(0.05) else { return }
        sceneShown = true
        nameShown = true
        if reduceMotion {
            tagShown = true
            guard await wait(0.8 + 1.5) else { return }
        } else {
            guard await wait(0.8) else { return }
            tagShown = true
            guard await wait(0.7) else { return }
            shine = true
            guard await wait(0.7 + 0.7) else { return }
        }
        fadingOut = true
        guard await wait(0.4) else { return }
        onFinish()
    }
}

/** Kleiner Glitzerstern, der auf- und wieder zugeht */
private struct Sparkle: View {
    var size: CGFloat
    var delay: Double
    var pink: Bool
    @State private var on = false

    var body: some View {
        StarShape()
            .fill(pink ? Theme.pink : Theme.blue.opacity(0.8))
            .frame(width: size, height: size)
            .shadow(color: Theme.pink.opacity(0.5), radius: 5)
            .scaleEffect(on ? 1 : 0.3)
            .rotationEffect(.degrees(on ? 25 : 0))
            .opacity(on ? 1 : 0)
            .onAppear {
                withAnimation(.easeInOut(duration: 1.3).delay(delay).repeatForever(autoreverses: true)) { on = true }
            }
    }
}
