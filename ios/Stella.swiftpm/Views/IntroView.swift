import SwiftUI

/** EVOLSIOR-Intro beim allerersten Start (einmal pro Installation, etwa 3 Sekunden).
    0,0–0,8 s Name blendet ein und zieht sich leicht zusammen, 0,8–2,2 s „Built to become“ Buchstabe für Buchstabe
    (unscharf und etwas tiefer, dann scharf an seinem Platz), 0,7 s Stille, 0,4 s Ausblenden.
    Mit „Bewegung reduzieren“ nur Einblenden, 1,5 s stehen, ausblenden. */
struct IntroView: View {
    var onFinish: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var nameShown = false
    @State private var tagShown = false
    @State private var fadingOut = false

    private struct Letter: Identifiable {
        let id: Int
        let text: String
    }

    private let name = IntroView.letters("EVOLSIOR")
    private let tagline = IntroView.letters("Built to become")
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
            Color(hex: 0x0A0F1A).ignoresSafeArea()
            VStack(spacing: 22) {
                HStack(spacing: nameSize * (nameShown || reduceMotion ? 0.4 : 0.5)) {
                    ForEach(name) { letter in
                        Text(letter.text)
                    }
                }
                .font(.system(size: nameSize, weight: .ultraLight))
                .foregroundStyle(.white)
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
                .font(.system(size: tagSize, weight: .regular))
                .foregroundStyle(.white.opacity(0.7))
            }
            .offset(y: -50)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("EVOLSIOR – Built to become")
        }
        .opacity(fadingOut ? 0 : 1)
        .animation(.easeInOut(duration: 0.4), value: fadingOut)
        .task { await run() }
    }

    private func run() async {
        func wait(_ s: Double) async -> Bool {
            try? await Task.sleep(for: .seconds(s))
            return !Task.isCancelled
        }
        guard await wait(0.05) else { return }
        nameShown = true
        if reduceMotion {
            tagShown = true
            guard await wait(0.8 + 1.5) else { return }
        } else {
            guard await wait(0.8) else { return }
            tagShown = true
            guard await wait(1.4 + 0.7) else { return }
        }
        fadingOut = true
        guard await wait(0.4) else { return }
        onFinish()
    }
}
