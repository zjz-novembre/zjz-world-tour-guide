import SwiftUI

@main
struct LiteDineGuideDemoApp: App {
    init() {
        DineFont.registerFonts()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
