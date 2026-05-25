import CoreLocation
import SwiftUI
import UIKit

enum DineStyle {
    static let canvas = Color(red: 0.969, green: 0.969, blue: 0.961)
    static let surface = Color.white.opacity(0.92)
    static let panel = Color.white.opacity(0.96)
    static let filterSurface = Color.white.opacity(0.94)
    static let filterStroke = Color(red: 0.86, green: 0.85, blue: 0.83).opacity(0.92)
    static let text = Color(red: 0.141, green: 0.141, blue: 0.141)
    static let muted = Color(red: 0.455, green: 0.439, blue: 0.416)
    static let michelinRed = Color(red: 0.827, green: 0.027, blue: 0.169)
    static let bibGold = Color(red: 0.635, green: 0.475, blue: 0.239)
    static let blackPearl = Color(red: 0.122, green: 0.094, blue: 0.153)
    static let blackPearlText = Color(red: 0.929, green: 0.867, blue: 0.8)
    static let blackPearlMuted = Color(red: 0.718, green: 0.655, blue: 0.616)
    static let pearlGold = Color(red: 0.929, green: 0.867, blue: 0.8)
}

enum RestaurantMarkerPresentation: Equatable {
    case pinOnly
    case smallTag
    case detailTag
}

struct RestaurantMarkerLayout {
    static let pinSize: CGFloat = 29.59375
    static let tagGap: CGFloat = 5
    static let smallTagMaxWidth: CGFloat = 176
    static let smallTagTextMaxWidth: CGFloat = 152
    static let smallTagFontSize: CGFloat = 12.8
    static let smallTagHorizontalPadding: CGFloat = 12
    static let smallTagVerticalPadding: CGFloat = 8
    static let detailTagWidth: CGFloat = 288
    static let detailTagMinimumHeight: CGFloat = 75.2
    static let detailTagImageSize: CGFloat = 51.2
    static let detailTagPadding: CGFloat = 12
    static let detailTagSpacing: CGFloat = 12
    static let detailTagTextSpacing: CGFloat = 5
    static let detailTagNameFontSize: CGFloat = 13.76
    static let detailTagMetaFontSize: CGFloat = 10.88
    static let detailTagDishesFontSize: CGFloat = 10.88

    let size: CGSize
    let pinCenter: CGPoint
    let tagCenter: CGPoint?

    static func layout(
        for restaurant: Restaurant?,
        presentation: RestaurantMarkerPresentation,
        markerScale: CGFloat = 1
    ) -> RestaurantMarkerLayout {
        guard let restaurant else {
            return RestaurantMarkerLayout(
                size: CGSize(width: 44, height: 44),
                pinCenter: CGPoint(x: 22, y: 22),
                tagCenter: nil
            )
        }

        switch presentation {
        case .pinOnly:
            return RestaurantMarkerLayout(
                size: CGSize(width: 44, height: 44),
                pinCenter: CGPoint(x: 22, y: 22),
                tagCenter: nil
            )
        case .smallTag:
            let tagWidth = smallTagWidth(for: restaurant)
            let visualPinRight = pinSize / 2 + pinSize * markerScale / 2
            let size = CGSize(
                width: visualPinRight + tagGap + tagWidth,
                height: 44
            )
            let pinY = size.height / 2
            let pinCenter = CGPoint(
                x: pinSize / 2,
                y: pinY
            )
            let tagCenter = CGPoint(
                x: visualPinRight + tagGap + tagWidth / 2,
                y: pinY
            )
            return RestaurantMarkerLayout(size: size, pinCenter: pinCenter, tagCenter: tagCenter)
        case .detailTag:
            let visualPinRight = pinSize / 2 + pinSize * markerScale / 2
            let tagHeight = detailTagHeight(for: restaurant)
            let size = CGSize(
                width: visualPinRight + tagGap + detailTagWidth,
                height: tagHeight
            )
            let pinY = size.height / 2
            let pinCenter = CGPoint(
                x: pinSize / 2,
                y: pinY
            )
            let tagCenter = CGPoint(
                x: visualPinRight + tagGap + detailTagWidth / 2,
                y: pinY
            )
            return RestaurantMarkerLayout(size: size, pinCenter: pinCenter, tagCenter: tagCenter)
        }
    }

    static func smallTagWidth(for restaurant: Restaurant) -> CGFloat {
        smallTagTextWidth(for: restaurant) + smallTagHorizontalPadding * 2
    }

