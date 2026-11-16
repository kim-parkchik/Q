// PDF の各ページの字のまとまり（行）と、その位置を取り出す（macOS の PDFKit を使う。追加のインストールは要らない）
//
// 使い方:
//   swift scripts/pdf_to_chars.swift <PDF> [初めのページ 終わりのページ] > <出力のテキスト>
//
// ・ページの区切りに「=== page N ===」を入れる
// ・1行に1つのまとまり：「左の位置<TAB>下の位置<TAB>幅<TAB>高さ<TAB>字」（位置はページの左下からの pt）
// ・表の枠がつながっていて、字の並び（pdf_to_text.swift）では列がわからない表を、字の位置で列に分けて読むのに使う
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count == 2 || args.count == 4, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("使い方: swift scripts/pdf_to_chars.swift <PDF> [初めのページ 終わりのページ]\n".data(using: .utf8)!)
    exit(1)
}
let first = args.count == 4 ? max(1, Int(args[2]) ?? 1) : 1
let last = args.count == 4 ? min(doc.pageCount, Int(args[3]) ?? doc.pageCount) : doc.pageCount
if first <= last {
    for no in first...last {
        print("=== page \(no) ===")
        guard let page = doc.page(at: no - 1), let all = page.selection(for: page.bounds(for: .mediaBox)) else { continue }
        for line in all.selectionsByLine() {
            guard let text = line.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { continue }
            let b = line.bounds(for: page)
            print(String(format: "%.1f\t%.1f\t%.1f\t%.1f\t", b.origin.x, b.origin.y, b.size.width, b.size.height)
                + text.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\t", with: " "))
        }
    }
}
