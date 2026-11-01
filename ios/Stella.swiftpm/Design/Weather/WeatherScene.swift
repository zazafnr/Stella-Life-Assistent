import SwiftUI

// Wetter-Szenen hinter dem Chat und dem Ladebildschirm: SwiftUI `TimelineView(.animation)` + `Canvas`.
// Gleiche Schichten und Regeln wie web/src/weather/scene.ts (von hinten nach vorn):
// 1 Himmelsverlauf · 2 Sonne bzw. Mond und Sterne · 3 ferne Wolken · 4 nahe Wolken · 5 Niederschlag · 6 Glas-Tropfen bzw. Schneerand · 7 Blitz-Licht
// Farben und Zahlen kommen aus WeatherPalette.swift (erzeugt aus shared/src/weather.scene.ts).

extension Color {
    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

/// Zufall mit Startwert (gleiche Szene bei gleichem Wert)
final class SceneRandom {
    private var state: UInt64
    init(seed: UInt64) { state = seed &+ 0x9E3779B97F4A7C15 }
    func next() -> Double {
        state = state &+ 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        z = z ^ (z >> 31)
        return Double(z >> 11) / Double(1 << 53)
    }
}

/// Regeln aus shared/src/weather.scene.ts
enum WeatherRules {
    /// Dunkel (helle Schrift, dunkle Blasen): Nacht, Gewitter, Starkregen
    static func isDark(type: String, day: Bool) -> Bool { !day || type == "thunder" || type == "heavy_rain" }

    /// Verlauf eines Blitzes nach `t` Millisekunden: bolt = Sichtbarkeit des Blitzes (0–1), sky = Aufhellen (0–maxFlash)
    static func lightning(_ t: Double) -> (bolt: Double, sky: Double) {
        if t < 0 || t > 600 { return (0, 0) }
        func ramp(_ x: Double, _ a: Double, _ b: Double) -> Double { min(1, max(0, (x - a) / (b - a))) }
        let main = ramp(t, 0, 25) * (1 - ramp(t, 90, 160))
        let after = 0.4 * ramp(t, 185, 205) * (1 - ramp(t, 230, 270))
        let glow = 0.35 * (1 - ramp(t, 160, 600)) * ramp(t, 20, 60)
        return (min(1, max(main, after * 1.5, glow)), max(main, after) * WeatherPalette.maxFlash)
    }

    /// Mondphase 0…1 (0 = Neumond, 0,5 = Vollmond)
    static func moonPhase(_ date: Date) -> Double {
        let synodic = 29.530588853 * 86400.0
        let newMoon = 947182440.0 // 2000-01-06 18:14 UTC
        let d = (date.timeIntervalSince1970 - newMoon).truncatingRemainder(dividingBy: synodic)
        return (d < 0 ? d + synodic : d) / synodic
    }

    /// Dämmerung 0…1 (±45 Minuten um Sonnenauf- und -untergang)
    static func twilight(_ w: WeatherState, now: Date) -> Double {
        let window = 45.0 * 60
        func near(_ at: Double?) -> Double { at.map { max(0, 1 - abs(now.timeIntervalSince1970 - $0) / window) } ?? 0 }
        return max(near(w.sunrise), near(w.sunset))
    }

    static func particles(_ type: String, size: CGSize, quality: Double) -> Int {
        let base = Double(WeatherPalette.baseParticles[type] ?? 0)
        let area = min(2, max(1, Double(size.width * size.height) / (390 * 844)))
        return Int((base * area * min(1, max(0.2, quality))).rounded())
    }
}

private struct Puff { var dx: Double; var dy: Double; var r: Double }
private struct CloudShape { var x: Double; var y: Double; var w: Double; var speed: Double; var alpha: Double; var puffs: [Puff] }
private struct Splash { var x: Double; var age: Double }
private struct GlassDrop { var x: Double; var y: Double; var r: Double; var sliding: Bool; var wait: Double; var vy: Double; var phase: Double; var trail: [(x: Double, y: Double, age: Double, jump: Bool)] }
private struct Flake { var x: Double; var y: Double; var z: Int; var phase: Double; var freq: Double; var amp: Double; var size: Double; var rot: Double; var vrot: Double }
private struct Bolt { var paths: [(pts: [CGPoint], width: Double)]; var at: Double }

/// Eine Szene (Typ, Tag/Nacht) mit ihren Teilchen
final class WeatherScene {
    let type: String
    let day: Bool
    var wind: Int
    var calm: Bool
    var sunrise: Double?
    var sunset: Double?

