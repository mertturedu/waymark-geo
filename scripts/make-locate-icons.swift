import AppKit

let size = 96
let out = CommandLine.arguments[1]

func arrow(in context: CGContext, turn: Double) {
  let c = Double(size) / 2
  context.translateBy(x: c, y: c)
  context.rotate(by: -turn * Double.pi / 180)
  context.translateBy(x: -c, y: -c)
}

func path(_ s: Double) -> CGPath {
  let p = CGMutablePath()
  let u = { (x: Double, y: Double) in CGPoint(x: (0.1 + 0.8 * x) * s, y: (0.1 + 0.8 * (1 - y)) * s) }
  p.move(to: u(0.5, 0.08))
  p.addLine(to: u(0.86, 0.9))
  p.addLine(to: u(0.5, 0.68))
  p.addLine(to: u(0.14, 0.9))
  p.closeSubpath()
  return p
}

func render(_ name: String, filled: Bool, turn: Double) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  let graphics = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = graphics
  let context = graphics.cgContext
  context.clear(CGRect(x: 0, y: 0, width: size, height: size))
  arrow(in: context, turn: turn)
  context.setLineJoin(.round)
  context.setLineWidth(Double(size) * 0.075)
  context.setFillColor(NSColor.black.cgColor)
  context.setStrokeColor(NSColor.black.cgColor)
  let shape = path(Double(size))
  context.addPath(shape)
  if filled { context.drawPath(using: .fillStroke) } else { context.strokePath() }
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
}

render("locate-arrow", filled: false, turn: 45)
render("locate-arrow-fill", filled: true, turn: 45)
render("locate-north-fill", filled: true, turn: 0)