    static func smallTagTextWidth(for restaurant: Restaurant) -> CGFloat {
        guard let font = UIFont(name: "OpenAISans-Semibold", size: smallTagFontSize) else {
            return smallTagTextMaxWidth
        }
        let measured = (restaurant.name as NSString).boundingRect(
            with: CGSize(width: CGFloat.greatestFiniteMagnitude, height: smallTagFontSize * 1.4),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font],
            context: nil
        ).width
        return min(ceil(measured), smallTagTextMaxWidth)
    }

    static func detailTagHeight(for restaurant: Restaurant) -> CGFloat {
        let textWidth = detailTagTextWidth
        let dishes = restaurant.dishes.joined(separator: " / ")
        let dishHeight = measuredHeight(
            text: dishes,
            fontName: "OpenAISans-Regular",
            fontSize: detailTagDishesFontSize,
            width: textWidth,
            lineHeightMultiple: 1.35
        )
        let textHeight =
            ceil(detailTagNameFontSize * 1.25) +
            detailTagTextSpacing +
            ceil(detailTagMetaFontSize * 1.25) +
            detailTagTextSpacing +
            dishHeight
        let contentHeight = max(detailTagImageSize, textHeight)
        return max(detailTagMinimumHeight, ceil(contentHeight + detailTagPadding * 2))
    }

    static var detailTagTextWidth: CGFloat {
        detailTagWidth - detailTagPadding * 2 - detailTagImageSize - detailTagSpacing
    }

    private static func measuredHeight(
        text: String,
        fontName: String,
        fontSize: CGFloat,
        width: CGFloat,
        lineHeightMultiple: CGFloat
    ) -> CGFloat {
        guard !text.isEmpty,
              let font = UIFont(name: fontName, size: fontSize) else {
            return ceil(fontSize * lineHeightMultiple)
        }
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineHeightMultiple = lineHeightMultiple
        let measured = (text as NSString).boundingRect(
            with: CGSize(width: width, height: CGFloat.greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [
                .font: font,
                .paragraphStyle: paragraph
            ],
            context: nil
        ).height
        return ceil(measured)
    }
}

struct RestaurantMarker: View {
    let restaurant: Restaurant
    let presentation: RestaurantMarkerPresentation
    let isFocused: Bool
    let markerScale: CGFloat

    var body: some View {
        let layout = RestaurantMarkerLayout.layout(
            for: restaurant,
            presentation: presentation,
            markerScale: markerScale
        )
        ZStack(alignment: .topLeading) {
            if let tagCenter = layout.tagCenter {
                switch presentation {
                case .smallTag:
                    MarkerSmallTag(restaurant: restaurant)
                        .position(tagCenter)
                        .zIndex(1)
                case .detailTag:
                    MarkerDetail(restaurant: restaurant)
                        .position(tagCenter)
                        .zIndex(1)
                case .pinOnly:
                    EmptyView()
                }
            }

            PinBadge(restaurant: restaurant, isFocused: isFocused, markerScale: markerScale)
                .position(layout.pinCenter)
                .zIndex(2)
        }
        .frame(width: layout.size.width, height: layout.size.height)
    }

}

private struct PinBadge: View {
    let restaurant: Restaurant
    let isFocused: Bool
    let markerScale: CGFloat

    private var pinSize: CGFloat {
        RestaurantMarkerLayout.pinSize
    }

    var body: some View {
        ZStack {
            PinShape()
                .fill(pinColor)
                .strokeBorder(strokeColor, lineWidth: 1)
                .frame(width: pinSize, height: pinSize)
                .rotationEffect(.degrees(-45))
                .shadow(color: shadowColor, radius: isFocused ? 12 : 10, y: 5)

            if let pinWashColor {
                PinShape()
                    .inset(by: 1)
                    .fill(pinWashColor)
                    .frame(width: pinSize, height: pinSize)
                    .rotationEffect(.degrees(-45))
            }

            LevelGlyph(restaurant: restaurant, pinSize: pinSize)
                .offset(iconOffset)
        }
        .scaleEffect(markerScale, anchor: .bottom)
        .accessibilityLabel("\(restaurant.name), \(restaurant.levelLabel)")
    }

    private var pinColor: Color {
        switch restaurant.guide {
        case .michelin:
            switch restaurant.level {
            case .bib:
                return DineStyle.bibGold
            case .selected:
                return DineStyle.muted
            default:
                return DineStyle.michelinRed
            }
        case .blackPearl:
            return DineStyle.blackPearl
        }
    }

    private var pinWashColor: Color? {
        restaurant.guide == .michelin ? .white.opacity(0.24) : nil
    }

