import Charts
import SwiftUI

struct StepsChart: View {
    var days: [HealthDay]
    var goal: Int

    var body: some View {
        if days.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "figure.walk").font(.system(size: 30)).foregroundStyle(Theme.faint)
                Text("Noch keine Schritte gespeichert.").foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Chart {
                ForEach(days, id: \.date) { d in
                    BarMark(
                        x: .value("Tag", Day.parse(d.date) ?? Date(), unit: .day),
                        y: .value("Schritte", d.steps ?? 0)
                    )
                    .foregroundStyle((d.steps ?? 0) >= goal ? Theme.greenBright : Theme.blue.opacity(0.75))
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                }
                RuleMark(y: .value("Ziel", goal))
                    .foregroundStyle(Theme.pink)
                    .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                    .annotation(position: .top, alignment: .trailing) {
                        Text("Ziel").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.pinkText)
                    }
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: 2)) { _ in
                    AxisValueLabel(format: .dateTime.day().month(.defaultDigits), centered: true)
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { _ in
                    AxisGridLine().foregroundStyle(Theme.border)
                    AxisValueLabel()
                }
            }
        }
    }
}
