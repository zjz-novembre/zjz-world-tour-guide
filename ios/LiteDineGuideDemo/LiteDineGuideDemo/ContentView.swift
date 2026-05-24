import SwiftUI
import UIKit

struct ContentView: View {
    @State private var activeGuide: GuideKind = .michelin
    @State private var activeCity: DineCity = .shanghai
    @State private var activeDropdown: FilterDropdownKind?
    @State private var selectedCost: DineCostBand = .all
    @State private var selectedLevels: Set<DineLevel> = []
    @State private var restaurants = DineRepository.loadRestaurants()
    @State private var selectedRestaurant: Restaurant?
    @State private var selectedMarkerPresentation: RestaurantMarkerPresentation = .pinOnly
    @State private var isListCollapsed = false

    private var filteredRestaurants: [Restaurant] {
        restaurants
            .filter { $0.guide == activeGuide && $0.city == activeCity.id }
            .filter { selectedCost.includes($0.avgPrice) }
            .filter { selectedLevels.isEmpty || selectedLevels.contains($0.level) }
            .sorted {
                if $0.level.sortRank != $1.level.sortRank {
                    return $0.level.sortRank < $1.level.sortRank
                }

                let leftCost = $0.avgPrice ?? Int.max
                let rightCost = $1.avgPrice ?? Int.max
                if leftCost != rightCost {
                    return leftCost < rightCost
                }

                return $0.name.localizedStandardCompare($1.name) == .orderedAscending
            }
    }

    var body: some View {
        GeometryReader { proxy in
            let expandedSheetHeight = max(proxy.size.height * 0.43, DineMetric.minimumSheetHeight)
            let sheetHeight = isListCollapsed ? DineMetric.collapsedSheetHeight : expandedSheetHeight

            DineMapView(
                guide: activeGuide,
                city: activeCity,
                restaurants: filteredRestaurants,
                selectedRestaurant: $selectedRestaurant,
                selectedMarkerPresentation: $selectedMarkerPresentation,
                viewportSize: proxy.size,
                mapFocusInsets: EdgeInsets(
                    top: DineMetric.topInset + DineMetric.headerHeight + DineMetric.chromeGap + DineMetric.filterHeight,
                    leading: 0,
                    bottom: sheetHeight + DineMetric.edge,
                    trailing: 0
                )
            )

            VStack(spacing: 0) {
                topChrome
                    .padding(.horizontal, DineMetric.edge)
                    .padding(.top, DineMetric.topInset)
                    .zIndex(2)

                Spacer(minLength: 0)

                restaurantSheet
                    .frame(height: sheetHeight)
                    .padding(.horizontal, DineMetric.edge)
                    .padding(.bottom, DineMetric.edge)
                    .zIndex(1)
            }

            dropdownLayer(in: proxy.size)
                .zIndex(3)
        }
        .background(activeGuide.canvas)
        .onChange(of: activeGuide) {
            clearMapSelection()
            selectedLevels = []
            activeDropdown = nil
        }
    }

    private var topChrome: some View {
        VStack(spacing: DineMetric.chromeGap) {
            header
            filterBar
        }
    }

