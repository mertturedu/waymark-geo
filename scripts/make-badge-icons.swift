import AppKit

let side = 64
let pad = 8
let radius = 8.0
let up = 4
let size = side * up
let holeFloor = 0.5
let glyphPx = 30.0

func encode(_ d: Double) -> UInt8 {
  UInt8(max(0, min(255, (255 - 255 * (d / radius + 0.25)).rounded())))
}

func glyphMask(_ path: String) -> [Bool] {
  guard let image = NSImage(contentsOfFile: path) else { fatalError("svg okunamadı: \(path)") }
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSColor.clear.set()
  NSRect(x: 0, y: 0, width: size, height: size).fill(using: .copy)
  let g = glyphPx * Double(up)
  image.draw(in: NSRect(x: (Double(size) - g) / 2, y: (Double(size) - g) / 2, width: g, height: g))
  NSGraphicsContext.restoreGraphicsState()
  var mask = [Bool](repeating: false, count: size * size)
  for y in 0..<size { for x in 0..<size { mask[y * size + x] = (rep.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.5 } }
  return mask
}

func badge(_ glyph: [Bool]) -> [UInt8] {
  let centre = Double(size) / 2
  let half = Double((side - 2 * pad) * up) / 2
  var disc = [Bool](repeating: false, count: size * size)
  var fill = [Bool](repeating: false, count: size * size)
  for y in 0..<size {
    for x in 0..<size {
      let dx = Double(x) + 0.5 - centre, dy = Double(y) + 0.5 - centre
      let inside = (dx * dx + dy * dy).squareRoot() <= half
      disc[y * size + x] = inside
      fill[y * size + x] = inside && !glyph[y * size + x]
    }
  }
  let scale = Double(size) / Double(side)
  let reach = Int(radius * 1.5 * scale) + 1
  var out = [UInt8](repeating: 0, count: side * side)
  for oy in 0..<side {
    for ox in 0..<side {
      let cx = min(size - 1, Int((Double(ox) + 0.5) * scale)), cy = min(size - 1, Int((Double(oy) + 0.5) * scale))
      let here = fill[cy * size + cx]
      var best = Double(reach)
      for dy in -reach...reach {
        for dx in -reach...reach {
          let x = cx + dx, y = cy + dy
          let other = (x < 0 || y < 0 || x >= size || y >= size) ? false : fill[y * size + x]
          if other != here { best = min(best, Double(dx * dx + dy * dy).squareRoot()) }
        }
      }
      let d = best / scale
      var alpha = encode(here ? -d : d)
      if disc[cy * size + cx] && glyph[cy * size + cx] { alpha = max(alpha, UInt8(holeFloor * 255)) }
      out[oy * side + ox] = alpha
    }
  }
  return out
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

func saveLegend(_ mask: [Bool], _ path: String) {
  let out = 48
  let g = Int(glyphPx) * up
  let origin = (size - g) / 2
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: out, pixelsHigh: out, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: out * 4, bitsPerPixel: 32)!
  let data = rep.bitmapData!
  let block = Double(g) / Double(out)
  for oy in 0..<out {
    for ox in 0..<out {
      var hits = 0, total = 0
      let x0 = origin + Int(Double(ox) * block), x1 = origin + Int(Double(ox + 1) * block)
      let y0 = origin + Int(Double(oy) * block), y1 = origin + Int(Double(oy + 1) * block)
      for y in y0..<max(y1, y0 + 1) { for x in x0..<max(x1, x0 + 1) { total += 1; if mask[y * size + x] { hits += 1 } } }
      let i = (oy * out + ox) * 4
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = UInt8(255 * hits / max(total, 1))
    }
  }
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

let outDir = CommandLine.arguments[1]
for pair in CommandLine.arguments.dropFirst(2) {
  let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
  if parts[0].hasPrefix("legend-") {
    saveLegend(glyphMask(parts[1]), "\(outDir)/\(parts[0]).png")
  } else {
    save(badge(glyphMask(parts[1])), "\(outDir)/geo-badge-\(parts[0]).png")
  }
}
