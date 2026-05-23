import CoreLocation
import Foundation

enum CoordinateTransforms {
    private static let earthAxis = 6_378_245.0
    private static let eccentricity = 0.006693421622965943
    private static let mainlandCityIDs: Set<String> = [
        "beijing",
        "guangzhou",
        "chengdu",
        "fuzhou",
        "xiamen",
        "quanzhou",
        "ningde",
        "shanghai",
        "nanjing",
        "suzhou",
        "yangzhou",
        "changzhou",
        "hangzhou",
        "wenzhou",
        "taizhou",
    ]

    static func mapKitCoordinate(
        longitude: CLLocationDegrees,
        latitude: CLLocationDegrees,
        cityID: String
    ) -> CLLocationCoordinate2D {
        let coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        guard mainlandCityIDs.contains(cityID), isInsideChina(coordinate) else {
            return coordinate
        }

        return gcj02ToWgs84(coordinate)
    }

    static func gcj02Coordinate(fromWgs84 coordinate: CLLocationCoordinate2D) -> CLLocationCoordinate2D {
        guard isInsideChina(coordinate) else { return coordinate }

        var deltaLatitude = transformLatitude(
            x: coordinate.longitude - 105.0,
            y: coordinate.latitude - 35.0
        )
        var deltaLongitude = transformLongitude(
            x: coordinate.longitude - 105.0,
            y: coordinate.latitude - 35.0
        )
        let radianLatitude = coordinate.latitude / 180.0 * .pi
        var magic = sin(radianLatitude)
        magic = 1 - eccentricity * magic * magic
        let sqrtMagic = sqrt(magic)
        deltaLatitude = (deltaLatitude * 180.0) /
            ((earthAxis * (1 - eccentricity)) / (magic * sqrtMagic) * .pi)
        deltaLongitude = (deltaLongitude * 180.0) /
            (earthAxis / sqrtMagic * cos(radianLatitude) * .pi)

        return CLLocationCoordinate2D(
            latitude: coordinate.latitude + deltaLatitude,
            longitude: coordinate.longitude + deltaLongitude
        )
    }

    private static func gcj02ToWgs84(_ coordinate: CLLocationCoordinate2D) -> CLLocationCoordinate2D {
        var estimate = coordinate

        for _ in 0..<6 {
            let converted = gcj02Coordinate(fromWgs84: estimate)
            estimate = CLLocationCoordinate2D(
                latitude: estimate.latitude - (converted.latitude - coordinate.latitude),
                longitude: estimate.longitude - (converted.longitude - coordinate.longitude)
            )
        }

        return estimate
    }

    private static func isInsideChina(_ coordinate: CLLocationCoordinate2D) -> Bool {
        coordinate.longitude >= 72.004 &&
            coordinate.longitude <= 137.8347 &&
            coordinate.latitude >= 0.8293 &&
            coordinate.latitude <= 55.8271
    }

    private static func transformLatitude(x: Double, y: Double) -> Double {
        var result = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
        result += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
        result += (20.0 * sin(y * .pi) + 40.0 * sin(y / 3.0 * .pi)) * 2.0 / 3.0
        result += (160.0 * sin(y / 12.0 * .pi) + 320.0 * sin(y * .pi / 30.0)) * 2.0 / 3.0
        return result
    }

    private static func transformLongitude(x: Double, y: Double) -> Double {
        var result = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
        result += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
        result += (20.0 * sin(x * .pi) + 40.0 * sin(x / 3.0 * .pi)) * 2.0 / 3.0
        result += (150.0 * sin(x / 12.0 * .pi) + 300.0 * sin(x / 30.0 * .pi)) * 2.0 / 3.0
        return result
    }
}
