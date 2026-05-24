import SwiftUI
import AMapFoundationKit
import MAMapKit

@main
struct LiteDineGuideDemoApp: App {
    init() {
        DineFont.registerFonts()
        DineAMap.bootstrap()
        DineOfflineMapPrefetcher.start()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

private enum DineAMap {
    static func bootstrap() {
        if let apiKey = Bundle.main.object(forInfoDictionaryKey: "AMapAPIKey") as? String,
           !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            AMapServices.shared().apiKey = apiKey
            AMapServices.shared().enableHTTPS = true
        }

        MAMapView.updatePrivacyShow(.didShow, privacyInfo: .didContain)
        MAMapView.updatePrivacyAgree(.didAgree)
    }
}

private enum DineOfflineMapPrefetcher {
    private static var hasStarted = false

    static func start() {
        guard !hasStarted else { return }
        hasStarted = true

        guard let offlineMap = MAOfflineMap.shared() else { return }
        offlineMap.setup { setupSuccess in
            guard setupSuccess else { return }

            for item in matchingOfflineItems(from: offlineMap) {
                guard item.itemStatus.rawValue != 2,
                      !offlineMap.isDownloading(for: item) else {
                    continue
                }

                offlineMap.downloadItem(item, shouldContinueWhenAppEntersBackground: true) { _, _, _ in }
            }
        }
    }

    private static func matchingOfflineItems(from offlineMap: MAOfflineMap) -> [MAOfflineItem] {
        let targetNames = Set(
            DineCity.all.flatMap { city in
                [city.cityName, city.province].map(normalizedOfflineName)
            }
        )
        let allItems: [MAOfflineItem] = offlineMap.cities + offlineMap.municipalities

        return allItems.filter { item in
            targetNames.contains(normalizedOfflineName(item.name))
        }
    }

    private static func normalizedOfflineName(_ name: String) -> String {
        name
            .replacingOccurrences(of: "特别行政区", with: "")
            .replacingOccurrences(of: "市", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
