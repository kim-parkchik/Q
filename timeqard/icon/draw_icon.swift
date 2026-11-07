// TimeQard のアイコンを描く（Q を丸い時計に見立て、Q の尾を時計の針にする。Q のロゴと同じ、角の丸い四角・同じ色）
// 使い方（Mac で）: swift timeqard/icon/draw_icon.swift timeqard/icon/icon-1024.png
// できた PNG から、OS ごとのアイコンを作る: bun run timeqard:tauri icon icon/icon-1024.png
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let s = CGFloat(size)
let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("描く場所を作れません") }
// 上を y=0 にする（SVG と同じ向き）
ctx.translateBy(x: 0, y: s)
ctx.scaleBy(x: 1, y: -1)

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
}

// 角の丸い四角（Q のロゴ：512 の大きさで角の丸み 90）と、左上から右下への色の移り変わり（#002D62 → #0055A4）
let inset: CGFloat = 40
let rect = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
let radius = rect.width * 90 / 512
ctx.saveGState()
ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
ctx.clip()
let gradient = CGGradient(colorsSpace: cs, colors: [rgb(0x002D62), rgb(0x0055A4)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: rect.minX, y: rect.minY), end: CGPoint(x: rect.maxX, y: rect.maxY), options: [])
ctx.restoreGState()

let white = rgb(0xFFFFFF)
let center = CGPoint(x: s / 2, y: s / 2 - 10)
let ring: CGFloat = 290

// 時計の文字盤（Q の丸）
ctx.setStrokeColor(white)
ctx.setLineWidth(70)
ctx.addEllipse(in: CGRect(x: center.x - ring, y: center.y - ring, width: ring * 2, height: ring * 2))
ctx.strokePath()

// 12・3・6・9 時の目盛り
ctx.setLineCap(.round)
ctx.setLineWidth(30)
for i in 0..<4 {
  let a = CGFloat(i) * .pi / 2
  let inner = ring - 105, outer = ring - 70
  ctx.move(to: CGPoint(x: center.x + sin(a) * inner, y: center.y - cos(a) * inner))
  ctx.addLine(to: CGPoint(x: center.x + sin(a) * outer, y: center.y - cos(a) * outer))
}
ctx.strokePath()

// 短い針（12時の向き）
ctx.setLineWidth(46)
ctx.move(to: center)
ctx.addLine(to: CGPoint(x: center.x, y: center.y - 130))
ctx.strokePath()

// 長い針：右下（4時半の向き）へ、丸の外まで伸ばして Q の尾にする
let tail = CGFloat.pi * 3 / 4 // 12時から時計回りに 135°
let tailLen: CGFloat = ring + 150
ctx.setLineWidth(70)
ctx.move(to: center)
ctx.addLine(to: CGPoint(x: center.x + sin(tail) * tailLen, y: center.y - cos(tail) * tailLen))
ctx.strokePath()

// 真ん中の丸
ctx.setFillColor(white)
ctx.addEllipse(in: CGRect(x: center.x - 52, y: center.y - 52, width: 104, height: 104))
ctx.fillPath()

guard let image = ctx.makeImage() else { fatalError("画像を作れません") }
let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png")
guard let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("書き出せません") }
CGImageDestinationAddImage(dest, image, nil)
if !CGImageDestinationFinalize(dest) { fatalError("書き出せません") }
print("wrote \(out.path)")