    private let rng: SceneRandom
    private var t = 0.0
    private var size = CGSize.zero
    private var clouds: [[CloudShape]] = [[], [], []]
    private var drops: [(x: Double, y: Double, z: Int, v: Double)] = []
    private var splashes: [Splash] = []
    private var flakes: [Flake] = []
    private var veils: [(x: Double, speed: Double, w: Double, alpha: Double)] = []
    private var glass: [GlassDrop] = []
    private var stars: [(x: Double, y: Double, r: Double, base: Double, f: Double, p: Double)] = []
    private var fog: [(x: Double, y: Double, w: Double, h: Double, speed: Double, alpha: Double)] = []
    private var snowRim = 0.0
    private var bolt: Bolt?
    private var nextBolt: Double
    private var lastBolt = -1e9
    private var shoot: (x: Double, y: Double, vx: Double, vy: Double, age: Double)?
    private var nextShoot: Double

    private static let cloudCount: [String: [Int]] = [
        "clear": [0, 0, 2], "partly": [1, 2, 2], "cloudy": [3, 4, 4], "fog": [1, 1, 0], "drizzle": [2, 3, 3], "rain": [3, 4, 4],
        "heavy_rain": [3, 5, 5], "thunder": [4, 5, 5], "snow": [3, 4, 3], "sleet": [3, 4, 3],
    ]
    private static let starAlpha: [String: Double] = ["clear": 1, "partly": 0.6, "snow": 0.25]
    private static let moonAlpha: [String: Double] = ["clear": 1, "partly": 0.9, "cloudy": 0.45, "fog": 0.3, "snow": 0.5, "drizzle": 0.25, "sleet": 0.25]
    private static let windTan: [Double] = [0, 0.12, 0.27, 0.45]

    init(type: String, day: Bool, wind: Int, calm: Bool, seed: UInt64) {
        self.type = type; self.day = day; self.wind = wind; self.calm = calm
        rng = SceneRandom(seed: seed)
        nextBolt = 6 + rng.next() * 14
        nextShoot = 45 + rng.next() * 120
    }

    // MARK: Aufbau

    func resize(_ s: CGSize, quality: Double) {
        guard s.width > 1, s.height > 1 else { return }
        let changed = abs(s.width - size.width) > 1 || abs(s.height - size.height) > 1
        size = s
        if changed || clouds[2].isEmpty && clouds[1].isEmpty && drops.isEmpty && flakes.isEmpty { build(quality: quality) }
    }

    private func cloudColors() -> (light: Color, shade: Color) {
        func c(_ r: Double, _ g: Double, _ b: Double) -> Color { Color(red: r / 255, green: g / 255, blue: b / 255) }
        if !day { return type == "thunder" || type == "heavy_rain" ? (c(50, 58, 76), c(26, 32, 46)) : (c(78, 92, 120), c(38, 48, 72)) }
        switch type {
        case "clear", "partly": return (c(255, 255, 255), c(205, 220, 238))
        case "cloudy": return (c(228, 233, 239), c(172, 184, 198))
        case "fog": return (c(236, 240, 244), c(200, 208, 216))
        case "drizzle", "rain", "sleet": return (c(158, 170, 184), c(108, 120, 136))
        case "heavy_rain", "thunder": return (c(104, 116, 132), c(60, 70, 86))
        default: return (c(242, 246, 250), c(204, 214, 226))
        }
    }

    private func build(quality: Double) {
        let w = Double(size.width), h = Double(size.height)
        let counts = Self.cloudCount[type] ?? [0, 0, 0]
        let layers: [(scale: Double, alpha: Double, speed: Double, y0: Double, y1: Double)] = [
            (0.55, 0.5, 3, 0.04, 0.2), (0.8, 0.72, 7, 0.1, 0.34), (1.15, 0.92, 13, 0.02, 0.3),
        ]
        clouds = layers.enumerated().map { (li: Int, L: (scale: Double, alpha: Double, speed: Double, y0: Double, y1: Double)) -> [CloudShape] in
            (0..<counts[li]).map { (i: Int) -> CloudShape in
                let width = min(w * 0.9, 300) * L.scale * (type == "clear" ? 0.7 : 1) * (0.85 + rng.next() * 0.4)
                let n = 6 + Int(rng.next() * 4)
                let puffs: [Puff] = (0..<n).map { (k: Int) -> Puff in
                    let u = (Double(k) + 0.5) / Double(n)
                    let hump = sin(u * .pi)
                    return Puff(dx: 0.14 + u * 0.72, dy: 0.6 - hump * (0.08 + rng.next() * 0.2), r: 0.085 + hump * 0.08 + rng.next() * 0.04)
                }
                return CloudShape(x: Double(i) / Double(max(1, counts[li])) * (w + width) - width * 0.5 + rng.next() * 40,
                                  y: h * (L.y0 + rng.next() * (L.y1 - L.y0)), w: width, speed: L.speed * (0.8 + rng.next() * 0.5), alpha: L.alpha, puffs: puffs)
            }
        }
        fog = []
        if type == "fog" {
            for (yy, sp, a) in [(0.2, 8.0, 0.16), (0.45, -14.0, 0.14), (0.7, 22.0, 0.12)] {
                for k in 0..<5 {
                    fog.append((x: rng.next() * w, y: h * yy + (rng.next() - 0.5) * h * 0.12, w: w * (0.7 + rng.next() * 0.6), h: h * (0.16 + rng.next() * 0.1), speed: sp * (0.8 + Double(k) * 0.05), alpha: a))
                }
            }
        }
        stars = (0..<Int(min(220, w * h / 2600))).map { _ in
            (x: rng.next() * w, y: rng.next() * h * 0.72, r: 0.4 + rng.next() * 1.1, base: 0.35 + rng.next() * 0.65, f: 0.6 + rng.next() * 2.2, p: rng.next() * 6.28)
        }
        veils = (type == "heavy_rain" || type == "thunder") ? (0..<3).map { _ in (x: rng.next() * w, speed: 40 + rng.next() * 60, w: w * (0.5 + rng.next() * 0.5), alpha: 0.05 + rng.next() * 0.04) } : []
        fillParticles(quality: quality)
        glass = []
        if !calm, ["drizzle", "rain", "heavy_rain", "thunder"].contains(type) {
            let count = type == "drizzle" ? 5 : type == "rain" ? 8 : 11
            glass = (0..<count).map { _ in newGlass(y: rng.next() * h * 0.2) }
        }
    }

