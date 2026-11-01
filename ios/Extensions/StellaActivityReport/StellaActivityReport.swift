import DeviceActivity
import ExtensionKit
import SwiftUI

/// Zeigt die Bildschirmzeit in der App (heute, Woche, Top-Apps als Balken). Die Daten bleiben in dieser Erweiterung – die App sieht sie nie.
@main
struct StellaActivityReport: DeviceActivityReportExtension {
    var body: some DeviceActivityReportScene {
        OverviewScene { summary in OverviewView(summary: summary) }
    }
}

extension DeviceActivityReport.Context {
    static let overview = Self("stellaOverview")
}

struct OverviewSummary {
    var total: TimeInterval
    var apps: [(name: String, duration: TimeInterval)]
}

struct OverviewScene: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .overview
    let content: (OverviewSummary) -> OverviewView

    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> OverviewSummary {
        var total: TimeInterval = 0
        var perApp: [String: TimeInterval] = [:]
        for await day in data {
            for await segment in day.activitySegments {
                total += segment.totalActivityDuration
                for await category in segment.categories {
                    for await app in category.applications {
                        perApp[app.application.localizedDisplayName ?? "App", default: 0] += app.totalActivityDuration
                    }
                }
            }
        }
        return OverviewSummary(total: total, apps: perApp.sorted { $0.value > $1.value }.prefix(5).map { ($0.key, $0.value) })
    }
}

struct OverviewView: View {
    let summary: OverviewSummary

    private func text(_ t: TimeInterval) -> String {
        let f = DateComponentsFormatter()
        f.allowedUnits = [.hour, .minute]
        f.unitsStyle = .abbreviated
        return f.string(from: t) ?? "0m"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(text(summary.total)).font(.system(size: 34, weight: .bold, design: .rounded))
            let top = summary.apps.first?.duration ?? 1
            ForEach(Array(summary.apps.enumerated()), id: \.offset) { _, app in
                VStack(alignment: .leading, spacing: 2) {
                    HStack { Text(app.name).font(.system(size: 15)); Spacer(); Text(text(app.duration)).font(.system(size: 13)).foregroundStyle(.secondary) }
                    GeometryReader { geo in
                        Capsule().fill(Color.blue.opacity(0.55)).frame(width: max(6, geo.size.width * app.duration / max(top, 1)), height: 8)
                    }.frame(height: 8)
                }
            }
        }
        .padding()
    }
}