    private var header: some View {
        HStack(spacing: DineMetric.filterGap) {
            HStack {
                Text(activeGuide.title)
                    .font(DineFont.bold(23.2))
                    .foregroundStyle(activeGuide.brandColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity)

            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: DineMetric.headerHeight)

            HStack {
                Spacer(minLength: 0)
                GuideSwitchButton(activeGuide: activeGuide) {
                    withAnimation(.snappy(duration: 0.18)) {
                        activeGuide = activeGuide == .michelin ? .blackPearl : .michelin
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .frame(height: DineMetric.headerHeight)
    }

    private var filterBar: some View {
        HStack(spacing: DineMetric.filterGap) {
            FilterButton(
                label: "城市",
                value: activeCity.label,
                icon: .mapPin,
                guide: activeGuide,
                isOpen: activeDropdown == .city
            ) {
                toggleDropdown(.city)
            }
            FilterButton(
                label: "人均",
                value: selectedCost.label,
                icon: .tag,
                guide: activeGuide,
                isOpen: activeDropdown == .cost
            ) {
                toggleDropdown(.cost)
            }
            FilterButton(
                label: activeGuide == .michelin ? "星级" : "钻级",
                value: levelDisplayValue,
                icon: activeGuide == .michelin ? .michelinGuide : .blackPearlDiamond,
                guide: activeGuide,
                isOpen: activeDropdown == .level
            ) {
                toggleDropdown(.level)
            }
        }
    }

    private var levelDisplayValue: String {
        let selected = levelOptions.filter { selectedLevels.contains($0) }
        guard let first = selected.first else { return "全榜" }
        if selected.count <= 2 {
            return selected.map { $0.label(for: activeGuide) }.joined(separator: "、")
        }
        return "\(first.label(for: activeGuide)) +\(selected.count - 1)"
    }

    private var levelOptions: [DineLevel] {
        switch activeGuide {
        case .michelin:
            return [.threeStars, .twoStars, .oneStar, .bib, .selected]
        case .blackPearl:
            return [.threeStars, .twoStars, .oneStar]
        }
    }

    @ViewBuilder
    private func dropdownLayer(in size: CGSize) -> some View {
        if let activeDropdown {
            let chipWidth = (size.width - DineMetric.edge * 2 - DineMetric.filterGap * 2) / 3
            let x = DineMetric.edge + CGFloat(activeDropdown.index) * (chipWidth + DineMetric.filterGap)
            let y = DineMetric.topInset + DineMetric.headerHeight + DineMetric.chromeGap + DineMetric.filterHeight + DineMetric.dropdownGap

            ZStack(alignment: .topLeading) {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture {
                        closeDropdown()
                    }

                FilterDropdownPanel(guide: activeGuide) {
                    dropdownContent(for: activeDropdown)
                }
                .frame(width: chipWidth)
                .offset(x: x, y: y)
            }
        }
    }

    @ViewBuilder
    private func dropdownContent(for dropdown: FilterDropdownKind) -> some View {
        switch dropdown {
        case .city:
            DropdownOptions {
                ForEach(DineCity.all) { city in
                    DropdownOption(label: city.label, guide: activeGuide, isSelected: city.id == activeCity.id) {
                        activeCity = city
                        clearMapSelection()
                        closeDropdown()
                    }
                }
            }
        case .cost:
            DropdownOptions {
                ForEach(DineCostBand.allCases) { cost in
                    DropdownOption(label: cost.label, guide: activeGuide, isSelected: cost == selectedCost) {
                        selectedCost = cost
                        clearMapSelection()
                        closeDropdown()
                    }
                }
            }
        case .level:
            DropdownOptions {
                DropdownOption(label: "全榜", guide: activeGuide, isSelected: selectedLevels.isEmpty) {
                    selectedLevels = []
                    clearMapSelection()
                }
                ForEach(levelOptions, id: \.self) { level in
                    DropdownOption(
                        label: level.label(for: activeGuide),
                        guide: activeGuide,
                        isSelected: selectedLevels.contains(level)
                    ) {
                        if selectedLevels.contains(level) {
                            selectedLevels.remove(level)
                        } else {
                            selectedLevels.insert(level)
                        }
                        clearMapSelection()
                    }
                }
            }
        }
    }

    private func toggleDropdown(_ dropdown: FilterDropdownKind) {
        withAnimation(.snappy(duration: 0.16)) {
            activeDropdown = activeDropdown == dropdown ? nil : dropdown
        }
    }

    private func closeDropdown() {
        withAnimation(.snappy(duration: 0.16)) {
            activeDropdown = nil
        }
    }

    private var restaurantSheet: some View {
        ZStack(alignment: .topTrailing) {
            if !isListCollapsed {
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(filteredRestaurants.enumerated()), id: \.element.id) { index, restaurant in
                            RestaurantRow(
                                restaurant: restaurant,
                                isSelected: selectedRestaurant?.id == restaurant.id,
                                guide: activeGuide
                            )
                            .overlay(alignment: .bottom) {
                                if index < filteredRestaurants.count - 1 {
                                    Rectangle()
                                        .fill(activeGuide.rowDivider)
                                        .frame(height: 0.5)
                                }
                            }
                            .onTapGesture {
                                withAnimation(.snappy(duration: 0.18)) {
                                    if selectedRestaurant?.id == restaurant.id,
                                       selectedMarkerPresentation == .smallTag {
                                        clearMapSelection()
                                    } else {
                                        selectedRestaurant = restaurant
                                        selectedMarkerPresentation = .smallTag
                                    }
                                }
                            }
                        }
                    }
                }
                .transaction { transaction in
                    transaction.animation = nil
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }

            Button {
                withAnimation(.snappy(duration: 0.18)) {
                    isListCollapsed.toggle()
                }
            } label: {
                WebIcon(kind: .chevronDown, tint: activeGuide.secondaryText)
                    .frame(width: 16, height: 16)
                    .rotationEffect(.degrees(isListCollapsed ? 180 : 0))
                    .frame(width: 32, height: 32)
                    .background(activeGuide.panelSurface, in: Circle())
                    .overlay {
                        Circle().stroke(activeGuide.panelStroke, lineWidth: 0.8)
                    }
            }
            .buttonStyle(.plain)
            .padding(8)
            .accessibilityLabel(isListCollapsed ? "展开列表" : "收起列表")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(activeGuide.panelSurface, in: RoundedRectangle(cornerRadius: DineMetric.panelRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: DineMetric.panelRadius, style: .continuous)
                .stroke(activeGuide.panelStroke, lineWidth: 0.8)
        }
        .shadow(color: .black.opacity(0.13), radius: 22, y: 10)
    }

    private func clearMapSelection() {
        selectedRestaurant = nil
        selectedMarkerPresentation = .pinOnly
    }
}

private enum DineMetric {
    static let edge: CGFloat = 16
    static let topInset: CGFloat = 7
    static let headerHeight: CGFloat = 30
    static let chromeGap: CGFloat = 10
    static let filterHeight: CGFloat = 59
    static let filterGap: CGFloat = 4
    static let dropdownGap: CGFloat = 8
    static let panelRadius: CGFloat = 8
    static let minimumSheetHeight: CGFloat = 252
    static let collapsedSheetHeight: CGFloat = 48
    static let rowThumb: CGFloat = 44
    static let rowHorizontalPadding: CGFloat = 12
    static let rowVerticalPadding: CGFloat = 8
}

private enum FilterDropdownKind {
    case city
    case cost
    case level

    var index: Int {
        switch self {
        case .city:
            return 0
        case .cost:
            return 1
        case .level:
            return 2
        }
    }
}

private enum DineCostBand: String, CaseIterable, Identifiable {
    case all
    case under50
    case between50And100
    case between100And200
    case between200And500
    case over500

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all:
            return "不限"
        case .under50:
            return "¥50-"
        case .between50And100:
            return "¥50-100"
        case .between100And200:
            return "¥100-200"
        case .between200And500:
            return "¥200-500"
        case .over500:
            return "¥500+"
        }
    }

    func includes(_ price: Int?) -> Bool {
        switch self {
        case .all:
            return true
        case .under50:
            return price.map { $0 < 50 } ?? false
        case .between50And100:
            return price.map { $0 >= 50 && $0 < 100 } ?? false
        case .between100And200:
            return price.map { $0 >= 100 && $0 < 200 } ?? false
        case .between200And500:
            return price.map { $0 >= 200 && $0 < 500 } ?? false
        case .over500:
            return price.map { $0 >= 500 } ?? false
        }
    }
}

private struct GuideSwitchButton: View {
    let activeGuide: GuideKind
    let action: () -> Void

