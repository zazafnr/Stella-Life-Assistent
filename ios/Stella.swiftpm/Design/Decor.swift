import SwiftUI

/** Der vierzackige Stella-Stern aus dem App-Icon */
struct StarShape: Shape {
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let rx = rect.width / 2, ry = rect.height / 2
        let pull: CGFloat = 0.18
        var p = Path()
        p.move(to: CGPoint(x: c.x, y: c.y - ry))
        p.addQuadCurve(to: CGPoint(x: c.x + rx, y: c.y), control: CGPoint(x: c.x + rx * pull, y: c.y - ry * pull))
        p.addQuadCurve(to: CGPoint(x: c.x, y: c.y + ry), control: CGPoint(x: c.x + rx * pull, y: c.y + ry * pull))
        p.addQuadCurve(to: CGPoint(x: c.x - rx, y: c.y), control: CGPoint(x: c.x - rx * pull, y: c.y + ry * pull))
        p.addQuadCurve(to: CGPoint(x: c.x, y: c.y - ry), control: CGPoint(x: c.x - rx * pull, y: c.y - ry * pull))
        p.closeSubpath()
        return p
    }
}

struct StarMark: View {
    var size: CGFloat = 18
    var body: some View {
        StarShape()
            .fill(LinearGradient(colors: [Color(hex: 0xFFA3C8), Theme.pink], startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: size, height: size)
    }
}

/** Stern, der sanft hüpft und sich dreht */
struct HoppingStar: View {
    var size: CGFloat = 34
    @State private var up = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        StarMark(size: size)
            .shadow(color: Theme.pink.opacity(0.45), radius: 10)
            .offset(y: up ? -6 : 2)
            .rotationEffect(.degrees(up ? 10 : -4))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true)) { up = true }
            }
    }
}

/** Wolke aus drei Kreisen und einem flachen Sockel */
struct Cloud: View {
    var width: CGFloat
    var body: some View {
        let h = width * 0.42
        ZStack(alignment: .bottom) {
            Capsule().frame(width: width, height: h * 0.55)
            Circle().frame(width: h * 0.75).offset(x: -width * 0.18, y: -h * 0.22)
            Circle().frame(width: h).offset(x: width * 0.08, y: -h * 0.3)
        }
        .frame(width: width, height: h)
        .foregroundStyle(.white.opacity(0.92))
        .shadow(color: Theme.blue.opacity(0.08), radius: 8, y: 4)
    }
}

/** Himmel oben auf jeder Seite: Verlauf, ziehende Wolken, ab und zu eine Sternschnuppe */
struct Sky: View {
    var clouds = true
    var height: CGFloat = 320

    var body: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [Theme.skyTop, Theme.skyMid, Theme.bg], startPoint: .top, endPoint: .bottom)
                .frame(height: height)
            Circle()
                .fill(Theme.pink.opacity(0.16))
                .frame(width: 260)
                .blur(radius: 60)
                .offset(x: 140, y: 120)
            if clouds {
                TimelineView(.animation(minimumInterval: 1 / 30)) { ctx in
                    let t = ctx.date.timeIntervalSinceReferenceDate
                    GeometryReader { geo in
                        let w = geo.size.width
                        drifting(Cloud(width: 110), t: t, speed: 9, phase: 0.1, y: 24, w: w)
                        drifting(Cloud(width: 74), t: t, speed: 6, phase: 0.55, y: 70, w: w).opacity(0.85)
                        drifting(Cloud(width: 130), t: t, speed: 12, phase: 0.8, y: 120, w: w).opacity(0.7)
                        ShootingStar(t: t, width: w)
                    }
                }
                .frame(height: height)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .ignoresSafeArea(edges: .top)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func drifting<V: View>(_ v: V, t: Double, speed: Double, phase: Double, y: CGFloat, w: CGFloat) -> some View {
        let span = w + 300
        let x = ((t * speed / span + phase).truncatingRemainder(dividingBy: 1)) * span - 150
        return v.position(x: x, y: y)
    }
}

/** alle 9 Sekunden eine Sternschnuppe quer über den Himmel */
struct ShootingStar: View {
    var t: Double
    var width: CGFloat

    var body: some View {
        let period = 9.0, flight = 1.1
        let local = t.truncatingRemainder(dividingBy: period)
        let p = local / flight
        if p <= 1 {
            let start = CGPoint(x: width * 0.15, y: 30)
            let end = CGPoint(x: width * 0.75, y: 150)
            let x = start.x + (end.x - start.x) * p
            let y = start.y + (end.y - start.y) * p
            let angle = Angle(radians: atan2(Double(end.y - start.y), Double(end.x - start.x)))
            ZStack {
                Capsule()
                    .fill(LinearGradient(colors: [.white.opacity(0), .white], startPoint: .leading, endPoint: .trailing))
                    .frame(width: 90, height: 3)
                    .offset(x: -45)
                    .rotationEffect(angle)
                StarMark(size: 10)
            }
            .opacity(sin(p * .pi))
            .position(x: x, y: y)
        }
    }
}

/** Kleines Konfetti, wenn etwas erledigt ist */
struct Confetti: View {
    var trigger: Int
    @State private var pieces: [Piece] = []

    struct Piece: Identifiable {
        let id = UUID()
        let color: Color
        let dx: CGFloat
        let dy: CGFloat
        let spin: Double
    }

    var body: some View {
        ZStack {
            ForEach(pieces) { piece in
                ConfettiPiece(piece: piece)
            }
        }
        .allowsHitTesting(false)
        .onChange(of: trigger) { _, _ in burst() }
    }

    private func burst() {
        let colors = [Theme.pink, Theme.blue, Theme.greenBright, Color(hex: 0xA78BFA), Color(hex: 0x7CC4FF)]
        pieces = (0..<18).map { i in
            let a = Double(i) / 18 * 2 * .pi
            let r = CGFloat.random(in: 30...60)
            return Piece(color: colors[i % colors.count], dx: cos(a) * r, dy: sin(a) * r - 18, spin: .random(in: -200...200))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { pieces = [] }
    }
}

private struct ConfettiPiece: View {
    let piece: Confetti.Piece
    @State private var go = false

    var body: some View {
        RoundedRectangle(cornerRadius: 1.5)
            .fill(piece.color)
            .frame(width: 6, height: 9)
            .rotationEffect(.degrees(go ? piece.spin : 0))
            .offset(x: go ? piece.dx : 0, y: go ? piece.dy + 30 : 0)
            .opacity(go ? 0 : 1)
            .onAppear { withAnimation(.easeOut(duration: 1)) { go = true } }
    }
}