    private func fillParticles(quality: Double) {
        let w = Double(size.width), h = Double(size.height)
        let q = quality * (calm ? 0.5 : 1)
        let n = WeatherRules.particles(type, size: size, quality: q)
        if type == "snow" || type == "sleet" {
            let flakeN = type == "snow" ? n : Int(Double(n) * 0.3)
            let sizes: [Double] = [1.6, 3, 6.5]
            flakes = (0..<flakeN).map { _ in
                let z = rng.next() < 0.5 ? 0 : (rng.next() < 0.65 ? 1 : 2)
                return Flake(x: rng.next() * w, y: rng.next() * h, z: z, phase: rng.next() * 6.28, freq: 0.4 + rng.next() * 0.9, amp: 8 + rng.next() * 22,
                             size: sizes[z] * (0.8 + rng.next() * 0.4), rot: rng.next() * 6.28, vrot: (rng.next() - 0.5) * 0.8)
            }
        } else { flakes = [] }
        let dropN = type == "snow" ? 0 : (type == "sleet" ? n - Int(Double(n) * 0.3) : n)
        drops = (0..<dropN).map { i in (x: rng.next() * w * 1.3 - w * 0.15, y: rng.next() * h, z: i % 3, v: 0.85 + rng.next() * 0.3) }
    }

    private func newGlass(y: Double) -> GlassDrop {
        GlassDrop(x: rng.next() * Double(size.width), y: y, r: 3 + rng.next() * 5.5, sliding: false, wait: 2 + rng.next() * 9, vy: 0, phase: rng.next() * 6.28, trail: [])
    }

    // MARK: Bewegung

