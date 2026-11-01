// PDF の各ページの文字を取り出す（macOS の PDFKit を使う。追加のインストールは要らない）
//
// 使い方:
//   swift scripts/pdf_to_text.swift <PDF> > <出力のテキスト>
//
// ・ページの区切りに「=== page N ===」を入れる
// ・文字を取り出せないページ（画像だけのページ）は空になる
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count == 2, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("使い方: swift scripts/pdf_to_text.swift <PDF>\n".data(using: .utf8)!)
    exit(1)
}
for i in 0..<doc.pageCount {
    print("=== page \(i + 1) ===")
    print(doc.page(at: i)?.string ?? "")
}
