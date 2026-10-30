import SwiftUI

/** Ladebildschirm bei jedem Start nach dem ersten: steht nur da, solange die App wirklich lädt. */
struct LaunchView: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.skyTop, Theme.skyMid, Theme.bg], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack(spacing: 6) {
                HoppingStar(size: 56)
                    .padding(.bottom, 10)
                Text("Stella")
                    .font(Theme.display(34))
                    .foregroundStyle(Theme.text)
                Text("by EVOLSIOR")
                    .font(.system(size: 11, weight: .medium))
                    .tracking(3.5)
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.faint)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Stella wird geladen")
    }
}
