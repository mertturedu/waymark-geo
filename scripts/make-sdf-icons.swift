import AppKit

let dir = CommandLine.arguments[1]
let groups = ["cargo", "food", "fuel", "health", "landmark", "lodging", "market", "money", "pharmacy", "public", "safety", "shop", "worship"]
let side = 64
let pad = 8
let radius = 8.0
let up = 4

func encode(_ d: Double) -> UInt8 {
  UInt8(max(0, min(255, (255 - 255 * (d / radius + 0.25)).rounded())))
}

func save(_ alpha: [UInt8], _ path: String) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: side * 4, bitsPerPixel: 32)!
  let data = rep.bitmapData!
  for i in 0..<(side * side) {
    data[i * 4] = 255
    data[i * 4 + 1] = 255
    data[i * 4 + 2] = 255
    data[i * 4 + 3] = alpha[i]
  }
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

func field(_ size: Int, _ inside: (Int, Int) -> Bool) -> [UInt8] {
  var mask = [Bool](repeating: false, count: size * size)
  for y in 0..<size { for x in 0..<size { mask[y * size + x] = inside(x, y) } }
  let scale = Double(size) / Double(side)
  let reach = Int((radius * 1.5) * scale) + 1
  var out = [UInt8](repeating: 0, count: side * side)
  for oy in 0..<side {
    for ox in 0..<side {
      let cx = Int((Double(ox) + 0.5) * scale), cy = Int((Double(oy) + 0.5) * scale)
      let here = mask[min(size - 1, cy) * size + min(size - 1, cx)]
      var best = Double(reach)
      for dy in -reach...reach {
        for dx in -reach...reach {
          let x = cx + dx, y = cy + dy
          let other = (x < 0 || y < 0 || x >= size || y >= size) ? false : mask[y * size + x]
          if other != here { best = min(best, (Double(dx * dx + dy * dy)).squareRoot()) }
        }
      }
      let d = best / scale
      out[oy * side + ox] = encode(here ? -d : d)
    }
  }
  return out
}

for group in groups {
  let rep = NSBitmapImageRep(data: try! Data(contentsOf: URL(fileURLWithPath: "\(dir)/geo-\(group).png")))!
  let w = rep.pixelsWide
  let inner = side - 2 * pad
  let size = side * up
  var cover = [Double](repeating: 0, count: w * w)
  for y in 0..<w {
    for x in 0..<w {
      let c = rep.colorAt(x: x, y: y)!.usingColorSpace(.sRGB)!
      let light = min(c.redComponent, c.greenComponent, c.blueComponent)
      cover[y * w + x] = c.alphaComponent * max(0, min(1, (0.93 - light) / 0.25))
    }
  }
  func sample(_ fx: Double, _ fy: Double) -> Double {
    let x = max(0, min(Double(w - 1), fx)), y = max(0, min(Double(w - 1), fy))
    let x0 = Int(x), y0 = Int(y), x1 = min(w - 1, x0 + 1), y1 = min(w - 1, y0 + 1)
    let tx = x - Double(x0), ty = y - Double(y0)
    let top = cover[y0 * w + x0] * (1 - tx) + cover[y0 * w + x1] * tx
    let bottom = cover[y1 * w + x0] * (1 - tx) + cover[y1 * w + x1] * tx
    return top * (1 - ty) + bottom * ty
  }
  let alpha = field(size) { x, y in
    let u = (Double(x) + 0.5) / Double(up) - Double(pad), v = (Double(y) + 0.5) / Double(up) - Double(pad)
    if u < 0 || v < 0 || u >= Double(inner) || v >= Double(inner) { return false }
    return sample(u * Double(w) / Double(inner) - 0.5, v * Double(w) / Double(inner) - 0.5) >= 0.5
  }
  save(alpha, "\(dir)/geo-sdf-\(group).png")
}

let size = side * up
let centre = Double(size) / 2
let half = Double((side - 2 * pad) * up) / 2
save(field(size) { x, y in
  let corner = half * 0.46
  let dx = max(abs(Double(x) + 0.5 - centre) - (half - corner), 0), dy = max(abs(Double(y) + 0.5 - centre) - (half - corner), 0)
  return (dx * dx + dy * dy).squareRoot() <= corner
}, "\(dir)/geo-sdf-badge.png")
save(field(size) { x, y in
  let corner = half * 0.42
  let dx = max(abs(Double(x) + 0.5 - centre) - (half - corner), 0), dy = max(abs(Double(y) + 0.5 - centre) - (half - corner), 0)
  return (dx * dx + dy * dy).squareRoot() <= corner
}, "\(dir)/geo-sdf-badge-rounded.png")
