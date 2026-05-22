import CoreText
import SwiftUI

enum DineFont {
    private static let fontFiles = [
        "openai-sans-v2-regular",
        "openai-sans-v2-medium",
        "openai-sans-v2-semibold",
        "openai-sans-v2-bold"
    ]

    static func registerFonts() {
        fontFiles.forEach { name in
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { return }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    static func regular(_ size: CGFloat) -> Font {
        .custom("OpenAISans-Regular", fixedSize: size)
    }

    static func medium(_ size: CGFloat) -> Font {
        .custom("OpenAISans-Medium", fixedSize: size)
    }

    static func semibold(_ size: CGFloat) -> Font {
        .custom("OpenAISans-Semibold", fixedSize: size)
    }

    static func bold(_ size: CGFloat) -> Font {
        .custom("OpenAISans-Bold", fixedSize: size)
    }
}
