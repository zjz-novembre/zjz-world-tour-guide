import SwiftUI
import UIKit

enum DineStyle {
    static let canvas = Color(red: 0.969, green: 0.969, blue: 0.961)
    static let surface = Color.white.opacity(0.92)
    static let panel = Color.white.opacity(0.96)
    static let panelStroke = Color(red: 0.906, green: 0.898, blue: 0.875)
    static let filterSurface = Color.white.opacity(0.94)
    static let filterStroke = Color(red: 0.86, green: 0.85, blue: 0.83).opacity(0.92)
    static let rowDivider = Color(red: 0.88, green: 0.87, blue: 0.84).opacity(0.92)
    static let text = Color(red: 0.141, green: 0.141, blue: 0.141)
    static let muted = Color(red: 0.455, green: 0.439, blue: 0.416)
    static let michelinRed = Color(red: 0.827, green: 0.027, blue: 0.169)
    static let bibGold = Color(red: 0.635, green: 0.475, blue: 0.239)
    static let blackPearl = Color(red: 0.122, green: 0.094, blue: 0.153)
    static let blackPearlText = Color(red: 0.929, green: 0.867, blue: 0.8)
    static let blackPearlMuted = Color(red: 0.718, green: 0.655, blue: 0.616)
    static let pearlGold = Color(red: 0.831, green: 0.686, blue: 0.216)
}

struct RestaurantMarker: View {
    let restaurant: Restaurant
    let isSelected: Bool
    let markerScale: CGFloat

    var body: some View {
        ZStack(alignment: .leading) {
            if isSelected && opensLeft {
                MarkerDetail(restaurant: restaurant)
                    .offset(x: -170)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .trailing)))
                    .zIndex(1)
            }

            PinBadge(restaurant: restaurant, isSelected: isSelected, markerScale: markerScale)
                .zIndex(2)

            if isSelected && !opensLeft {
                MarkerDetail(restaurant: restaurant)
                    .offset(x: 42)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .leading)))
                    .zIndex(1)
            }
        }
        .animation(.snappy(duration: 0.18), value: isSelected)
    }

    private var opensLeft: Bool {
        restaurant.coordinate.longitude > 121.47
    }
}

private struct PinBadge: View {
    let restaurant: Restaurant
    let isSelected: Bool
    let markerScale: CGFloat

    private var pinSize: CGFloat {
        29.59375
    }

    var body: some View {
        ZStack {
            PinShape()
                .fill(pinColor)
                .strokeBorder(strokeColor, lineWidth: 1)
                .frame(width: pinSize, height: pinSize)
                .rotationEffect(.degrees(-45))
                .shadow(color: shadowColor, radius: isSelected ? 12 : 10, y: 5)

            LevelGlyph(restaurant: restaurant, pinSize: pinSize)
                .offset(iconOffset)
        }
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

    private var strokeColor: Color {
        restaurant.guide == .blackPearl ? DineStyle.blackPearlText : .white
    }

    private var shadowColor: Color {
        if isSelected {
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
                        .font(DineFont.semibold(13.76))
                        .foregroundStyle(primaryText)
                        .lineLimit(1)

                }

                Text("\(restaurant.costDisplay) · \(restaurant.levelLabel)")
                    .font(DineFont.medium(10.88))
                    .foregroundStyle(levelColor)
                    .lineLimit(1)

                Text(restaurant.dishes.joined(separator: " / "))
                    .font(DineFont.regular(10.88))
                    .foregroundStyle(secondaryText)
                    .lineLimit(2)
            }
            .frame(minWidth: 0)
        }
        .padding(12)
        .frame(width: 288, alignment: .leading)
        .background(detailSurface, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(detailStroke, lineWidth: 0.8)
        }
        .shadow(color: .black.opacity(0.14), radius: 18, y: 7)
    }

    private var levelColor: Color {
        restaurant.guide == .blackPearl ? DineStyle.pearlGold : DineStyle.michelinRed
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
        restaurant.guide == .blackPearl ? DineStyle.blackPearlText.opacity(0.36) : Color.white.opacity(0.52)
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
        .frame(width: 51.2, height: 51.2)
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
