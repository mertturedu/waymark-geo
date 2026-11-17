import AppKit

struct Badge { let id: String; let text: String; let fill: String; let ink: String }

let chainsFile = CommandLine.arguments[2]
let badges: [Badge] = (try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: chainsFile))) as! [[String: Any]]).map {
  Badge(id: $0["id"] as! String, text: $0["text"] as! String, fill: $0["fill"] as! String, ink: $0["ink"] as! String)
}

func color(_ hex: String) -> NSColor {
  let v = UInt32(hex, radix: 16)!
  return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
}

func write(_ rep: NSBitmapImageRep, to path: String) {
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

func canvas(_ width: Int, _ height: Int, _ draw: () -> Void) -> NSBitmapImageRep {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  draw()
  NSGraphicsContext.restoreGraphicsState()
  return rep
}

let out = CommandLine.arguments[1]
let height = 44
let font = NSFont.systemFont(ofSize: 25, weight: .heavy)

for badge in badges {
  let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color(badge.ink), .kern: 0.5]
  let text = NSAttributedString(string: badge.text, attributes: attributes)
  let size = text.size()
  let width = max(height, Int(ceil(size.width)) + 26)
  let rep = canvas(width, height) {
    let box = NSRect(x: 2, y: 2, width: width - 4, height: height - 4)
    let pill = NSBezierPath(roundedRect: box, xRadius: CGFloat(height) / 2 - 2, yRadius: CGFloat(height) / 2 - 2)
    NSColor.white.setStroke()
    color(badge.fill).setFill()
    pill.lineWidth = 3
    pill.fill()
    pill.stroke()
    text.draw(at: NSPoint(x: (CGFloat(width) - size.width) / 2, y: (CGFloat(height) - size.height) / 2))
  }
  write(rep, to: "\(out)/geo-brand-\(badge.id).png")
}

let side = 48
let landmark = canvas(side, side) {
  let circle = NSBezierPath(ovalIn: NSRect(x: 3, y: 3, width: side - 6, height: side - 6))
  color("4B3F8F").setFill()
  NSColor.white.setStroke()
  circle.lineWidth = 3
  circle.fill()
  circle.stroke()
  let star = NSBezierPath()
  let center = NSPoint(x: 24, y: 24)
  for i in 0..<8 {
    let angle = CGFloat(i) * .pi / 4 + .pi / 2
    let radius: CGFloat = i % 2 == 0 ? 13 : 5
    let point = NSPoint(x: center.x + cos(angle) * radius, y: center.y + sin(angle) * radius)
    if i == 0 { star.move(to: point) } else { star.line(to: point) }
  }
  star.close()
  NSColor.white.setFill()
  star.fill()
}
write(landmark, to: "\(out)/geo-landmark.png")

let cargo = canvas(side, side) {
  let circle = NSBezierPath(ovalIn: NSRect(x: 3, y: 3, width: side - 6, height: side - 6))
  color("E8590C").setFill()
  NSColor.white.setStroke()
  circle.lineWidth = 3
  circle.fill()
  circle.stroke()
  let box = NSBezierPath(roundedRect: NSRect(x: 13, y: 14, width: 22, height: 18), xRadius: 2, yRadius: 2)
  NSColor.white.setFill()
  box.fill()
  let band = NSBezierPath(rect: NSRect(x: 22, y: 14, width: 4, height: 18))
  color("E8590C").setFill()
  band.fill()
  let lid = NSBezierPath(rect: NSRect(x: 13, y: 24, width: 22, height: 2))
  lid.fill()
}
write(cargo, to: "\(out)/geo-cargo.png")