    private var strokeColor: Color {
        restaurant.guide == .blackPearl ? DineStyle.pearlGold : .white
    }

    private var shadowColor: Color {
        if isFocused {
            switch (restaurant.guide, restaurant.level) {
            case (.blackPearl, _):
                return DineStyle.pearlGold.opacity(0.28)
            case (.michelin, .bib):
                return DineStyle.bibGold.opacity(0.22)
            case (.michelin, .selected):
                return DineStyle.muted.opacity(0.22)
            default:
                return DineStyle.michelinRed.opacity(0.18)
            }
        }
        return .black.opacity(restaurant.guide == .blackPearl ? 0.34 : 0.16)
    }

    private var iconOffset: CGSize {
        switch (restaurant.guide, restaurant.level) {
        case (.michelin, .bib):
            return CGSize(width: 0, height: -pinSize * 0.04592)
        case (.michelin, .selected):
            return CGSize(width: pinSize * 0.02577, height: pinSize * 0.05153)
        default:
            return CGSize(width: 0, height: 0)
        }
    }
}

private struct MarkerSmallTag: View {
    let restaurant: Restaurant

    var body: some View {
        Text(restaurant.name)
            .font(DineFont.semibold(RestaurantMarkerLayout.smallTagFontSize))
            .foregroundStyle(primaryText)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(width: RestaurantMarkerLayout.smallTagTextWidth(for: restaurant), alignment: .leading)
            .padding(.horizontal, RestaurantMarkerLayout.smallTagHorizontalPadding)
            .padding(.vertical, RestaurantMarkerLayout.smallTagVerticalPadding)
            .background(tagSurface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(tagStroke, lineWidth: 0.8)
            }
            .shadow(color: .black.opacity(0.11), radius: 13, y: 5)
    }

    private var primaryText: Color {
        restaurant.guide == .blackPearl ? DineStyle.blackPearlText : DineStyle.text
    }

    private var tagSurface: Color {
        restaurant.guide == .blackPearl ? DineStyle.blackPearl.opacity(0.98) : Color.white.opacity(0.90)
    }

    private var tagStroke: Color {
        restaurant.guide == .blackPearl ? DineStyle.pearlGold.opacity(0.34) : DineStyle.michelinRed.opacity(0.24)
    }
}

private struct LevelGlyph: View {
    let restaurant: Restaurant
    let pinSize: CGFloat

    var body: some View {
        switch restaurant.guide {
        case .michelin:
            switch restaurant.level {
            case .bib:
                SVGVectorIcon(name: "michelin-bib-gourmand-white")
                    .frame(width: pinSize * 0.57394, height: pinSize * 0.57394)
            case .selected:
                SVGVectorIcon(name: "restaurant-selected-white")
                    .frame(width: pinSize * 0.51530, height: pinSize * 0.51530)
            default:
                SVGVectorIcon(name: "michelin-star-white")
                    .frame(width: pinSize * 0.58342, height: pinSize * 0.58342)
            }
        case .blackPearl:
            BundledPNG(name: "black-pearl-diamond-official-52")
                .frame(width: pinSize * 0.59559, height: pinSize * 0.59559)
        }
    }
}

private struct MarkerDetail: View {
    let restaurant: Restaurant

    var body: some View {
        HStack(spacing: 12) {
            MarkerDetailImage(restaurant: restaurant)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Text(restaurant.name)
                        .font(DineFont.semibold(RestaurantMarkerLayout.detailTagNameFontSize))
                        .foregroundStyle(primaryText)
                        .lineLimit(1)

                }

                HStack(spacing: 4) {
                    Text(restaurant.levelLabel)
                        .font(DineFont.medium(RestaurantMarkerLayout.detailTagMetaFontSize))
                        .foregroundStyle(levelColor)
                        .lineLimit(1)

                    Text("·")
                        .font(DineFont.medium(RestaurantMarkerLayout.detailTagMetaFontSize))
                        .foregroundStyle(secondaryText)

                    Text(restaurant.costDisplay)
                        .font(DineFont.medium(RestaurantMarkerLayout.detailTagMetaFontSize))
                        .foregroundStyle(secondaryText)
                        .lineLimit(1)
                }

                Text(restaurant.dishes.joined(separator: " / "))
                    .font(DineFont.regular(RestaurantMarkerLayout.detailTagDishesFontSize))
                    .foregroundStyle(secondaryText)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: RestaurantMarkerLayout.detailTagTextWidth, alignment: .leading)
        }
        .padding(RestaurantMarkerLayout.detailTagPadding)
        .frame(width: RestaurantMarkerLayout.detailTagWidth, alignment: .leading)
        .background(detailSurface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(detailStroke, lineWidth: 0.8)
        }
        .shadow(color: .black.opacity(0.14), radius: 18, y: 7)
    }

    private var levelColor: Color {
        restaurant.levelTextColor
    }

    private var primaryText: Color {
        restaurant.guide == .blackPearl ? DineStyle.blackPearlText : DineStyle.text
    }

    private var secondaryText: Color {
        restaurant.guide == .blackPearl ? DineStyle.blackPearlMuted : DineStyle.muted
    }

    private var detailSurface: Color {
        restaurant.guide == .blackPearl ? DineStyle.blackPearl.opacity(0.94) : Color.white.opacity(0.86)
    }

    private var detailStroke: Color {
        restaurant.guide == .blackPearl ? DineStyle.pearlGold.opacity(0.34) : DineStyle.michelinRed.opacity(0.24)
    }
}

