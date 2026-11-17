import AppKit

let size = 96
let out = CommandLine.arguments[1]

func render(_ name: String, filled: Bool, pointer: Bool) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  let graphics = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = graphics
  let context = graphics.cgContext
  let s = Double(size)
  let c = s / 2
  context.clear(CGRect(x: 0, y: 0, width: size, height: size))
  context.setFillColor(NSColor.black.cgColor)
  context.setStrokeColor(NSColor.black.cgColor)
  context.setLineCap(.round)
  context.setLineWidth(s * 0.07)
  let ring = s * 0.27
  context.strokeEllipse(in: CGRect(x: c - ring, y: c - ring, width: ring * 2, height: ring * 2))
  for turn in 0..<4 {
    context.saveGState()
    context.translateBy(x: c, y: c)
    context.rotate(by: Double(turn) * Double.pi / 2)
    context.move(to: CGPoint(x: 0, y: ring + s * 0.06))
    context.addLine(to: CGPoint(x: 0, y: ring + s * 0.19))
    context.strokePath()
    context.restoreGState()
  }
  if filled {
    let dot = s * 0.13
    context.fillEllipse(in: CGRect(x: c - dot, y: c - dot, width: dot * 2, height: dot * 2))
  }
  if pointer {
    let wedge = CGMutablePath()
    wedge.move(to: CGPoint(x: c, y: s * 0.99))
    wedge.addLine(to: CGPoint(x: c - s * 0.1, y: s * 0.8))
    wedge.addLine(to: CGPoint(x: c + s * 0.1, y: s * 0.8))
    wedge.closeSubpath()
    context.addPath(wedge)
    context.fillPath()
  }
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
}

render("locate-arrow", filled: false, pointer: false)
render("locate-arrow-fill", filled: true, pointer: false)
render("locate-north-fill", filled: true, pointer: true)
