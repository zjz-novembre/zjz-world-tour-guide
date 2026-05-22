import SwiftUI

struct SVGVectorIcon: View {
    let name: String
    var tint: Color = .white

    var body: some View {
        Canvas { context, size in
            guard let document = SVGDocumentCache.shared.document(named: name) else { return }
            let rect = CGRect(origin: .zero, size: size)
            context.transform = document.fitTransform(in: rect)
            for element in document.elements {
                if element.fills {
                    context.fill(element.path, with: .color(tint))
                }
                if element.strokes {
                    context.stroke(
                        element.path,
                        with: .color(tint),
                        style: StrokeStyle(
                            lineWidth: element.strokeWidth,
                            lineCap: .round,
                            lineJoin: .round
                        )
                    )
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

private final class SVGDocumentCache {
    static let shared = SVGDocumentCache()
    private var documents: [String: SVGDocument] = [:]

    func document(named name: String) -> SVGDocument? {
        if let document = documents[name] { return document }
        guard
            let url = Bundle.main.url(forResource: name, withExtension: "svg"),
            let data = try? Data(contentsOf: url),
            let document = SVGDocumentParser.parse(data: data)
        else {
            return nil
        }
        documents[name] = document
        return document
    }
}

private struct SVGDocument {
    let viewBox: CGRect
    let elements: [SVGElement]

    func fitTransform(in rect: CGRect) -> CGAffineTransform {
        let scale = min(rect.width / viewBox.width, rect.height / viewBox.height)
        let width = viewBox.width * scale
        let height = viewBox.height * scale
        return CGAffineTransform(translationX: rect.midX - width / 2, y: rect.midY - height / 2)
            .scaledBy(x: scale, y: scale)
            .translatedBy(x: -viewBox.minX, y: -viewBox.minY)
    }
}

private struct SVGElement {
    let path: Path
    let fills: Bool
    let strokes: Bool
    let strokeWidth: CGFloat
}

private struct SVGPaintStyle {
    var fill = true
    var stroke = false
    var strokeWidth: CGFloat = 1

    mutating func apply(_ attributes: [String: String]) {
        if let style = attributes["style"] {
            for rule in style.split(separator: ";") {
                let parts = rule.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                guard parts.count == 2 else { continue }
                applyValue(parts[1], for: parts[0])
            }
        }

        for (key, value) in attributes {
            applyValue(value, for: key)
        }
    }

    private mutating func applyValue(_ value: String, for key: String) {
        switch key {
        case "fill":
            fill = value != "none"
        case "stroke":
            stroke = value != "none"
        case "stroke-width":
            strokeWidth = CGFloat(Double(value) ?? Double(strokeWidth))
        default:
            break
        }
    }
}

private final class SVGDocumentParser: NSObject, XMLParserDelegate {
    private var viewBox = CGRect(x: 0, y: 0, width: 24, height: 24)
    private var styleStack = [SVGPaintStyle()]
    private var transformStack = [CGAffineTransform.identity]
    private var elements: [SVGElement] = []

    static func parse(data: Data) -> SVGDocument? {
        let delegate = SVGDocumentParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        return parser.parse() ? SVGDocument(viewBox: delegate.viewBox, elements: delegate.elements) : nil
    }

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String]
    ) {
        if elementName == "svg", let parsedViewBox = parseViewBox(attributeDict["viewBox"]) {
            viewBox = parsedViewBox
        }

        var style = styleStack.last ?? SVGPaintStyle()
        style.apply(attributeDict)
        let parentTransform = transformStack.last ?? .identity
        let ownTransform = parseTransform(attributeDict["transform"]) ?? .identity
        let inheritedTransform = ownTransform.concatenating(parentTransform)

        if elementName == "g" || elementName == "svg" {
            styleStack.append(style)
            transformStack.append(inheritedTransform)
            return
        }

        if elementName == "path", let data = attributeDict["d"] {
            var dataParser = SVGPathDataParser(data)
            var path = dataParser.parse()
            if inheritedTransform != .identity {
                path = path.applying(inheritedTransform)
            }
            elements.append(
                SVGElement(
                    path: path,
                    fills: style.fill,
                    strokes: style.stroke,
                    strokeWidth: style.strokeWidth
                )
            )
        } else if elementName == "circle",
                  let cx = attributeDict["cx"].flatMap(Double.init),
                  let cy = attributeDict["cy"].flatMap(Double.init),
                  let radius = attributeDict["r"].flatMap(Double.init) {
            var path = Path()
            path.addEllipse(
                in: CGRect(
                    x: CGFloat(cx - radius),
                    y: CGFloat(cy - radius),
                    width: CGFloat(radius * 2),
                    height: CGFloat(radius * 2)
                )
            )
            if inheritedTransform != .identity {
                path = path.applying(inheritedTransform)
            }
            elements.append(
                SVGElement(
                    path: path,
                    fills: style.fill,
                    strokes: style.stroke,
                    strokeWidth: style.strokeWidth
                )
            )
        }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        if (elementName == "g" || elementName == "svg"), styleStack.count > 1 {
            styleStack.removeLast()
            transformStack.removeLast()
        }
    }

    private func parseViewBox(_ value: String?) -> CGRect? {
        guard let numbers = value?.svgNumbers(), numbers.count == 4 else { return nil }
        return CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
    }

    private func parseTransform(_ value: String?) -> CGAffineTransform? {
        guard let value, !value.isEmpty else { return nil }
        var transform = CGAffineTransform.identity
        let pattern = #"([a-zA-Z]+)\(([^)]*)\)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(value.startIndex..., in: value)
        for match in regex.matches(in: value, range: range) {
            guard
                let nameRange = Range(match.range(at: 1), in: value),
                let argsRange = Range(match.range(at: 2), in: value)
            else { continue }
            let name = String(value[nameRange])
            let args = String(value[argsRange]).svgNumbers()
            let next: CGAffineTransform
            switch name {
            case "matrix" where args.count >= 6:
                next = CGAffineTransform(a: args[0], b: args[1], c: args[2], d: args[3], tx: args[4], ty: args[5])
            case "translate":
                next = CGAffineTransform(translationX: args.first ?? 0, y: args.dropFirst().first ?? 0)
            case "scale":
                let x = args.first ?? 1
                next = CGAffineTransform(scaleX: x, y: args.dropFirst().first ?? x)
            default:
                continue
            }
            transform = transform.concatenating(next)
        }
        return transform
    }
}

private struct SVGPathDataParser {
    private let tokens: [SVGPathToken]
    private var index = 0
    private var command: Character?
    private var current = CGPoint.zero
    private var subpathStart = CGPoint.zero
    private var lastQuadControl: CGPoint?

    init(_ data: String) {
        tokens = SVGPathTokenizer(data).tokens
    }

    mutating func parse() -> Path {
        var path = Path()
        while index < tokens.count {
            if case let .command(next) = tokens[index] {
                command = next
                index += 1
            }
            guard let command else { break }
            switch command {
            case "M", "m":
                parseMove(&path, relative: command == "m")
            case "L", "l":
                while let point = readPoint(relative: command == "l") { line(&path, to: point) }
            case "H", "h":
                while let value = readNumber() {
                    line(&path, to: CGPoint(x: command == "h" ? current.x + value : value, y: current.y))
                }
            case "V", "v":
                while let value = readNumber() {
                    line(&path, to: CGPoint(x: current.x, y: command == "v" ? current.y + value : value))
                }
            case "C", "c":
                parseCubic(&path, relative: command == "c")
            case "Q", "q":
                parseQuad(&path, relative: command == "q")
            case "T", "t":
                parseSmoothQuad(&path, relative: command == "t")
            case "A", "a":
                parseArc(&path, relative: command == "a")
            case "Z", "z":
                path.closeSubpath()
                current = subpathStart
                lastQuadControl = nil
            default:
                index += 1
            }
        }
        return path
    }

    private mutating func parseMove(_ path: inout Path, relative: Bool) {
        guard let first = readPoint(relative: relative) else { return }
        path.move(to: first)
        current = first
        subpathStart = first
        command = relative ? "l" : "L"
        while let point = readPoint(relative: relative) { line(&path, to: point) }
    }

    private mutating func parseCubic(_ path: inout Path, relative: Bool) {
        while
            let c1 = readPoint(relative: relative),
            let c2 = readPoint(relative: relative),
            let end = readPoint(relative: relative)
        {
            path.addCurve(to: end, control1: c1, control2: c2)
            current = end
            lastQuadControl = nil
        }
    }

    private mutating func parseQuad(_ path: inout Path, relative: Bool) {
        while let control = readPoint(relative: relative), let end = readPoint(relative: relative) {
            path.addQuadCurve(to: end, control: control)
            current = end
            lastQuadControl = control
        }
    }

    private mutating func parseSmoothQuad(_ path: inout Path, relative: Bool) {
        while let end = readPoint(relative: relative) {
            let control = lastQuadControl.map {
                CGPoint(x: current.x * 2 - $0.x, y: current.y * 2 - $0.y)
            } ?? current
            path.addQuadCurve(to: end, control: control)
            current = end
            lastQuadControl = control
        }
    }

    private mutating func parseArc(_ path: inout Path, relative: Bool) {
        while
            let rx = readNumber(),
            let ry = readNumber(),
            let rotation = readNumber(),
            let largeArcFlag = readNumber(),
            let sweepFlag = readNumber(),
            let end = readPoint(relative: relative)
        {
            path.addSVGArc(
                from: current,
                to: end,
                rx: rx,
                ry: ry,
                rotation: rotation,
                largeArc: largeArcFlag != 0,
                sweep: sweepFlag != 0
            )
            current = end
            lastQuadControl = nil
        }
    }

    private mutating func line(_ path: inout Path, to point: CGPoint) {
        path.addLine(to: point)
        current = point
        lastQuadControl = nil
    }

    private mutating func readPoint(relative: Bool) -> CGPoint? {
        guard let x = readNumber(), let y = readNumber() else { return nil }
        if relative { return CGPoint(x: current.x + x, y: current.y + y) }
        return CGPoint(x: x, y: y)
    }

    private mutating func readNumber() -> CGFloat? {
        guard index < tokens.count, case let .number(value) = tokens[index] else { return nil }
        index += 1
        return value
    }
}

private enum SVGPathToken {
    case command(Character)
    case number(CGFloat)
}

private struct SVGPathTokenizer {
    let tokens: [SVGPathToken]

    init(_ data: String) {
        var parsed: [SVGPathToken] = []
        var index = data.startIndex
        while index < data.endIndex {
            let char = data[index]
            if char.isLetter {
                parsed.append(.command(char))
                index = data.index(after: index)
            } else if char == "-" || char == "+" || char == "." || char.isNumber {
                let start = index
                index = data.index(after: index)
                while index < data.endIndex {
                    let next = data[index]
                    if next.isNumber || next == "." || next == "e" || next == "E" ||
                        ((next == "-" || next == "+") && data[data.index(before: index)].isExponent) {
                        index = data.index(after: index)
                    } else {
                        break
                    }
                }
                if let value = Double(data[start..<index]) {
                    parsed.append(.number(CGFloat(value)))
                }
            } else {
                index = data.index(after: index)
            }
        }
        tokens = parsed
    }
}

private extension Path {
    mutating func addSVGArc(
        from start: CGPoint,
        to end: CGPoint,
        rx originalRX: CGFloat,
        ry originalRY: CGFloat,
        rotation: CGFloat,
        largeArc: Bool,
        sweep: Bool
    ) {
        guard start != end else { return }
        var rx = abs(originalRX)
        var ry = abs(originalRY)
        guard rx > 0, ry > 0 else {
            addLine(to: end)
            return
        }

        let phi = rotation * .pi / 180
        let cosPhi = cos(phi)
        let sinPhi = sin(phi)
        let dx = (start.x - end.x) / 2
        let dy = (start.y - end.y) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy
        let lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry)
        if lambda > 1 {
            let scale = sqrt(lambda)
            rx *= scale
            ry *= scale
        }

        let numerator = max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p)
        let denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        let sign: CGFloat = largeArc == sweep ? -1 : 1
        let coef = denominator == 0 ? 0 : sign * sqrt(numerator / denominator)
        let cxp = coef * rx * y1p / ry
        let cyp = coef * -ry * x1p / rx
        let center = CGPoint(
            x: cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2,
            y: sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2
        )

        let startVector = CGPoint(x: (x1p - cxp) / rx, y: (y1p - cyp) / ry)
        let endVector = CGPoint(x: (-x1p - cxp) / rx, y: (-y1p - cyp) / ry)
        var startAngle = atan2(startVector.y, startVector.x)
        var delta = angleBetween(startVector, endVector)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }

        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / CGFloat(segments)
        var segmentStart = start
        for _ in 0..<segments {
            let endAngle = startAngle + step
            let curve = arcSegment(
                center: center,
                rx: rx,
                ry: ry,
                phi: phi,
                startAngle: startAngle,
                endAngle: endAngle,
                startPoint: segmentStart
            )
            addCurve(to: curve.end, control1: curve.control1, control2: curve.control2)
            segmentStart = curve.end
            startAngle = endAngle
        }
    }

