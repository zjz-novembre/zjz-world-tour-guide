import CoreLocation
import Foundation
import SwiftUI

final class DineLocationStore: NSObject, ObservableObject {
    @Published private(set) var authorizationStatus: CLAuthorizationStatus
    @Published private(set) var latestLocation: CLLocation?
    @Published private(set) var latestHeading: CLHeading?

    private let manager = CLLocationManager()

    override init() {
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.headingFilter = 1
    }

    var coordinate: CLLocationCoordinate2D? {
        latestLocation?.coordinate
    }

    var headingDegrees: CLLocationDirection? {
        guard let heading = latestHeading else { return nil }
        let value = heading.trueHeading >= 0 ? heading.trueHeading : heading.magneticHeading
        return value >= 0 ? value : nil
    }

    var horizontalAccuracy: CLLocationAccuracy? {
        latestLocation?.horizontalAccuracy
    }

    var coordinateAnalysis: DineCoordinateAnalysis? {
        guard let coordinate else { return nil }
        return DineCoordinateAnalysis(
            wgs84: coordinate,
            gcj02: CoordinateTransforms.gcj02Coordinate(fromWgs84: coordinate),
            horizontalAccuracy: horizontalAccuracy,
            headingDegrees: headingDegrees
        )
    }

    func requestWhenInUse() {
        switch authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            startUpdates()
        default:
            break
        }
    }

    private func startUpdates() {
        manager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() {
            manager.startUpdatingHeading()
        }
    }
}

extension DineLocationStore: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        if authorizationStatus == .authorizedAlways || authorizationStatus == .authorizedWhenInUse {
            startUpdates()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        latestLocation = locations.last
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        latestHeading = newHeading
    }
}

struct DineCoordinateAnalysis {
    let wgs84: CLLocationCoordinate2D
    let gcj02: CLLocationCoordinate2D
    let horizontalAccuracy: CLLocationAccuracy?
    let headingDegrees: CLLocationDirection?
}