    func update(dt: Double, now: Double) {
        let w = Double(size.width), h = Double(size.height)
        guard w > 1 else { return }
        t += dt
        let speed = calm ? 0.65 : 1.0
        let tan = Self.windTan[min(3, max(0, wind))]
        let hs = max(0.6, h / 800)

        for li in 0..<3 {
            for i in clouds[li].indices {
                clouds[li][i].x += clouds[li][i].speed * dt * speed * (1 + Double(wind) * 0.18)
                if clouds[li][i].x > w + 10 { clouds[li][i].x = -clouds[li][i].w }
            }
        }
        for i in fog.indices {
            fog[i].x += fog[i].speed * dt * speed
            if fog[i].x > w + fog[i].w * 0.5 { fog[i].x = -fog[i].w * 0.5 } else if fog[i].x < -fog[i].w * 0.5 { fog[i].x = w + fog[i].w * 0.5 }
        }

        let speeds: [Double] = [620, 900, 1250]
        let slow = type == "drizzle" ? 0.6 : (type == "sleet" ? 0.7 : 1.0)
        for i in drops.indices {
            let vy = speeds[drops[i].z] * hs * drops[i].v * slow * speed
            drops[i].y += vy * dt
            drops[i].x += vy * tan * dt
            if drops[i].y > h {
                if drops[i].z == 2, splashes.count < 40, rng.next() < 0.5 { splashes.append(Splash(x: drops[i].x, age: 0)) }
                drops[i].y = -20 - rng.next() * 40
                drops[i].x = rng.next() * w * 1.3 - w * (0.15 + tan * 0.4)
            }
        }
        for i in splashes.indices { splashes[i].age += dt }
        splashes.removeAll { $0.age >= 0.28 }
        for i in veils.indices {
            veils[i].x += veils[i].speed * dt * (1 + tan * 3)
            if veils[i].x > w * 1.4 { veils[i].x = -veils[i].w }
        }

        let fall: [Double] = [26, 46, 74]
        for i in flakes.indices {
            flakes[i].y += fall[flakes[i].z] * hs * (type == "sleet" ? 1.8 : 1) * speed * dt
            flakes[i].x += (Double(wind) * 11 + sin(t * flakes[i].freq + flakes[i].phase) * flakes[i].amp * 0.5) * dt * speed
            flakes[i].rot += flakes[i].vrot * dt
            if flakes[i].y > h + 8 { flakes[i].y = -8; flakes[i].x = rng.next() * w }
            if flakes[i].x > w + 20 { flakes[i].x = -10 } else if flakes[i].x < -20 { flakes[i].x = w + 10 }
        }
        if type == "snow" { snowRim = min(1, snowRim + dt / 240) }

        for i in glass.indices {
            if !glass[i].sliding {
                glass[i].wait -= dt
                if rng.next() < dt * 0.15 { glass[i].r = min(10, glass[i].r + 0.35) }
                if glass[i].wait <= 0 { glass[i].sliding = true; glass[i].vy = 8 }
            } else {
                glass[i].vy = min(120, glass[i].vy + 70 * dt)
                glass[i].y += glass[i].vy * dt
                glass[i].x += sin(t * 3 + glass[i].phase) * 6 * dt
                glass[i].r = max(2.4, glass[i].r - 0.25 * dt)
                glass[i].trail.append((glass[i].x, glass[i].y, 0, false))
                if glass[i].trail.count > 90 { glass[i].trail.removeFirst() }
                if glass[i].y > h * 0.34 {
                    var fresh = newGlass(y: rng.next() * h * 0.18)
                    fresh.trail = glass[i].trail
                    fresh.trail.append((fresh.x, fresh.y, 0, true))
                    glass[i] = fresh
                }
            }
            for k in glass[i].trail.indices { glass[i].trail[k].age += dt }
            glass[i].trail.removeAll { $0.age >= 6 }
        }

        if !calm, !day, Self.starAlpha[type] != nil {
            if var s = shoot {
                s.age += dt; s.x += s.vx * dt; s.y += s.vy * dt
                shoot = s.age > 0.9 ? nil : s
            } else if t > nextShoot {
                let dir: Double = rng.next() < 0.5 ? 1 : -1
                shoot = (x: dir > 0 ? w * (0.05 + rng.next() * 0.3) : w * (0.95 - rng.next() * 0.3), y: h * (0.04 + rng.next() * 0.25), vx: dir * w * 0.7, vy: h * 0.18, age: 0)
                nextShoot = t + 60 + rng.next() * 120
            }
        }

        // Blitz: Abstand 6–20 s, nie weniger als 5 s nach dem letzten
        if type == "thunder", !calm, bolt == nil, t >= nextBolt, (t - lastBolt) * 1000 >= WeatherPalette.minLightningGapMs {
            strike(now: now)
            nextBolt = t + 6 + rng.next() * 14
        }
        if let b = bolt, now - b.at > 700 { bolt = nil }
    }

    /// Sofort ein Blitz (Abnahme, Wetter erzwingen)
    func strike(now: Double) {
        lastBolt = t
        let w = Double(size.width), h = Double(size.height)
        func jag(_ a: CGPoint, _ b: CGPoint, _ disp: Double, _ depth: Int, _ out: inout [CGPoint]) {
            if depth == 0 { out.append(b); return }
            let m = CGPoint(x: (a.x + b.x) / 2 + (rng.next() - 0.5) * disp, y: (a.y + b.y) / 2 + (rng.next() - 0.5) * disp * 0.3)
            jag(a, m, disp / 2, depth - 1, &out)
            jag(m, b, disp / 2, depth - 1, &out)
        }
        let x0 = w * (0.2 + rng.next() * 0.6), y1 = h * (0.45 + rng.next() * 0.2), x1 = x0 + (rng.next() - 0.5) * w * 0.3
        var main: [CGPoint] = [CGPoint(x: x0, y: 0)]
        jag(CGPoint(x: x0, y: 0), CGPoint(x: x1, y: y1), w * 0.22, 6, &main)
        var paths: [(pts: [CGPoint], width: Double)] = [(main, 2.4)]
        for _ in 0..<3 {
            let from = main[Int(Double(main.count) * (0.25 + rng.next() * 0.45))]
            var br: [CGPoint] = [from]
            jag(from, CGPoint(x: from.x + (rng.next() - 0.5) * w * 0.35, y: from.y + h * (0.08 + rng.next() * 0.14)), w * 0.1, 4, &br)
            paths.append((br, 1.3))
        }
        bolt = Bolt(paths: paths, at: now)
    }

    // MARK: Zeichnen

