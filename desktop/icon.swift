// icon.swift <svg> <out.iconset>: render an SVG onto a rounded square, at every size an .icns needs.
import Cocoa

let args = CommandLine.arguments
guard args.count == 3, let svg = NSImage(contentsOf: URL(fileURLWithPath: args[1])), svg.isValid else { exit(1) }
let out = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func render(_ px: Int) -> Data? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    // macOS icon grid: the tile fills ~80% of the canvas
    let tile = NSRect(x: s * 0.1, y: s * 0.1, width: s * 0.8, height: s * 0.8)
    let path = NSBezierPath(roundedRect: tile, xRadius: s * 0.18, yRadius: s * 0.18)
    NSColor(white: 0.1, alpha: 1).setFill()
    path.fill()
    let side = tile.width * 0.55
    let box = NSRect(x: tile.midX - side / 2, y: tile.midY - side / 2, width: side, height: side)
    // keep the SVG's aspect ratio inside the box
    let r = svg.size.width / max(svg.size.height, 1)
    let fit = r >= 1 ? NSRect(x: box.minX, y: box.midY - side / r / 2, width: side, height: side / r)
                     : NSRect(x: box.midX - side * r / 2, y: box.minY, width: side * r, height: side)
    svg.draw(in: fit)
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

for base in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
        guard let data = render(base * scale) else { exit(1) }
        try data.write(to: out.appendingPathComponent(name))
    }
}