    private var targetGuide: GuideKind {
        activeGuide == .michelin ? .blackPearl : .michelin
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                GuideLogo(guide: targetGuide)
                WebIcon(kind: .externalLink, tint: activeGuide == .blackPearl ? DineStyle.blackPearlMuted : DineStyle.muted)
                    .frame(width: 14, height: 14)
            }
            .frame(height: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("切换到\(targetGuide.title)")
    }
}

private struct GuideLogo: View {
    let guide: GuideKind

    var body: some View {
        Group {
            switch guide {
            case .michelin:
                SVGVectorIcon(name: "michelin-guide", tint: DineStyle.michelinRed)
                    .frame(width: 18, height: 18)
            case .blackPearl:
                BundledPNG(name: "black-pearl-logo-official")
                    .frame(width: 28, height: 28)
            }
        }
    }
}

private struct FilterButton: View {
    let label: String
    let value: String
    let icon: WebIconKind
    let guide: GuideKind
    let isOpen: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                WebIcon(kind: icon, tint: guide.iconColor)
                    .frame(width: 16, height: 16)

                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(DineFont.semibold(11))
                        .foregroundStyle(guide.primaryText)
                    Text(value)
                        .font(DineFont.regular(13.12))
                        .foregroundStyle(guide.secondaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, minHeight: DineMetric.filterHeight)
            .padding(.horizontal, 8)
            .background(guide.filterSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(isOpen ? guide.focusStroke : guide.filterStroke, lineWidth: isOpen ? 1.2 : 0.8)
            }
            .shadow(color: .black.opacity(0.06), radius: 10, y: 4)
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct FilterDropdownPanel<Content: View>: View {
    let guide: GuideKind
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 8) {
            content
        }
        .padding(8)
        .background(guide.dropdownSurface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(guide.filterStroke, lineWidth: 0.8)
        }
        .shadow(color: .black.opacity(0.17), radius: 18, y: 9)
    }
}

