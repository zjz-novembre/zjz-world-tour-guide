import CoreLocation
import Foundation
import MapKit
import SwiftUI

enum GuideKind: String, CaseIterable, Identifiable, Decodable {
    case michelin
    case blackPearl

    var id: String { rawValue }

    var title: String {
        switch self {
        case .michelin:
            return "MICHELIN"
        case .blackPearl:
            return "Black Pearl"
        }
    }

    var brandColor: Color {
        switch self {
        case .michelin:
            return DineStyle.michelinRed
        case .blackPearl:
            return DineStyle.blackPearl
        }
    }

    var accentColor: Color {
        switch self {
        case .michelin:
            return DineStyle.michelinRed
        case .blackPearl:
            return DineStyle.pearlGold
        }
    }
}

enum DineLevel: String, Decodable {
    case threeStars = "three-stars"
    case twoStars = "two-stars"
    case oneStar = "one-star"
    case bib = "bib-gourmand"
    case selected

    func label(for guide: GuideKind) -> String {
        switch guide {
        case .michelin:
            switch self {
            case .threeStars:
                return "三星"
            case .twoStars:
                return "二星"
            case .oneStar:
                return "一星"
            case .bib:
                return "必比登"
            case .selected:
                return "入选"
            }
        case .blackPearl:
            switch self {
            case .threeStars:
                return "三钻"
            case .twoStars:
                return "二钻"
            default:
                return "一钻"
            }
        }
    }

    var sortRank: Int {
        switch self {
        case .threeStars:
            return 0
        case .twoStars:
            return 1
        case .oneStar:
            return 2
        case .bib:
            return 3
        case .selected:
            return 4
        }
    }
}

struct DineCity: Identifiable, Equatable {
    let id: String
    let label: String
    let cityName: String
    let province: String
    let country: String
    let center: CLLocationCoordinate2D
    let span: MKCoordinateSpan

    static func == (lhs: DineCity, rhs: DineCity) -> Bool {
        lhs.id == rhs.id
    }
}

extension DineCity {
    static let initialVisibleWidthKilometers: CLLocationDistance = 14

    static let all: [DineCity] = [
        webCity("beijing", "北京", "北京", 39.93925, 116.4163734),
        webCity("guangzhou", "广州", "广东", 23.1291, 113.2644),
        webCity("chengdu", "成都", "四川", 30.654443, 104.0677419),
        webCity("fuzhou", "福州", "福建", 26.0745, 119.2965),
        webCity("xiamen", "厦门", "福建", 24.4803, 118.1098),
        webCity("quanzhou", "泉州", "福建", 24.9116056, 118.5938671),
        webCity("ningde", "宁德", "福建", 26.6657, 119.5482),
        webCity("shanghai", "上海", "上海", 31.2286, 121.4746),
        webCity("nanjing", "南京", "江苏", 32.0603, 118.7969),
        webCity("suzhou", "苏州", "江苏", 31.2989, 120.5853),
        webCity("yangzhou", "扬州", "江苏", 32.3936, 119.4127),
        webCity("changzhou", "常州", "江苏", 31.8112, 119.9741),
        webCity("hangzhou", "杭州", "浙江", 30.2741, 120.1551),
        webCity("wenzhou", "温州", "浙江", 27.9943, 120.6994),
        webCity("taizhou", "台州", "浙江", 28.6564, 121.4208),
        webCity("hong-kong", "香港", "香港特别行政区", 22.3193, 114.1694),
        webCity("macau", "澳门", "澳门特别行政区", 22.1987, 113.5439),
    ]

    static let cityByID = Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })

    static let shanghai = cityByID["shanghai"]!

    private static func webCity(
        _ id: String,
        _ cityName: String,
        _ province: String,
        _ latitude: CLLocationDegrees,
        _ longitude: CLLocationDegrees
    ) -> DineCity {
        let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        return DineCity(
            id: id,
            label: "\(cityName) · \(province) · 中国",
            cityName: cityName,
            province: province,
            country: "中国",
            center: center,
            span: span(for: center)
        )
    }

    private static func span(for center: CLLocationCoordinate2D) -> MKCoordinateSpan {
        let latitudeDelta = initialVisibleWidthKilometers / 111.32
        let longitudeDelta = initialVisibleWidthKilometers / (111.32 * max(cos(center.latitude * .pi / 180), 0.2))
        return MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
    }
}

struct Restaurant: Identifiable, Equatable, Decodable {
    let id: String
    let name: String
    let guide: GuideKind
    let city: String
    let cityName: String
    let province: String
    let country: String
    let district: String
    let level: DineLevel
    let avgPrice: Int?
    let michelinPrice: String
    let dishes: [String]
    let longitude: Double
    let latitude: Double
    let coverImageUrl: URL?
    let redirectUrl: URL?
    let sourceUrl: URL?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var costDisplay: String {
        if let avgPrice {
            return "¥\(avgPrice)"
        }

        return michelinPrice.isEmpty ? "—" : michelinPrice
    }

    var levelLabel: String {
        level.label(for: guide)
    }

    var cityLabel: String {
        "\(cityName) · \(province) · \(country)"
    }

    static func == (lhs: Restaurant, rhs: Restaurant) -> Bool {
        lhs.id == rhs.id
    }
}

extension Restaurant {
    var initials: String {
        let baseName = name.split(separator: "（").first ?? Substring(name)
        return String(baseName.prefix(2))
    }
}

enum DineRepository {
    static func loadRestaurants() -> [Restaurant] {
        load("michelin-restaurants") + load("black-pearl-restaurants")
    }

    private static func load(_ resourceName: String) -> [Restaurant] {
        guard let url = Bundle.main.url(forResource: resourceName, withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let restaurants = try? JSONDecoder().decode([Restaurant].self, from: data) else {
            return []
        }

        return restaurants
    }
}