    func draw(_ ctx: GraphicsContext, now: Double, date: Date, reduced: Bool) {
        let w = Double(size.width), h = Double(size.height)
        guard w > 1 else { return }
        let pal = WeatherPalette.sky[type] ?? WeatherPalette.sky["cloudy"]!
        let cols = day ? pal.day : pal.night
        ctx.fill(Path(CGRect(origin: .zero, size: size)),
                 with: .linearGradient(Gradient(colors: [Color(hex: cols.0), Color(hex: cols.1)]), startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))

        let tw = WeatherRules.twilight(WeatherState(type: type, day: day, temp: 0, wind: 0, at: 0, sunrise: sunrise, sunset: sunset), now: date)
        if tw > 0.02 {
            ctx.fill(Path(CGRect(x: 0, y: h * 0.35, width: w, height: h * 0.65)),
                     with: .linearGradient(Gradient(stops: [
                        .init(color: Color(red: 1, green: 0.59, blue: 0.47).opacity(0), location: 0),
                        .init(color: Color(red: 1, green: 0.66, blue: 0.43).opacity(0.34 * tw), location: 0.55),
                        .init(color: Color(red: 0.96, green: 0.51, blue: 0.67).opacity(0.42 * tw), location: 1),
                     ]), startPoint: CGPoint(x: 0, y: h * 0.35), endPoint: CGPoint(x: 0, y: h)))
        }

        drawCelestial(ctx, date: date, reduced: reduced)
        drawClouds(ctx, layer: 0)
        drawFog(ctx)
        drawClouds(ctx, layer: 1)
        drawClouds(ctx, layer: 2)
        drawPrecip(ctx)
        drawGlass(ctx)
        drawSnowRim(ctx)
        drawLightning(ctx, now: now)
    }

    private func glow(_ ctx: GraphicsContext, _ c: CGPoint, _ r: Double, _ color: Color, alpha: Double = 1) {
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                 with: .radialGradient(Gradient(colors: [color.opacity(0.9 * alpha), color.opacity(0.35 * alpha), color.opacity(0)]), center: c, startRadius: 0, endRadius: r))
    }