private struct DropdownOptions<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 4) {
                content
            }
        }
        .frame(maxHeight: 320)
    }
}

private struct DropdownOption: View {
    let label: String
    let guide: GuideKind
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(label)
                    .font(DineFont.regular(12))
                    .foregroundStyle(guide.primaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                if isSelected {
                    WebIcon(kind: .check, tint: guide.iconColor)
                        .frame(width: 14, height: 14)
                }
            }
            .frame(minHeight: 36)
            .padding(.horizontal, 10)
            .background(isSelected ? guide.optionSelectedSurface : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct RestaurantRow: View {
    let restaurant: Restaurant
    let isSelected: Bool
    let guide: GuideKind

    var body: some View {
        HStack(alignment: .center, spacing: 9) {
            RestaurantThumb(restaurant: restaurant)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .center, spacing: 8) {
                    Text(restaurant.name)
                        .font(DineFont.semibold(13.76))
                        .foregroundStyle(guide.primaryText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(height: 14, alignment: .center)

                    Spacer(minLength: 4)

                    Text(restaurant.costDisplay)
                        .font(DineFont.medium(11.52))
                        .foregroundStyle(guide.secondaryText)
                        .lineLimit(1)
                        .frame(height: 14, alignment: .center)

                    LevelValue(restaurant: restaurant)
                        .frame(width: restaurant.guide == .blackPearl ? 32.8 : 42, height: 14, alignment: .center)

                    RestaurantExternalLink(restaurant: restaurant, guide: guide)
                }
                .frame(maxWidth: .infinity, minHeight: 14, maxHeight: 14)

                Text(restaurant.dishes.joined(separator: " / "))
                    .font(DineFont.regular(11.52))
                    .foregroundStyle(guide.secondaryText)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .minWidthZero()
        }
        .padding(.horizontal, DineMetric.rowHorizontalPadding)
        .padding(.vertical, DineMetric.rowVerticalPadding)
        .background(isSelected ? guide.rowActiveSurface : .clear)
        .contentShape(Rectangle())
    }
}

private struct RestaurantExternalLink: View {
    let restaurant: Restaurant
    let guide: GuideKind

    var body: some View {
        if !restaurant.externalURLCandidates.isEmpty {
            Button(action: openExternalURL) {
                WebIcon(kind: .externalLink, tint: guide.secondaryText)
                    .frame(width: 13.6, height: 13.6)
            }
            .buttonStyle(.plain)
        } else {
            WebIcon(kind: .externalLink, tint: guide.secondaryText)
                .frame(width: 13.6, height: 13.6)
        }
    }

    private func openExternalURL() {
        openCandidate(at: 0, in: restaurant.externalURLCandidates)
    }

    private func openCandidate(at index: Int, in urls: [URL]) {
        guard urls.indices.contains(index) else { return }

        UIApplication.shared.open(urls[index], options: [:]) { success in
            guard !success else { return }
            openCandidate(at: index + 1, in: urls)
        }
    }
}

private struct LevelValue: View {
    let restaurant: Restaurant

    var body: some View {
        if restaurant.guide == .blackPearl {
            BlackPearlLevelMark(level: restaurant.level)
        } else {
            Text(restaurant.levelLabel)
                .font(DineFont.bold(11.52))
                .foregroundStyle(restaurant.levelTextColor)
                .lineLimit(1)
        }
    }
}

private struct BlackPearlLevelMark: View {
    let level: DineLevel

    private var count: Int {
        switch level {
        case .threeStars:
            return 3
        case .twoStars:
            return 2
        default:
            return 1
        }
    }

    var body: some View {
        Group {
            if count == 3 {
                VStack(spacing: -1) {
                    DiamondImage()
                    HStack(spacing: 1) {
                        DiamondImage()
                        DiamondImage()
                    }
                }
            } else {
                HStack(spacing: 1) {
                    ForEach(0..<count, id: \.self) { _ in
                        DiamondImage()
                    }
                }
            }
        }
        .frame(width: 33, height: 18, alignment: .center)
        .accessibilityLabel(level.label(for: .blackPearl))
    }
}

private struct DiamondImage: View {
    var body: some View {
        BundledPNG(name: "black-pearl-diamond-official-52")
            .frame(width: 13.44, height: 13.44)
    }
}

private struct RestaurantThumb: View {
    let restaurant: Restaurant

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [restaurant.guide.accentColor.opacity(0.24), Color.white.opacity(0.45)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            if let coverImageUrl = restaurant.coverImageUrl {
                AsyncImage(url: coverImageUrl) { phase in
                    if let image = phase.image {
                        image
                            .resizable()
                            .scaledToFill()
                    } else {
                        Text(restaurant.initials)
                            .font(DineFont.bold(13))
                            .foregroundStyle(restaurant.guide.accentColor.opacity(0.82))
                    }
                }
            } else {
                Text(restaurant.initials)
                    .font(DineFont.bold(13))
                    .foregroundStyle(restaurant.guide.accentColor.opacity(0.82))
            }
        }
        .frame(width: DineMetric.rowThumb, height: DineMetric.rowThumb)
        .clipped()
    }
}

private enum WebIconKind {
    case mapPin
    case tag
    case michelinGuide
    case blackPearlDiamond
    case externalLink
    case chevronDown
    case check
}

private struct WebIcon: View {
    let kind: WebIconKind
    var tint: Color = DineStyle.muted

