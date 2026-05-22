import MapKit
import SwiftUI

struct DineMapView: View {
    private static let webCityScaleKilometers: CLLocationDistance = 14
    private static let webMobileMaxWidth: CGFloat = 760
    private static let webMobileCityScaleRatio: CGFloat = 0.92
    private static let kilometersPerLatitudeDegree: CLLocationDistance = 111.32

    let guide: GuideKind
    let city: DineCity
    let restaurants: [Restaurant]
    @Binding var selectedRestaurant: Restaurant?
    let viewportSize: CGSize
    let mapFocusInsets: EdgeInsets

    @State private var camera: MapCameraPosition = .region(DineMapView.region(for: .shanghai, viewportSize: .zero, focusInsets: EdgeInsets()))
    @State private var visibleSpan: MKCoordinateSpan = DineCity.shanghai.span

    var body: some View {
        MapReader { _ in
            Map(position: $camera, selection: selectionBinding) {
                ForEach(restaurants) { restaurant in
                    Annotation("", coordinate: restaurant.coordinate, anchor: .bottomLeading) {
                        RestaurantMarker(
                            restaurant: restaurant,
                            isSelected: selectedRestaurant?.id == restaurant.id,
                            markerScale: markerScale
                        )
                        .offset(x: -14.796875)
                        .zIndex(selectedRestaurant?.id == restaurant.id ? 1000 : 1)
                        .onTapGesture {
                            withAnimation(.snappy(duration: 0.18)) {
                                selectedRestaurant = selectedRestaurant?.id == restaurant.id ? nil : restaurant
                            }
                        }
                    }
                    .tag(restaurant.id)
                }

                UserAnnotation()
            }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
            .overlay {
                if guide == .michelin {
                    WhiteSmokeMapWash()
                } else {
                    BlackPearlMapWash()
                }
            }
            .ignoresSafeArea()
            .onMapCameraChange(frequency: .continuous) { context in
                visibleSpan = context.region.span
            }
        }
        .onChange(of: city) {
            withAnimation(.easeInOut(duration: 0.18)) {
                let nextRegion = Self.region(for: city, viewportSize: viewportSize, focusInsets: mapFocusInsets)
                visibleSpan = nextRegion.span
                camera = .region(nextRegion)
            }
        }
        .onAppear {
            let nextRegion = Self.region(for: city, viewportSize: viewportSize, focusInsets: mapFocusInsets)
            visibleSpan = nextRegion.span
            camera = .region(nextRegion)
        }
        .onChange(of: viewportSize) {
            let nextRegion = Self.region(for: city, viewportSize: viewportSize, focusInsets: mapFocusInsets)
            visibleSpan = nextRegion.span
            camera = .region(nextRegion)
        }
    }

    private var markerScale: CGFloat {
        let delta = max(visibleSpan.longitudeDelta, 0.012)
        let rawScale = 1 - log2(delta / DineCity.shanghai.span.longitudeDelta) * 0.12
        return min(max(rawScale, 0.78), 1.18)
    }

    private var selectionBinding: Binding<String?> {
        Binding(
            get: { selectedRestaurant?.id },
            set: { nextID in
                selectedRestaurant = restaurants.first { $0.id == nextID }
            }
        )
    }

    private static func region(for city: DineCity, viewportSize: CGSize, focusInsets: EdgeInsets) -> MKCoordinateRegion {
        guard viewportSize.width > 0, viewportSize.height > 0 else {
            return MKCoordinateRegion(center: city.center, span: city.span)
        }

        let focus = webMapFocus(viewportSize: viewportSize, focusInsets: focusInsets)
        let mapWidthKilometers = webCityScaleKilometers * CLLocationDistance(viewportSize.width / focus.scaleWidth)
        let mapHeightKilometers = mapWidthKilometers * CLLocationDistance(viewportSize.height / viewportSize.width)
        let span = span(for: city.center, widthKilometers: mapWidthKilometers, heightKilometers: mapHeightKilometers)
        let centerX = viewportSize.width / 2
        let centerY = viewportSize.height / 2
        let longitudeShift = -((focus.x - centerX) / viewportSize.width) * span.longitudeDelta
        let latitudeShift = ((focus.y - centerY) / viewportSize.height) * span.latitudeDelta
        let adjustedCenter = CLLocationCoordinate2D(
            latitude: city.center.latitude + latitudeShift,
            longitude: city.center.longitude + longitudeShift
        )
        return MKCoordinateRegion(center: adjustedCenter, span: span)
    }

    private struct WebMapFocus {
        let x: CGFloat
        let y: CGFloat
        let scaleWidth: CGFloat
    }

    private static func webMapFocus(viewportSize: CGSize, focusInsets: EdgeInsets) -> WebMapFocus {
        let visibleLeft = max(focusInsets.leading, 0)
        let visibleTop = max(focusInsets.top, 0)
        let visibleRight = max(viewportSize.width - focusInsets.trailing, visibleLeft)
        let visibleBottom = max(viewportSize.height - focusInsets.bottom, visibleTop)
        let visibleWidth = max(visibleRight - visibleLeft, 1)
        let visibleHeight = max(visibleBottom - visibleTop, 1)
        let isPortraitMobile = viewportSize.width <= webMobileMaxWidth
        let scaleWidth = visibleWidth * (isPortraitMobile ? webMobileCityScaleRatio : 1)

        return WebMapFocus(
            x: visibleLeft + visibleWidth / 2,
            y: visibleTop + visibleHeight / 2,
            scaleWidth: max(scaleWidth, 1)
        )
    }

    private static func span(
        for center: CLLocationCoordinate2D,
        widthKilometers: CLLocationDistance,
        heightKilometers: CLLocationDistance
    ) -> MKCoordinateSpan {
        let latitudeFactor = max(cos(center.latitude * .pi / 180), 0.2)
        let latitudeDelta = heightKilometers / kilometersPerLatitudeDegree
        let longitudeDelta = widthKilometers / (kilometersPerLatitudeDegree * latitudeFactor)

        return MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
    }
}

private struct WhiteSmokeMapWash: View {
    var body: some View {
        ZStack {
            Color.white
                .opacity(0.12)
                .blendMode(.screen)

            LinearGradient(
                colors: [
                    DineStyle.canvas.opacity(0.16),
                    .white.opacity(0.03),
                    DineStyle.canvas.opacity(0.10)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(0.08)
        }
        .compositingGroup()
        .allowsHitTesting(false)
    }
}

private struct BlackPearlMapWash: View {
    var body: some View {
        ZStack {
            Color(red: 0.039, green: 0.020, blue: 0.059)
                .opacity(0.58)
                .blendMode(.multiply)

            LinearGradient(
                colors: [
                    Color(red: 0.122, green: 0.094, blue: 0.153).opacity(0.46),
                    Color(red: 0.831, green: 0.686, blue: 0.216).opacity(0.08),
                    Color(red: 0.039, green: 0.020, blue: 0.059).opacity(0.36)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .compositingGroup()
        .allowsHitTesting(false)
    }
}
