// PDF のページを画像にして、macOS の文字認識（Vision）で字と位置を読む（追加のインストールは要らない）
//
// 使い方:
//   swift scripts/pdf_ocr.swift <PDF> [ページ] > <出力のテキスト>
//
// ・字が「字の形の線」で描かれていて、PDFKit では字を取り出せない PDF（厚生労働省の労災保険率表など）を読むのに使う
// ・ページの区切りに「=== page N ===」を入れる
// ・1行に1つのまとまり：「左の位置<TAB>下の位置<TAB>幅<TAB>高さ<TAB>字」（位置はページの左下からの pt。pdf_to_chars.swift と同じ）
// ・読み違いがありうるので、使う側（scripts/import_rousai_rates.py）で、ほかの公式の資料と見比べて確かめる
import AppKit
import Foundation
import PDFKit
import Vision

let args = CommandLine.arguments
guard args.count == 2 || args.count == 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("使い方: swift scripts/pdf_ocr.swift <PDF> [ページ]\n".data(using: .utf8)!)
    exit(1)
}
let pages: [Int] = args.count == 3 ? [Int(args[2]) ?? 1] : Array(1...doc.pageCount)
for no in pages {
    guard let page = doc.page(at: no - 1) else { continue }
    print("=== page \(no) ===")
    let box = page.bounds(for: .mediaBox)
    // 4倍の大きさの画像にして読む（小さい字も読めるように）
    let scale: CGFloat = 4
    let image = page.thumbnail(of: NSSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
    guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let cg = rep.cgImage else {
        FileHandle.standardError.write("\(no) ページを画像にできません\n".data(using: .utf8)!)
        exit(2)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLanguages = ["ja-JP"]
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
    for obs in request.results ?? [] {
        guard let top = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox
        print(String(format: "%.1f\t%.1f\t%.1f\t%.1f\t", b.origin.x * box.width, b.origin.y * box.height, b.width * box.width, b.height * box.height)
            + top.string.replacingOccurrences(of: "\t", with: " "))
    }
}
