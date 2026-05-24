import CoreLocation
import MAMapKit
import SwiftUI
import UIKit

struct DineMapView: View {
    private static let webCityScaleKilometers: CLLocationDistance = 14
    private static let webMobileMaxWidth: CGFloat = 760
    private static let webMobileCityScaleRatio: CGFloat = 0.92
    private static let kilometersPerLatitudeDegree: CLLocationDistance = 111.32

    let guide: GuideKind
    let city: DineCity
    let restaurants: [Restaurant]
    @Binding var selectedRestaurant: Restaurant?
    @Binding var selectedMarkerPresentation: RestaurantMarkerPresentation
    let viewportSize: CGSize
    let mapFocusInsets: EdgeInsets

    @State private var visibleLongitudeDelta: CLLocationDegrees = DineCity.shanghai.span.longitudeDelta
    @State private var isLiveMapReady = false

    var body: some View {
        ZStack {
            AMapDineMapRepresentable(
                guide: guide,
                city: city,
                restaurants: restaurants,
                selectedRestaurant: $selectedRestaurant,
                selectedMarkerPresentation: $selectedMarkerPresentation,
                viewportSize: viewportSize,
                mapFocusInsets: mapFocusInsets,
                visibleLongitudeDelta: $visibleLongitudeDelta,
                autoSmallTagsEnabled: autoSmallTagsEnabled,
                markerScale: markerScale,
                onMapReady: {
                    withAnimation(.easeOut(duration: 0.18)) {
                        isLiveMapReady = true
                    }
                }
            )
            .ignoresSafeArea()

            if !isLiveMapReady {
                ColdStartMapPlaceholder(
                    guide: guide,
                    city: city,
                    restaurants: restaurants,
                    viewportSize: viewportSize,
                    mapFocusInsets: mapFocusInsets
                )
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .transition(.opacity)
                .zIndex(1000)
            }
        }
    }

    private var autoSmallTagsEnabled: Bool {
        if restaurants.count <= 8 { return true }
        return visibleLongitudeDelta < city.span.longitudeDelta * 0.29
    }

    private var markerScale: CGFloat {
        let delta = max(visibleLongitudeDelta, 0.012)
        let rawScale = 1 - log2(delta / DineCity.shanghai.span.longitudeDelta) * 0.12
        return min(max(rawScale, 0.78), 1.18)
    }

    fileprivate static func region(for city: DineCity, viewportSize: CGSize, focusInsets: EdgeInsets) -> MACoordinateRegion {
        guard viewportSize.width > 0, viewportSize.height > 0 else {
            return MACoordinateRegion(
                center: city.center,
                span: MACoordinateSpan(
                    latitudeDelta: city.span.latitudeDelta,
                    longitudeDelta: city.span.longitudeDelta
                )
            )
        }

        let mapCenter = city.center
        let focus = webMapFocus(viewportSize: viewportSize, focusInsets: focusInsets)
        let mapWidthKilometers = webCityScaleKilometers * CLLocationDistance(viewportSize.width / focus.scaleWidth)
        let mapHeightKilometers = mapWidthKilometers * CLLocationDistance(viewportSize.height / viewportSize.width)
        let span = span(for: mapCenter, widthKilometers: mapWidthKilometers, heightKilometers: mapHeightKilometers)
        let centerX = viewportSize.width / 2
        let centerY = viewportSize.height / 2
        let longitudeShift = -((focus.x - centerX) / viewportSize.width) * span.longitudeDelta
        let latitudeShift = ((focus.y - centerY) / viewportSize.height) * span.latitudeDelta
        let adjustedCenter = CLLocationCoordinate2D(
            latitude: mapCenter.latitude + latitudeShift,
            longitude: mapCenter.longitude + longitudeShift
        )
        return MACoordinateRegion(center: adjustedCenter, span: span)
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
    ) -> MACoordinateSpan {
        let latitudeFactor = max(cos(center.latitude * .pi / 180), 0.2)
        let latitudeDelta = heightKilometers / kilometersPerLatitudeDegree
        let longitudeDelta = widthKilometers / (kilometersPerLatitudeDegree * latitudeFactor)

        return MACoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
    }
}

