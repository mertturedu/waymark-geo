import AppKit

let out = CommandLine.arguments[1]
let width = 64
let height = 40

func colour(_ hex: Int) -> NSColor {
  NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
}

func render(_ name: String, fill: Int, rounded: CGFloat) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  let graphics = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = graphics
  let context = graphics.cgContext
  context.clear(CGRect(x: 0, y: 0, width: width, height: height))
  let outer = CGRect(x: 2, y: 2, width: width - 4, height: height - 4)
  context.setFillColor(NSColor.white.cgColor)
  context.addPath(CGPath(roundedRect: outer, cornerWidth: rounded, cornerHeight: rounded, transform: nil))
  context.fillPath()
  context.setFillColor(colour(fill).cgColor)
  context.addPath(CGPath(roundedRect: outer.insetBy(dx: 3, dy: 3), cornerWidth: max(rounded - 3, 2), cornerHeight: max(rounded - 3, 2), transform: nil))
  context.fillPath()
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
}

render("geo-shield-motorway", fill: 0x1B7F4B, rounded: 10)
render("geo-shield-euro", fill: 0x0B6B3A, rounded: 6)
render("geo-shield-state", fill: 0x1F5FA8, rounded: 10)
render("geo-shield-provincial", fill: 0x6B6B72, rounded: 6)
