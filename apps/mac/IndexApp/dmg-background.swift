import Cocoa

// Generates the branded DMG window background as a Workbench-window motif:
// white 'paper' field (--amiga-paper #FFFFFF), a plain orange title-bar strip
// (--amiga-accent #FF8A00) at the top (no text — the real macOS title bar
// already names the window), black caption, and a chunky brand-blue arrow
// (--amiga-bg #0055AA) guiding the drag to the Applications alias.
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

let accentOrange = NSColor(calibratedRed: 1, green: CGFloat(0x8A) / 255, blue: 0, alpha: 1)
let brandBlue = NSColor(calibratedRed: 0, green: CGFloat(0x55) / 255, blue: CGFloat(0xAA) / 255, alpha: 1)

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

    // Workbench 'paper' field.
    NSColor.white.setFill()
    NSRect(origin: .zero, size: size).fill()

    let font = NSFont(name: "IBM Plex Sans", size: 15)
        ?? NSFont.systemFont(ofSize: 15, weight: .medium)

    // Title-bar strip across the top (Cocoa y-up coordinates: y 352..380),
    // with a black hairline separator underneath (y 350..352). Deliberately
    // text-free: the real macOS title bar above it already reads 'Index'.
    accentOrange.setFill()
    NSRect(x: 0, y: 352, width: size.width, height: 28).fill()
    NSColor.black.setFill()
    NSRect(x: 0, y: 350, width: size.width, height: 2).fill()

    // Arrow guiding the drag: the Finder layout (dmg.sh) puts icon centers at
    // {140, 190} and {400, 190} in top-left coordinates with 128pt icons, so
    // the icon row sits at y = 380 - 190 = 190 here, and the arrow must stay
    // between the app icon's right edge (~x=204) and the alias's left edge
    // (~x=336). Chunky 8pt shaft with a 24pt-tall filled head.
    brandBlue.setFill()
    NSRect(x: 216, y: 186, width: 86, height: 8).fill() // shaft x 216..302
    let head = NSBezierPath()
    head.move(to: NSPoint(x: 302, y: 178))
    head.line(to: NSPoint(x: 330, y: 190))
    head.line(to: NSPoint(x: 302, y: 202))
    head.close()
    head.fill()

    let text = "Drag Index to Applications"
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor.black,
    ]
    let textSize = text.size(withAttributes: attributes)
    // Below the icon labels (icon bottom y-up 126, Finder labels ~y-up 95..115).
    text.draw(
        at: NSPoint(x: (size.width - textSize.width) / 2, y: 48),
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