private struct ColdStartMapPlaceholder: View {
    let guide: GuideKind
    let city: DineCity
    let restaurants: [Restaurant]
    let viewportSize: CGSize
    let mapFocusInsets: EdgeInsets

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let region = DineMapView.region(
                for: city,
                viewportSize: resolvedViewportSize(proxySize: size),
                focusInsets: mapFocusInsets
            )

            ZStack {
                Color(red: 0.961, green: 0.961, blue: 0.949)

                ColdStartMapTexture()

                ForEach(Array(restaurants.prefix(160))) { restaurant in
                    if let point = point(for: restaurant.coordinate, in: region, size: size) {
                        ColdStartPin(restaurant: restaurant)
                            .position(point)
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func resolvedViewportSize(proxySize: CGSize) -> CGSize {
        guard viewportSize.width > 1, viewportSize.height > 1 else { return proxySize }
        return viewportSize
    }

    private func point(
        for coordinate: CLLocationCoordinate2D,
        in region: MACoordinateRegion,
        size: CGSize
    ) -> CGPoint? {
        let x = 0.5 + (coordinate.longitude - region.center.longitude) / max(region.span.longitudeDelta, 0.0001)
        let y = 0.5 - (coordinate.latitude - region.center.latitude) / max(region.span.latitudeDelta, 0.0001)
        guard x > -0.12, x < 1.12, y > -0.12, y < 1.12 else { return nil }
        return CGPoint(x: x * size.width, y: y * size.height)
    }
}

private struct ColdStartMapTexture: View {
    var body: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                let roadColors = [
                    Color.white.opacity(0.86),
                    Color(red: 0.86, green: 0.87, blue: 0.86).opacity(0.46)
                ]
                let strokes: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
                    (0.02, 0.18, 0.92, 0.06),
                    (0.08, 0.42, 0.98, 0.26),
                    (-0.10, 0.72, 0.82, 0.54),
                    (0.18, -0.08, 0.24, 1.10),
                    (0.50, -0.10, 0.58, 1.08),
                    (0.76, -0.04, 0.70, 1.08),
                    (-0.04, 0.34, 1.04, 0.37),
                    (0.14, 0.82, 1.02, 0.78)
                ]
                for (index, stroke) in strokes.enumerated() {
                    var path = Path()
                    path.move(to: CGPoint(x: stroke.0 * size.width, y: stroke.1 * size.height))
                    path.addCurve(
                        to: CGPoint(x: stroke.2 * size.width, y: stroke.3 * size.height),
                        control1: CGPoint(x: (stroke.0 + 0.18) * size.width, y: (stroke.1 + 0.08) * size.height),
                        control2: CGPoint(x: (stroke.2 - 0.22) * size.width, y: (stroke.3 - 0.06) * size.height)
                    )
                    context.stroke(
                        path,
                        with: .color(roadColors[index % roadColors.count]),
                        lineWidth: index < 3 ? 7 : 5
                    )
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}

private struct ColdStartPin: View {
    let restaurant: Restaurant

    var body: some View {
        ZStack {
            PinShape()
                .fill(pinColor)
                .strokeBorder(strokeColor, lineWidth: 1)
                .frame(width: 21, height: 21)
                .rotationEffect(.degrees(-45))
                .shadow(color: .black.opacity(0.14), radius: 7, y: 3)

            ColdStartGlyph(restaurant: restaurant)
                .frame(width: 11.6, height: 11.6)
                .offset(iconOffset)
        }
        .frame(width: 26, height: 26)
    }

    private var pinColor: Color {
        switch restaurant.guide {
        case .blackPearl:
            return DineStyle.blackPearl
        case .michelin:
            switch restaurant.level {
            case .bib:
                return DineStyle.bibGold
            case .selected:
                return DineStyle.muted
            default:
                return DineStyle.michelinRed
            }
        }
    }

    private var strokeColor: Color {
        restaurant.guide == .blackPearl ? DineStyle.pearlGold : .white
    }

    private var iconOffset: CGSize {
        switch (restaurant.guide, restaurant.level) {
        case (.michelin, .bib):
            return CGSize(width: 0, height: -1)
        case (.michelin, .selected):
            return CGSize(width: 0.5, height: 1)
        default:
            return .zero
        }
    }
}

private struct ColdStartGlyph: View {
    let restaurant: Restaurant

    var body: some View {
        switch restaurant.guide {
        case .blackPearl:
            BundledPNG(name: "black-pearl-diamond-official-52")
        case .michelin:
            switch restaurant.level {
            case .bib:
                SVGVectorIcon(name: "michelin-bib-gourmand-white")
            case .selected:
                SVGVectorIcon(name: "restaurant-selected-white")
            default:
                SVGVectorIcon(name: "michelin-star-white")
            }
        }
    }
}

private struct AMapDineMapRepresentable: UIViewRepresentable {
    let guide: GuideKind
    let city: DineCity
    let restaurants: [Restaurant]
    @Binding var selectedRestaurant: Restaurant?
    @Binding var selectedMarkerPresentation: RestaurantMarkerPresentation
    let viewportSize: CGSize
    let mapFocusInsets: EdgeInsets
    @Binding var visibleLongitudeDelta: CLLocationDegrees
    let autoSmallTagsEnabled: Bool
    let markerScale: CGFloat
    let onMapReady: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> MAMapView {
        let mapView = DineAMapView(frame: .zero)
        mapView.delegate = context.coordinator
        mapView.mapType = .standard
        mapView.isShowsLabels = true
        mapView.isShowsBuildings = false
        mapView.showsCompass = false
        mapView.showsScale = false
        mapView.touchPOIEnabled = false
        mapView.isRotateEnabled = false
        mapView.isRotateCameraEnabled = false
        mapView.desiredAccuracy = kCLLocationAccuracyBest
        mapView.distanceFilter = kCLDistanceFilterNone
        mapView.headingFilter = 1
        mapView.showsUserLocation = true
        let initialRegion = DineMapView.region(for: city, viewportSize: .zero, focusInsets: EdgeInsets())
        visibleLongitudeDelta = initialRegion.span.longitudeDelta
        mapView.setRegion(initialRegion, animated: false)
        mapView.setUserTrackingMode(.none, animated: false)
        applyCustomStyle(to: mapView)
        mapView.onLayout = { [weak coordinator = context.coordinator] mapView in
            coordinator?.syncCameraAfterLayout(on: mapView)
        }
        context.coordinator.configure(mapView)
        return mapView
    }

    func updateUIView(_ mapView: MAMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.syncCamera(on: mapView)
        context.coordinator.syncAnnotations(on: mapView)
        context.coordinator.syncSelection(on: mapView)
    }

    private func applyCustomStyle(to mapView: MAMapView) {
        let options = MAMapCustomStyleOptions()
        var hasCustomStyle = false

        if let styleID = Bundle.main.object(forInfoDictionaryKey: "AMapCustomStyleID") as? String,
           !styleID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            options.styleId = styleID
            hasCustomStyle = true
        }

        if let styleURL = Bundle.main.url(forResource: "amap-white-smoke", withExtension: "data"),
           let styleData = try? Data(contentsOf: styleURL) {
            options.styleData = styleData
            hasCustomStyle = true
        }

        if let extraURL = Bundle.main.url(forResource: "amap-white-smoke-extra", withExtension: "data"),
           let extraData = try? Data(contentsOf: extraURL) {
            options.styleExtraData = extraData
            hasCustomStyle = true
        }

        guard hasCustomStyle else { return }
        mapView.setCustomMapStyleOptions(options)
        mapView.customMapStyleEnabled = true
    }

    final class Coordinator: NSObject, MAMapViewDelegate {
        var parent: AMapDineMapRepresentable
        private var annotationsByID: [String: DineRestaurantAnnotation] = [:]
        private var cameraSignature: CameraSignature?
        private var didApplyLoadedCamera = false
        private var didFinishLoadingMap = false
        private var didNotifyMapReady = false
        private var userHasMovedCamera = false
        private var lastAnnotationTapID: String?
        private var lastAnnotationTapTime: CFTimeInterval = 0

        init(parent: AMapDineMapRepresentable) {
            self.parent = parent
        }

        func configure(_ mapView: MAMapView) {
            syncCamera(on: mapView, force: true, animated: false)
            syncAnnotations(on: mapView)
            syncSelection(on: mapView)
        }

        func syncCameraAfterLayout(on mapView: MAMapView) {
            guard !userHasMovedCamera else { return }
            syncCamera(on: mapView, force: true, animated: false)
            notifyMapReadyIfPossible(on: mapView)
        }

        func syncCamera(on mapView: MAMapView, force: Bool = false, animated: Bool? = nil) {
            guard parent.viewportSize.width > 1,
                  parent.viewportSize.height > 1,
                  mapView.bounds.width > 1,
                  mapView.bounds.height > 1 else {
                return
            }

            let signature = CameraSignature(
                cityID: parent.city.id,
                width: parent.viewportSize.width,
                height: parent.viewportSize.height,
                mapWidth: mapView.bounds.width,
                mapHeight: mapView.bounds.height,
                top: parent.mapFocusInsets.top,
                leading: parent.mapFocusInsets.leading,
                bottom: parent.mapFocusInsets.bottom,
                trailing: parent.mapFocusInsets.trailing
            )
            if signature.cityID != cameraSignature?.cityID {
                didApplyLoadedCamera = false
                userHasMovedCamera = false
            }
            guard force || signature != cameraSignature else { return }
            let shouldAnimate = animated ?? (cameraSignature != nil)
            cameraSignature = signature
            let nextRegion = DineMapView.region(
                for: parent.city,
                viewportSize: parent.viewportSize,
                focusInsets: parent.mapFocusInsets
            )
            parent.visibleLongitudeDelta = nextRegion.span.longitudeDelta
            mapView.setUserTrackingMode(.none, animated: false)
            mapView.setRegion(nextRegion, animated: shouldAnimate)
            notifyMapReadyIfPossible(on: mapView)
        }

        func syncAnnotations(on mapView: MAMapView) {
            let nextIDs = Set(parent.restaurants.map(\.id))
            let removedAnnotations = annotationsByID
                .filter { !nextIDs.contains($0.key) }
                .map(\.value)
            if !removedAnnotations.isEmpty {
                mapView.removeAnnotations(removedAnnotations)
                for annotation in removedAnnotations {
                    annotationsByID.removeValue(forKey: annotation.restaurant.id)
                }
            }

            var addedAnnotations: [DineRestaurantAnnotation] = []
            for restaurant in parent.restaurants {
                if let annotation = annotationsByID[restaurant.id] {
                    annotation.update(restaurant: restaurant)
                    if let view = mapView.view(for: annotation) as? DineRestaurantAnnotationView {
                        let presentation = markerPresentation(for: restaurant)
                        view.update(
                            restaurant: restaurant,
                            presentation: presentation,
                            isFocused: parent.selectedRestaurant?.id == restaurant.id,
                            markerScale: parent.markerScale
                        )
                    }
                } else {
                    let annotation = DineRestaurantAnnotation(restaurant: restaurant)
                    annotationsByID[restaurant.id] = annotation
                    addedAnnotations.append(annotation)
                }
            }

            if !addedAnnotations.isEmpty {
                mapView.addAnnotations(addedAnnotations)
            }
        }

        func syncSelection(on mapView: MAMapView) {
            for annotation in annotationsByID.values {
                guard let view = mapView.view(for: annotation) as? DineRestaurantAnnotationView else { continue }
                let isSelected = parent.selectedRestaurant?.id == annotation.restaurant.id
                let presentation = markerPresentation(for: annotation.restaurant)
                view.update(
                    restaurant: annotation.restaurant,
                    presentation: presentation,
                    isFocused: isSelected,
                    markerScale: parent.markerScale
                )
                view.layer.zPosition = zPosition(for: annotation.restaurant, presentation: presentation, isFocused: isSelected)
                if !isSelected {
                    mapView.deselectAnnotation(annotation, animated: false)
                }
            }
        }

        func mapViewDidFinishLoadingMap(_ mapView: MAMapView) {
            didFinishLoadingMap = true
            if !didApplyLoadedCamera, !userHasMovedCamera {
                didApplyLoadedCamera = true
                syncCamera(on: mapView, force: true, animated: false)
            }
            notifyMapReadyIfPossible(on: mapView)
        }

        func mapView(_ mapView: MAMapView!, regionDidChangeAnimated animated: Bool) {
            parent.visibleLongitudeDelta = mapView.region.span.longitudeDelta
        }

        func mapView(_ mapView: MAMapView!, regionDidChangeAnimated animated: Bool, wasUserAction: Bool) {
            parent.visibleLongitudeDelta = mapView.region.span.longitudeDelta
            if wasUserAction {
                userHasMovedCamera = true
            }
        }

        func mapView(_ mapView: MAMapView!, viewFor annotation: MAAnnotation!) -> MAAnnotationView! {
            guard let restaurantAnnotation = annotation as? DineRestaurantAnnotation else { return nil }
            let identifier = restaurantAnnotation.restaurant.guide.rawValue
            let view: DineRestaurantAnnotationView
            if let reusableView = mapView.dequeueReusableAnnotationView(withIdentifier: identifier) as? DineRestaurantAnnotationView {
                view = reusableView
            } else {
                view = DineRestaurantAnnotationView(annotation: annotation, reuseIdentifier: identifier)!
            }
            view.annotation = annotation
            let presentation = markerPresentation(for: restaurantAnnotation.restaurant)
            view.update(
                restaurant: restaurantAnnotation.restaurant,
                presentation: presentation,
                isFocused: parent.selectedRestaurant?.id == restaurantAnnotation.restaurant.id,
                markerScale: parent.markerScale
            )
            return view
        }

        func mapView(_ mapView: MAMapView!, didSelect view: MAAnnotationView!) {
            guard let annotation = view.annotation as? DineRestaurantAnnotation else { return }
            handleAnnotationTap(annotation.restaurant, on: mapView)
        }

        func mapView(_ mapView: MAMapView!, didAnnotationViewTapped view: MAAnnotationView!) {
            guard let annotation = view.annotation as? DineRestaurantAnnotation else { return }
            handleAnnotationTap(annotation.restaurant, on: mapView)
        }

        private func handleAnnotationTap(_ restaurant: Restaurant, on mapView: MAMapView) {
            let now = CACurrentMediaTime()
            if lastAnnotationTapID == restaurant.id, now - lastAnnotationTapTime < 0.08 {
                return
            }
            lastAnnotationTapID = restaurant.id
            lastAnnotationTapTime = now

            withAnimation(.snappy(duration: 0.18)) {
                if parent.selectedRestaurant?.id == restaurant.id,
                   parent.selectedMarkerPresentation == .detailTag {
                    parent.selectedRestaurant = nil
                    parent.selectedMarkerPresentation = .pinOnly
                } else {
                    parent.selectedRestaurant = restaurant
                    parent.selectedMarkerPresentation = .detailTag
                }
            }
            syncSelection(on: mapView)
        }

        func mapView(_ mapView: MAMapView!, didSingleTappedAt coordinate: CLLocationCoordinate2D) {
            guard parent.selectedRestaurant != nil else { return }
            withAnimation(.snappy(duration: 0.18)) {
                parent.selectedRestaurant = nil
                parent.selectedMarkerPresentation = .pinOnly
            }
            syncSelection(on: mapView)
        }

        private func markerPresentation(for restaurant: Restaurant) -> RestaurantMarkerPresentation {
            if parent.selectedRestaurant?.id == restaurant.id {
                return parent.selectedMarkerPresentation
            }

            return parent.autoSmallTagsEnabled ? .smallTag : .pinOnly
        }

        private func notifyMapReadyIfPossible(on mapView: MAMapView) {
            guard didFinishLoadingMap,
                  !didNotifyMapReady,
                  cameraSignature != nil,
                  mapView.bounds.width > 1,
                  mapView.bounds.height > 1 else {
                return
            }
            didNotifyMapReady = true
            DispatchQueue.main.async {
                self.parent.onMapReady()
            }
        }

        private func zPosition(
            for restaurant: Restaurant,
            presentation: RestaurantMarkerPresentation,
            isFocused: Bool
        ) -> CGFloat {
            if isFocused {
                switch presentation {
                case .detailTag:
                    return 1000
                case .smallTag:
                    return 900
                case .pinOnly:
                    return 800
                }
            }

            if presentation == .smallTag { return 50 }
            return CGFloat(5 - restaurant.level.sortRank)
        }
    }
}

private final class DineAMapView: MAMapView {
    var onLayout: ((MAMapView) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?(self)
    }
}

private struct CameraSignature: Equatable {
    let cityID: String
    let width: CGFloat
    let height: CGFloat
    let mapWidth: CGFloat
    let mapHeight: CGFloat
    let top: CGFloat
    let leading: CGFloat
    let bottom: CGFloat
    let trailing: CGFloat
}

private final class DineRestaurantAnnotation: NSObject, MAAnnotation {
    @objc dynamic var coordinate: CLLocationCoordinate2D
    var restaurant: Restaurant
    @objc dynamic var title: String?
    @objc dynamic var subtitle: String?

    init(restaurant: Restaurant) {
        self.restaurant = restaurant
        coordinate = restaurant.coordinate
        title = restaurant.name
        subtitle = "\(restaurant.costDisplay) · \(restaurant.levelLabel)"
        super.init()
    }

    func update(restaurant: Restaurant) {
        self.restaurant = restaurant
        coordinate = restaurant.coordinate
        title = restaurant.name
        subtitle = "\(restaurant.costDisplay) · \(restaurant.levelLabel)"
    }
}

private final class DineRestaurantAnnotationView: MAAnnotationView {
    private let hostingController = UIHostingController(
        rootView: AMapRestaurantMarkerHost(
            restaurant: nil,
            presentation: .pinOnly,
            isFocused: false,
            markerScale: 1
        )
    )

    override init!(annotation: MAAnnotation!, reuseIdentifier: String!) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        canShowCallout = false
        backgroundColor = .clear
        hostingController.view.backgroundColor = .clear
        hostingController.view.isUserInteractionEnabled = false
        addSubview(hostingController.view)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func update(
        restaurant: Restaurant,
        presentation: RestaurantMarkerPresentation,
        isFocused: Bool,
        markerScale: CGFloat
    ) {
        let layout = AMapMarkerLayout.layout(for: restaurant, presentation: presentation)
        bounds = CGRect(origin: .zero, size: layout.size)
        centerOffset = layout.centerOffset
        hostingController.view.frame = bounds
        hostingController.rootView = AMapRestaurantMarkerHost(
            restaurant: restaurant,
            presentation: presentation,
            isFocused: isFocused,
            markerScale: markerScale
        )
        layer.zPosition = zPosition(for: restaurant, presentation: presentation, isFocused: isFocused)
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        hostingController.rootView = AMapRestaurantMarkerHost(
            restaurant: nil,
            presentation: .pinOnly,
            isFocused: false,
            markerScale: 1
        )
    }

    private func zPosition(
        for restaurant: Restaurant,
        presentation: RestaurantMarkerPresentation,
        isFocused: Bool
    ) -> CGFloat {
        if isFocused {
            switch presentation {
            case .detailTag:
                return 1000
            case .smallTag:
                return 900
            case .pinOnly:
                return 800
            }
        }

        if presentation == .smallTag { return 50 }
        return CGFloat(5 - restaurant.level.sortRank)
    }
}

private struct AMapRestaurantMarkerHost: View {
    let restaurant: Restaurant?
    let presentation: RestaurantMarkerPresentation
    let isFocused: Bool
    let markerScale: CGFloat

    var body: some View {
        let layout = AMapMarkerLayout.layout(for: restaurant, presentation: presentation)
        ZStack(alignment: .topLeading) {
            if let restaurant {
                RestaurantMarker(
                    restaurant: restaurant,
                    presentation: presentation,
                    isFocused: isFocused,
                    markerScale: markerScale
                )
            }
        }
        .frame(width: layout.size.width, height: layout.size.height)
    }
}

private struct AMapMarkerLayout {
    let size: CGSize
    let pinCenter: CGPoint
    let centerOffset: CGPoint

    static func layout(for restaurant: Restaurant?, presentation: RestaurantMarkerPresentation) -> AMapMarkerLayout {
        let markerLayout = RestaurantMarkerLayout.layout(for: restaurant, presentation: presentation)
        let size = markerLayout.size
        let pinCenter = markerLayout.pinCenter
        return AMapMarkerLayout(
            size: size,
            pinCenter: pinCenter,
            centerOffset: centerOffset(size: size, pinCenter: pinCenter)
        )
    }

    private static func centerOffset(size: CGSize, pinCenter: CGPoint) -> CGPoint {
        let pinBottom = CGPoint(x: pinCenter.x, y: pinCenter.y + 29.59375 / 2)
        return CGPoint(
            x: size.width / 2 - pinBottom.x,
            y: size.height / 2 - pinBottom.y
        )
    }
}