private struct MarkerDetailImage: View {
    let restaurant: Restaurant

    var body: some View {
        ZStack {
            Color.white.opacity(0.35)

            if let coverImageUrl = restaurant.coverImageUrl {
                AsyncImage(url: coverImageUrl) { phase in
                    if let image = phase.image {
                        image
                            .resizable()
                            .scaledToFill()
                    } else {
                        Text(restaurant.initials)
                            .font(DineFont.bold(11))
                            .foregroundStyle(restaurant.guide.accentColor.opacity(0.82))
                    }
                }
            } else {
                Text(restaurant.initials)
                    .font(DineFont.bold(11))
                    .foregroundStyle(restaurant.guide.accentColor.opacity(0.82))
            }
        }
        .frame(width: RestaurantMarkerLayout.detailTagImageSize, height: RestaurantMarkerLayout.detailTagImageSize)
        .clipped()
    }
}

struct BundledPNG: View {
    let name: String

    var body: some View {
        if let url = Bundle.main.url(forResource: name, withExtension: "png"),
           let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
        }
    }
}

struct PinShape: InsettableShape {
    var insetAmount: CGFloat = 0

    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: insetAmount, dy: insetAmount)
        let radius = r.width / 2
        let smallRadius = min(4, radius)
        var path = Path()
        path.move(to: CGPoint(x: r.minX + radius, y: r.minY))
        path.addLine(to: CGPoint(x: r.maxX - radius, y: r.minY))
        path.addArc(
            center: CGPoint(x: r.maxX - radius, y: r.minY + radius),
            radius: radius,
            startAngle: .degrees(-90),
            endAngle: .degrees(0),
            clockwise: false
        )
        path.addLine(to: CGPoint(x: r.maxX, y: r.maxY - radius))
        path.addArc(
            center: CGPoint(x: r.maxX - radius, y: r.maxY - radius),
            radius: radius,
            startAngle: .degrees(0),
            endAngle: .degrees(90),
            clockwise: false
        )
        path.addLine(to: CGPoint(x: r.minX + smallRadius, y: r.maxY))
        path.addArc(
            center: CGPoint(x: r.minX + smallRadius, y: r.maxY - smallRadius),
            radius: smallRadius,
            startAngle: .degrees(90),
            endAngle: .degrees(180),
            clockwise: false
        )
        path.addLine(to: CGPoint(x: r.minX, y: r.minY + radius))
        path.addArc(
            center: CGPoint(x: r.minX + radius, y: r.minY + radius),
            radius: radius,
            startAngle: .degrees(180),
            endAngle: .degrees(270),
            clockwise: false
        )
        path.closeSubpath()
        return path
    }

    func inset(by amount: CGFloat) -> some InsettableShape {
        var copy = self
        copy.insetAmount += amount
        return copy
    }
}

struct UserLocationMarker: View {
    let headingDegrees: CLLocationDirection?

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(red: 0.078, green: 0.431, blue: 0.922).opacity(0.14))
                .frame(width: 39, height: 39)

            NavigationArrowShape()
                .fill(Color(red: 0.078, green: 0.431, blue: 0.922))
                .frame(width: 21, height: 25)
                .rotationEffect(.degrees(headingDegrees ?? 0))
                .overlay {
                    NavigationArrowShape()
                        .stroke(Color.white, lineWidth: 2)
                        .frame(width: 21, height: 25)
                        .rotationEffect(.degrees(headingDegrees ?? 0))
                }
                .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
        }
        .accessibilityLabel("当前位置")
    }
}

private struct NavigationArrowShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY * 0.77))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