    private func drawCelestial(_ ctx: GraphicsContext, date: Date, reduced: Bool) {
        let w = Double(size.width), h = Double(size.height)
        if day {
            guard type == "clear" || type == "partly" else { return }
            let c = CGPoint(x: w * 0.8, y: h * 0.13)
            let pulse = 1 + (reduced ? 0 : sin(t * 0.5) * 0.05)
            glow(ctx, c, min(w, 520) * 0.42 * pulse, Color(red: 1, green: 0.93, blue: 0.75), alpha: type == "partly" ? 0.8 : 1)
            // Lichtstrahlen, drehen minimal
            var rays = ctx
            rays.translateBy(x: c.x, y: c.y)
            rays.rotate(by: .radians(reduced ? 0.3 : t * 0.012))
            let len = min(w, 700) * 0.75
            for i in 0..<14 {
                let a = Double(i) / 14 * .pi * 2, spread = 0.07
                var p = Path()
                p.move(to: .zero)
                p.addLine(to: CGPoint(x: cos(a - spread) * len, y: sin(a - spread) * len))
                p.addLine(to: CGPoint(x: cos(a + spread) * len, y: sin(a + spread) * len))
                p.closeSubpath()
                rays.fill(p, with: .radialGradient(Gradient(colors: [Color(red: 1, green: 0.97, blue: 0.88).opacity(0.16), Color(red: 1, green: 0.97, blue: 0.88).opacity(0)]),
                                                   center: .zero, startRadius: 6, endRadius: len))
            }
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - 22, y: c.y - 22, width: 44, height: 44)), with: .color(Color(red: 1, green: 0.99, blue: 0.93).opacity(0.95)))
            return
        }
        if let sa = Self.starAlpha[type] {
            for s in stars {
                let tw = reduced || calm ? 0.85 : 0.6 + 0.4 * sin(t * s.f + s.p)
                ctx.fill(Path(ellipseIn: CGRect(x: s.x - s.r, y: s.y - s.r, width: s.r * 2, height: s.r * 2)), with: .color(.white.opacity(s.base * tw * sa)))
            }
            if let k = shoot {
                let a = sin(k.age / 0.9 * .pi)
                var p = Path()
                p.move(to: CGPoint(x: k.x, y: k.y))
                p.addLine(to: CGPoint(x: k.x - k.vx * 0.12, y: k.y - k.vy * 0.12))
                ctx.stroke(p, with: .linearGradient(Gradient(colors: [.white.opacity(0.9 * a), .white.opacity(0)]), startPoint: CGPoint(x: k.x, y: k.y), endPoint: CGPoint(x: k.x - k.vx * 0.12, y: k.y - k.vy * 0.12)),
                           style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
            }
        }
        if let ma = Self.moonAlpha[type] {
            let c = CGPoint(x: w * 0.78, y: h * 0.12), r = min(30, w * 0.07)
            glow(ctx, c, r * 3.5, Color(red: 0.78, green: 0.84, blue: 1), alpha: 0.7 * ma)
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(Color(red: 0.1, green: 0.13, blue: 0.24).opacity(0.85 * ma)))
            let phase = WeatherRules.moonPhase(date)
            let dir = phase < 0.5 ? 1.0 : -1.0
            let c2 = cos(phase * 2 * .pi)
            var lit = Path()
            var a = -Double.pi / 2
            lit.move(to: CGPoint(x: c.x, y: c.y - r))
            while a <= Double.pi / 2 + 1e-6 { lit.addLine(to: CGPoint(x: c.x + dir * r * cos(a), y: c.y + r * sin(a))); a += Double.pi / 24 }       // Rand der hellen Seite
            a = Double.pi / 2
            while a >= -Double.pi / 2 - 1e-6 { lit.addLine(to: CGPoint(x: c.x + dir * r * c2 * cos(a), y: c.y + r * sin(a))); a -= Double.pi / 24 } // Terminator
            lit.closeSubpath()
            ctx.fill(lit, with: .color(Color(red: 0.96, green: 0.95, blue: 0.91).opacity(ma)))
        }
    }

    private func drawClouds(_ ctx: GraphicsContext, layer: Int) {
        let (light, shade) = cloudColors()
        for c in clouds[layer] {
            var cc = ctx
            cc.opacity = c.alpha
            let h = c.w * 0.7
            for p in c.puffs {
                let center = CGPoint(x: c.x + p.dx * c.w, y: c.y + (p.dy + 0.35 * p.r) * h)
                let r = p.r * c.w
                cc.fill(Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)),
                        with: .radialGradient(Gradient(colors: [shade.opacity(0.9), shade.opacity(0)]), center: center, startRadius: 0, endRadius: r))
            }
            for p in c.puffs {
                let center = CGPoint(x: c.x + p.dx * c.w, y: c.y + p.dy * h)
                let r = p.r * c.w
                cc.fill(Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)),
                        with: .radialGradient(Gradient(stops: [.init(color: light.opacity(0.96), location: 0), .init(color: light.opacity(0.62), location: 0.6), .init(color: light.opacity(0), location: 1)]),
                                              center: CGPoint(x: center.x - r * 0.15, y: center.y - r * 0.25), startRadius: 0, endRadius: r))
            }
        }
    }

    private func drawFog(_ ctx: GraphicsContext) {
        let col: Color = day ? Color(red: 0.93, green: 0.95, blue: 0.96) : Color(red: 0.47, green: 0.52, blue: 0.61)
        for f in fog {
            let rect = CGRect(x: f.x - f.w / 2, y: f.y - f.h / 2, width: f.w, height: f.h)
            ctx.fill(Path(ellipseIn: rect), with: .radialGradient(Gradient(colors: [col.opacity(f.alpha * 2.2), col.opacity(0)]), center: CGPoint(x: f.x, y: f.y), startRadius: 0, endRadius: f.w / 2))
        }
    }

    private func drawPrecip(_ ctx: GraphicsContext) {
        let h = Double(size.height)
        let tan = Self.windTan[min(3, max(0, wind))]
        let hs = max(0.6, h / 800)
        let tint: Color = type == "sleet" ? Color(red: 0.78, green: 0.86, blue: 0.96) : (day ? Color(red: 0.92, green: 0.95, blue: 0.99) : Color(red: 0.75, green: 0.8, blue: 0.92))
        for v in veils {
            ctx.fill(Path(CGRect(x: v.x, y: 0, width: v.w, height: h)),
                     with: .linearGradient(Gradient(stops: [.init(color: Color(red: 0.82, green: 0.87, blue: 0.93).opacity(0), location: 0), .init(color: Color(red: 0.82, green: 0.87, blue: 0.93).opacity(v.alpha), location: 0.5), .init(color: Color(red: 0.82, green: 0.87, blue: 0.93).opacity(0), location: 1)]),
                                           startPoint: CGPoint(x: v.x, y: 0), endPoint: CGPoint(x: v.x + v.w, y: 0)))
        }
        if !drops.isEmpty {
            let lens: [Double] = [10, 17, 28], alphas: [Double] = [0.22, 0.38, 0.58], widths: [Double] = [0.8, 1.1, 1.6]
            for z in 0..<3 {
                var p = Path()
                let len = lens[z] * hs * (type == "drizzle" ? 0.7 : 1)
                for d in drops where d.z == z {
                    p.move(to: CGPoint(x: d.x, y: d.y))
                    p.addLine(to: CGPoint(x: d.x - len * tan, y: d.y - len))
                }
                ctx.stroke(p, with: .color(tint.opacity(alphas[z])), style: StrokeStyle(lineWidth: widths[z], lineCap: .round))
            }
        }
        for s in splashes {
            let k = s.age / 0.28
            for (dx, dy) in [(-4.0, -3.0), (3.5, -4.5), (0.5, -6.0)] {
                let c = CGPoint(x: s.x + dx * k * 2, y: h - 2 + dy * k * 1.6 + k * 4)
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - 1.2, y: c.y - 1.2, width: 2.4, height: 2.4)), with: .color(tint.opacity(0.55 * (1 - k))))
            }
        }
        if !flakes.isEmpty {
            let soft: [Double] = [0.5, 0.75, 0.95]
            for z in 0..<2 {
                if day {
                    var halo = Path()
                    for f in flakes where f.z == z { halo.addEllipse(in: CGRect(x: f.x - f.size - 1.2, y: f.y - f.size - 1.2, width: (f.size + 1.2) * 2, height: (f.size + 1.2) * 2)) }
                    ctx.fill(halo, with: .color(Color(red: 0.47, green: 0.57, blue: 0.7).opacity(0.16)))
                }
                var dots = Path()
                for f in flakes where f.z == z { dots.addEllipse(in: CGRect(x: f.x - f.size, y: f.y - f.size, width: f.size * 2, height: f.size * 2)) }
                ctx.fill(dots, with: .color(.white.opacity(soft[z])))
            }
            var stars = Path()
            for f in flakes where f.z == 2 {
                for a in 0..<3 {
                    let ang = f.rot + Double(a) * .pi / 3
                    stars.move(to: CGPoint(x: f.x - cos(ang) * f.size, y: f.y - sin(ang) * f.size))
                    stars.addLine(to: CGPoint(x: f.x + cos(ang) * f.size, y: f.y + sin(ang) * f.size))
                }
            }
            ctx.stroke(stars, with: .color(.white.opacity(0.95)), style: StrokeStyle(lineWidth: 1.1, lineCap: .round))
        }
    }

    private func drawGlass(_ ctx: GraphicsContext) {
        for g in glass {
            if g.trail.count > 1 {
                let n = g.trail.count, chunk = Int((Double(n) / 5).rounded(.up))
                var s0 = 0
                while s0 < n - 1 {
                    let seg = Array(g.trail[s0..<min(n, s0 + chunk + 1)])
                    let age = seg.map(\.age).max() ?? 0
                    var p = Path()
                    for (k, pt) in seg.enumerated() {
                        if k == 0 || pt.jump { p.move(to: CGPoint(x: pt.x, y: pt.y)) } else { p.addLine(to: CGPoint(x: pt.x, y: pt.y)) }
                    }
                    ctx.stroke(p, with: .color(.white.opacity(0.2 * max(0, 1 - age / 6))), style: StrokeStyle(lineWidth: max(1, g.r * 0.5), lineCap: .round, lineJoin: .round))
                    s0 += chunk
                }
            }
            let rx = g.r * 0.82, ry = g.r * (g.sliding ? 1.15 : 1)
            ctx.fill(Path(ellipseIn: CGRect(x: g.x - rx - 0.7, y: g.y + 0.6 - ry - 0.7, width: (rx + 0.7) * 2, height: (ry + 0.7) * 2)), with: .color(Color(red: 0.08, green: 0.13, blue: 0.22).opacity(0.2)))
            ctx.fill(Path(ellipseIn: CGRect(x: g.x - rx, y: g.y - ry, width: rx * 2, height: ry * 2)),
                     with: .radialGradient(Gradient(colors: [.white.opacity(0.55), Color(red: 0.82, green: 0.88, blue: 0.96).opacity(0.2), Color(red: 0.35, green: 0.47, blue: 0.63).opacity(0.28)]),
                                           center: CGPoint(x: g.x - rx * 0.3, y: g.y - ry * 0.35), startRadius: 0.5, endRadius: ry))
            ctx.fill(Path(ellipseIn: CGRect(x: g.x - rx * 0.32 - rx * 0.22, y: g.y - ry * 0.4 - ry * 0.16, width: rx * 0.44, height: ry * 0.32)), with: .color(.white.opacity(0.9)))
        }
    }

    private func drawSnowRim(_ ctx: GraphicsContext) {
        guard type == "snow" else { return }
        let w = Double(size.width), h = Double(size.height)
        let cap = 12 * snowRim + 2
        var p = Path()
        p.move(to: CGPoint(x: 0, y: h))
        var x = 0.0
        while x <= w { p.addLine(to: CGPoint(x: x, y: h - cap - sin(x * 0.045 + 1.3) * 2 - sin(x * 0.11) * 1.2)); x += 12 }
        p.addLine(to: CGPoint(x: w, y: h))
        p.closeSubpath()
        ctx.fill(p, with: .linearGradient(Gradient(stops: [.init(color: .white.opacity(0), location: 0), .init(color: .white.opacity(0.85), location: 0.35), .init(color: Color(red: 0.94, green: 0.96, blue: 0.99).opacity(0.95), location: 1)]),
                                          startPoint: CGPoint(x: 0, y: h - cap - 6), endPoint: CGPoint(x: 0, y: h)))
    }

    private func drawLightning(_ ctx: GraphicsContext, now: Double) {
        guard let b = bolt else { return }
        let (vis, sky) = WeatherRules.lightning((now - b.at) * 1000)
        if sky > 0 { ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(red: 0.84, green: 0.88, blue: 1).opacity(min(WeatherPalette.maxFlash, sky)))) }
        guard vis > 0.01 else { return }
        for p in b.paths {
            var path = Path()
            for (i, pt) in p.pts.enumerated() { if i == 0 { path.move(to: pt) } else { path.addLine(to: pt) } }
            ctx.stroke(path, with: .color(Color(red: 0.67, green: 0.75, blue: 1).opacity(0.16 * vis)), style: StrokeStyle(lineWidth: p.width * 7, lineCap: .round, lineJoin: .round))
            ctx.stroke(path, with: .color(Color(red: 0.8, green: 0.86, blue: 1).opacity(0.4 * vis)), style: StrokeStyle(lineWidth: p.width * 2.6, lineCap: .round, lineJoin: .round))
            ctx.stroke(path, with: .color(.white.opacity(0.95 * vis)), style: StrokeStyle(lineWidth: p.width * 0.9, lineCap: .round, lineJoin: .round))
        }
    }
}

