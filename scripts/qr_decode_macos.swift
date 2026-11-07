import CoreImage
import Foundation
import Vision

// QR コードの画像を、Mac に入っている読み取り（CoreImage と Vision）で読む（src/utils/qrCode.ts の確かめに使う）
// 使い方: swiftc -O scripts/qr_decode_macos.swift -o /tmp/qr_decode && /tmp/qr_decode a.png b.png ...
//        （ふつうは bun scripts/verify_qr_macos.ts から呼ぶ）
// 1行に「ファイル名<TAB>CoreImage の結果<TAB>Vision の結果」を出す（読めなければ「-」）
let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    var ci = "-"
    if let image = CIImage(contentsOf: url),
       let feature = detector.features(in: image).first as? CIQRCodeFeature,
       let message = feature.messageString {
        ci = message
    }
    var vision = "-"
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    let handler = VNImageRequestHandler(url: url, options: [:])
    if (try? handler.perform([request])) != nil,
       let observation = request.results?.first,
       let payload = observation.payloadStringValue {
        vision = payload
    }
    print("\(url.lastPathComponent)\t\(ci)\t\(vision)")
}
