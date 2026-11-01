import Foundation
import Observation

/// Sprache der App. Die Texte kommen aus denselben Katalogen wie Web und Server (I18nCatalogs.swift, erzeugt von scripts/gen-i18n.ts).
/// `@Observable`: Views, die `L(...)` in ihrem body benutzen, zeichnen sich bei einem Sprachwechsel neu.
@MainActor
@Observable
final class I18n {
    static let shared = I18n()

    static let supported = ["en", "de", "es", "fr", "it", "pt-BR", "tr", "pl"]
    /// Name jeder Sprache in ihrer eigenen Sprache
    static let names: [String: String] = [
        "en": "English", "de": "Deutsch", "es": "Español", "fr": "Français", "it": "Italiano",
        "pt-BR": "Português (Brasil)", "tr": "Türkçe", "pl": "Polski",
    ]
    private static let key = "stella.locale"

    private(set) var locale: String
    @ObservationIgnored private var catalogs: [String: [String: String]] = [:]

    private init() {
        let saved = UserDefaults.standard.string(forKey: Self.key)
        locale = Self.supported.contains(saved ?? "") ? saved! : Self.deviceLocale()
    }

    /// Gerätesprache, falls Stella sie kann, sonst Englisch
    static func deviceLocale() -> String {
        for tag in Locale.preferredLanguages {
            let t = tag.replacingOccurrences(of: "_", with: "-")
            if let exact = supported.first(where: { $0.lowercased() == t.lowercased() }) { return exact }
            let base = t.split(separator: "-").first.map(String.init)?.lowercased() ?? ""
            if let byBase = supported.first(where: { $0.split(separator: "-").first.map(String.init)?.lowercased() == base }) { return byBase }
        }
        return "en"
    }

    func set(_ newLocale: String) {
        guard Self.supported.contains(newLocale), newLocale != locale else { return }
        locale = newLocale
        UserDefaults.standard.set(newLocale, forKey: Self.key)
    }

    private func catalog(_ l: String) -> [String: String] {
        if let c = catalogs[l] { return c }
        var parsed: [String: String] = [:]
        if let json = I18nCatalogs.json[l], let data = json.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            parsed = dict
        }
        catalogs[l] = parsed
        return parsed
    }

    /// Mehrzahl-Kategorie wie Intl.PluralRules (die Sprachen, die Stella kann)
    static func plural(_ l: String, _ n: Int) -> String {
        switch l {
        case "fr": return n == 0 || n == 1 ? "one" : "other"
        case "pl":
            if n == 1 { return "one" }
            let m10 = n % 10, m100 = n % 100
            return (2...4).contains(m10) && !(12...14).contains(m100) ? "few" : "many"
        case "tr": return n == 1 ? "one" : "other"
        default: return n == 1 ? "one" : "other"
        }
    }

    /// Text zum Schlüssel; fehlt er, gilt Englisch, dann der Schlüssel selbst
    func text(_ key: String, _ vars: [String: Any] = [:]) -> String {
        var found: String?
        if let n = vars["count"] as? Int {
            for l in [locale, "en"] {
                found = catalog(l)["\(key)#\(Self.plural(l, n))"] ?? catalog(l)["\(key)#other"]
                if found != nil { break }
            }
        }
        found = found ?? catalog(locale)[key] ?? catalog("en")[key]
        guard var out = found else { return key }
        for (k, v) in vars { out = out.replacingOccurrences(of: "{\(k)}", with: "\(v)") }
        return out
    }
}

/// Länder, die Stella anbietet (wie COUNTRIES in shared/src/i18n/countries.ts), und das Schulwort für „Hausaufgaben“
extension I18n {
    static let countries = ["AT", "DE", "CH", "LI", "IT", "FR", "ES", "PT", "BR", "TR", "PL", "GB", "IE", "US", "CA", "AU", "MX", "AR", "OTHER"]
    /// typische Sprache je Land (COUNTRY_LOCALE)
    static let countryLocale: [String: String] = [
        "AT": "de", "DE": "de", "CH": "de", "LI": "de", "IT": "it", "FR": "fr", "ES": "es", "MX": "es", "AR": "es", "PT": "pt-BR", "BR": "pt-BR",
        "TR": "tr", "PL": "pl", "GB": "en", "IE": "en", "US": "en", "CA": "en", "AU": "en",
    ]

    /// Gleich wie schoolTerms(locale, country).homeworkPlural in shared (Österreich sagt „Hausübungen“)
    static func homeworkPlural(locale: String, country: String?) -> String {
        if locale == "de", country == "AT" { return "Hausübungen" }
        switch locale {
        case "de": return "Hausaufgaben"
        case "es": return "deberes"
        case "fr": return "devoirs"
        case "it": return "compiti"
        case "pt-BR": return "lições de casa"
        case "tr": return "ödevler"
        case "pl": return "zadania domowe"
        default: return "homework"
        }
    }

    /// Landesname in der aktuellen Sprache
    static func countryName(_ code: String, locale: String) -> String {
        code == "OTHER" ? I18n.shared.text("country.other") : (Locale(identifier: locale).localizedString(forRegionCode: code) ?? code)
    }

    /// Land aus der Region des Geräts, sonst das typische Land der Sprache
    static func guessCountry(locale: String) -> String {
        if let region = Locale.current.region?.identifier, countries.contains(region), region != "OTHER" { return region }
        return countryLocale.first(where: { $0.value == locale })?.key ?? "OTHER"
    }
}

/// `L("nav.today")`, `L("today.greeting.named", ["greeting": "Hello", "name": "Mia"])`
@MainActor
func L(_ key: String, _ vars: [String: Any] = [:]) -> String { I18n.shared.text(key, vars) }