    private func angleBetween(_ u: CGPoint, _ v: CGPoint) -> CGFloat {
        let cross = u.x * v.y - u.y * v.x
        let dot = u.x * v.x + u.y * v.y
        return atan2(cross, dot)
    }

    private func arcSegment(
        center: CGPoint,
        rx: CGFloat,
        ry: CGFloat,
        phi: CGFloat,
        startAngle: CGFloat,
        endAngle: CGFloat,
        startPoint: CGPoint
    ) -> (control1: CGPoint, control2: CGPoint, end: CGPoint) {
        let delta = endAngle - startAngle
        let alpha = 4 / 3 * tan(delta / 4)
        let p1 = CGPoint(x: cos(startAngle), y: sin(startAngle))
        let p2 = CGPoint(x: cos(endAngle), y: sin(endAngle))
        let c1 = CGPoint(x: p1.x - alpha * p1.y, y: p1.y + alpha * p1.x)
        let c2 = CGPoint(x: p2.x + alpha * p2.y, y: p2.y - alpha * p2.x)

        func map(_ p: CGPoint) -> CGPoint {
            CGPoint(
                x: center.x + cos(phi) * rx * p.x - sin(phi) * ry * p.y,
                y: center.y + sin(phi) * rx * p.x + cos(phi) * ry * p.y
            )
        }

        return (map(c1), map(c2), map(p2))
    }
}

private extension String {
    func svgNumbers() -> [CGFloat] {
        SVGPathTokenizer(self).tokens.compactMap {
            if case let .number(value) = $0 { return value }
            return nil
        }
    }
}

private extension Character {
    var isExponent: Bool {
        self == "e" || self == "E"
    }
}