/// Hält die laufende Szene und blendet bei neuem Wetter weich (2 s) über
final class WeatherSim {
    private var scene: WeatherScene?
    private var prev: WeatherScene?
    private var fade = 1.0
    private var last: Date?
    private var configured: (type: String, day: Bool, calm: Bool, reduced: Bool)?
    private var seed: UInt64 = 7

    func render(_ ctx: GraphicsContext, size: CGSize, date: Date, weather: WeatherState, calm: Bool, reduced: Bool) {
        let cfg = (type: weather.type, day: weather.day, calm: calm, reduced: reduced)
        if scene == nil || configured?.type != cfg.type || configured?.day != cfg.day || configured?.calm != cfg.calm || configured?.reduced != cfg.reduced {
            let first = scene == nil
            let next = WeatherScene(type: weather.type, day: weather.day, wind: weather.wind, calm: calm, seed: seed)
            seed &+= 17
            next.sunrise = weather.sunrise; next.sunset = weather.sunset
            next.resize(size, quality: ProcessInfo.processInfo.isLowPowerModeEnabled ? 0.5 : 1)
            if reduced { // Standbild: kurz einlaufen lassen
                var s = 0.0
                while s < 6 { next.update(dt: 0.05, now: s); s += 0.05 }
            }
            prev = (first || reduced) ? nil : scene
            scene = next
            fade = (first || reduced) ? 1 : 0
            configured = cfg
        }
        guard let scene else { return }
        scene.wind = weather.wind
        scene.sunrise = weather.sunrise; scene.sunset = weather.sunset
        scene.resize(size, quality: ProcessInfo.processInfo.isLowPowerModeEnabled ? 0.5 : 1)
        prev?.resize(size, quality: 1)
        let now = date.timeIntervalSinceReferenceDate
        if !reduced {
            let dt = min(0.1, last.map { date.timeIntervalSince($0) } ?? 0)
            if dt > 0 {
                scene.update(dt: dt, now: now)
                prev?.update(dt: dt, now: now)
                if fade < 1 { fade = min(1, fade + dt / 2); if fade >= 1 { prev = nil } }
            }
        }
        last = date
        if let prev, fade < 1 {
            prev.draw(ctx, now: now, date: date, reduced: reduced)
            var top = ctx
            top.opacity = fade
            scene.draw(top, now: now, date: date, reduced: reduced)
        } else {
            scene.draw(ctx, now: now, date: date, reduced: reduced)
        }
    }

    /// Für „Wetter erzwingen“: sofort ein Blitz
    func strike() { scene?.strike(now: Date().timeIntervalSinceReferenceDate) }
}

/// Der bewegte Himmel. Pausiert im Hintergrund; bei „Bewegung reduzieren“ ein ruhiges Standbild.
struct WeatherBackground: View {
    var weather: WeatherState
    /// "on" oder "calm"
    var mode: String = "on"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var sim = WeatherSim()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: reduceMotion || scenePhase != .active)) { timeline in
            Canvas { ctx, size in
                sim.render(ctx, size: size, date: timeline.date, weather: weather, calm: mode == "calm", reduced: reduceMotion)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}
