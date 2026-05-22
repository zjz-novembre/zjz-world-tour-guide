import MapKit
import SwiftUI

struct DineMapView: View {
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
        let span = city.span
        guard viewportSize.width > 0, viewportSize.height > 0 else {
            return MKCoordinateRegion(center: city.center, span: span)
        }

        let focusWidth = max(viewportSize.width - focusInsets.leading - focusInsets.trailing, 1)
        let focusHeight = max(viewportSize.height - focusInsets.top - focusInsets.bottom, 1)
        let focusX = focusInsets.leading + focusWidth / 2
        let focusY = focusInsets.top + focusHeight / 2
        let centerX = viewportSize.width / 2
        let centerY = viewportSize.height / 2
        let longitudeShift = -((focusX - centerX) / viewportSize.width) * span.longitudeDelta
        let latitudeShift = ((focusY - centerY) / viewportSize.height) * span.latitudeDelta
        let adjustedCenter = CLLocationCoordinate2D(
            latitude: city.center.latitude + latitudeShift,
            longitude: city.center.longitude + longitudeShift
        )
        return MKCoordinateRegion(center: adjustedCenter, span: span)
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