    var body: some View {
        switch kind {
        case .mapPin:
            SVGVectorIcon(name: "web-map-pin", tint: tint)
        case .tag:
            SVGVectorIcon(name: "web-tag", tint: tint)
        case .michelinGuide:
            SVGVectorIcon(name: "michelin-guide", tint: DineStyle.michelinRed)
        case .blackPearlDiamond:
            BundledPNG(name: "black-pearl-diamond-official-52")
        case .externalLink:
            SVGVectorIcon(name: "web-external-link", tint: tint)
        case .chevronDown:
            SVGVectorIcon(name: "web-chevron-down", tint: tint)
        case .check:
            SVGVectorIcon(name: "web-check", tint: tint)
        }
    }
}

private extension GuideKind {
    var primaryText: Color {
        switch self {
        case .michelin:
            return DineStyle.text
        case .blackPearl:
            return DineStyle.blackPearlText
        }
    }

    var secondaryText: Color {
        switch self {
        case .michelin:
            return DineStyle.muted
        case .blackPearl:
            return DineStyle.blackPearlMuted
        }
    }

    var iconColor: Color {
        switch self {
        case .michelin:
            return DineStyle.michelinRed
        case .blackPearl:
            return DineStyle.blackPearlText
        }
    }

    var filterSurface: Color {
        switch self {
        case .michelin:
            return DineStyle.filterSurface
        case .blackPearl:
            return DineStyle.blackPearl
        }
    }

    var filterStroke: Color {
        switch self {
        case .michelin:
            return DineStyle.filterStroke
        case .blackPearl:
            return Color(red: 0.467, green: 0.435, blue: 0.4)
        }
    }

    var focusStroke: Color {
        switch self {
        case .michelin:
            return DineStyle.michelinRed.opacity(0.42)
        case .blackPearl:
            return DineStyle.pearlGold.opacity(0.58)
        }
    }

    var dropdownSurface: Color {
        switch self {
        case .michelin:
            return Color.white.opacity(0.98)
        case .blackPearl:
            return DineStyle.blackPearl.opacity(0.98)
        }
    }

    var optionSelectedSurface: Color {
        switch self {
        case .michelin:
            return DineStyle.michelinRed.opacity(0.10)
        case .blackPearl:
            return DineStyle.pearlGold.opacity(0.16)
        }
    }

    var panelSurface: Color {
        switch self {
        case .michelin:
            return DineStyle.panel
        case .blackPearl:
            return DineStyle.blackPearl.opacity(0.96)
        }
    }

    var panelStroke: Color {
        switch self {
        case .michelin:
            return Color(red: 0.906, green: 0.898, blue: 0.875)
        case .blackPearl:
            return DineStyle.pearlGold.opacity(0.26)
        }
    }

    var rowDivider: Color {
        switch self {
        case .michelin:
            return Color(red: 0.906, green: 0.898, blue: 0.875)
        case .blackPearl:
            return DineStyle.pearlGold.opacity(0.18)
        }
    }

    var rowActiveSurface: Color {
        switch self {
        case .michelin:
            return Color(red: 1, green: 0.941, blue: 0.953)
        case .blackPearl:
            return DineStyle.pearlGold.opacity(0.12)
        }
    }

    var canvas: Color {
        switch self {
        case .michelin:
            return DineStyle.canvas
        case .blackPearl:
            return Color(red: 0.039, green: 0.020, blue: 0.059)
        }
    }
}

private extension View {
    func minWidthZero() -> some View {
        frame(minWidth: 0)
    }
}

#Preview {
    ContentView()
}
