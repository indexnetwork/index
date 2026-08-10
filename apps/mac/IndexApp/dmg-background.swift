import Cocoa

// Generates the branded DMG window background from the Amiga Workbench palette
// used by the app CSS (--amiga-bg #0055AA, --amiga-accent #FF8A00). White text
// on the blue field matches Workbench window chrome.
//
// Usage: dmg-background <output-dir>
// Writes <output-dir>/dmg-background.png (540x380) and
//        <output-dir>/dmg-background@2x.png (1080x760).

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: dmg-background <output-dir>\n".utf8))
    exit(1)
}
let outputDir = arguments[1]

// Best-effort brand font; CoreText accepts woff2 on modern macOS, and the
// system sans fallback keeps generation deterministic on older toolchains.
let fontURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    .appendingPathComponent("src/fonts/ibm-plex-sans-latin-var.woff2")
CTFontManagerRegisterFontsForURL(fontURL as CFURL, .process, nil)

let desktopBlue = NSColor(calibratedRed: 0, green: CGFloat(0x55) / 255, blue: CGFloat(0xAA) / 255, alpha: 1)
let accentOrange = NSColor(calibratedRed: 1, green: CGFloat(0x8A) / 255, blue: 0, alpha: 1)

func render(scale: CGFloat, to path: String) {
    let size = CGSize(width: 540, height: 380)
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(size.width * scale),
        pixelsHigh: Int(size.height * scale),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .calibratedRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else { fatalError("cannot allocate bitmap") }
    rep.size = size

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    desktopBlue.setFill()
    NSRect(origin: .zero, size: size).fill()

    // Workbench title-bar strip across the top (Cocoa y-up coordinates).
    accentOrange.setFill()
    NSRect(x: 0, y: size.height - 28, width: size.width, height: 28).fill()
    NSColor.white.setFill()
    NSRect(x: 0, y: size.height - 30, width: size.width, height: 2).fill()

    let font = NSFont(name: "IBM Plex Sans", size: 16)
        ?? NSFont.systemFont(ofSize: 16, weight: .medium)
    let text = "Drag Index to Applications"
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor.white,
    ]
    let textSize = text.size(withAttributes: attributes)
    text.draw(
        at: NSPoint(x: (size.width - textSize.width) / 2, y: 24),
        withAttributes: attributes
    )

    NSGraphicsContext.restoreGraphicsState()

    guard let png = rep.representation(using: .png, properties: [:]) else {
        fatalError("cannot encode PNG")
    }
    do {
        try png.write(to: URL(fileURLWithPath: path))
    } catch {
        fatalError("cannot write \(path): \(error)")
    }
}

render(scale: 1, to: "\(outputDir)/dmg-background.png")
render(scale: 2, to: "\(outputDir)/dmg-background@2x.png")
