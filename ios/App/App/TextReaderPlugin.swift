import UIKit
import Capacitor
import Vision

/// Reads the text in a picture with Apple's built-in text recognition (on-device, works offline).
/// JS: TextReader.read({ data: <base64 image> }) -> { lines: [{ text, x, y, w, h }] }
/// Boxes are fractions of the image (0..1), measured from the top-left.
@objc(TextReaderPlugin)
public class TextReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TextReaderPlugin"
    public let jsName = "TextReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    @objc func read(_ call: CAPPluginCall) {
        guard var b64 = call.getString("data"), !b64.isEmpty else {
            return call.reject("No picture given")
        }
        if let comma = b64.firstIndex(of: ","), b64.hasPrefix("data:") {
            b64 = String(b64[b64.index(after: comma)...])
        }
        guard let bytes = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: bytes), let cg = image.cgImage else {
            return call.reject("Couldn't open that picture")
        }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)

        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNRecognizeTextRequest { req, err in
                if let err = err { return call.reject("Text reading failed: \(err.localizedDescription)") }
                let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
                let lines: [[String: Any]] = obs.compactMap { o in
                    guard let top = o.topCandidates(1).first else { return nil }
                    let r = o.boundingBox // normalised, bottom-left origin
                    return [
                        "text": top.string,
                        "x": Double(r.minX),
                        "y": Double(1 - r.maxY),
                        "w": Double(r.width),
                        "h": Double(r.height),
                    ]
                }
                call.resolve(["lines": lines])
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:])
            do { try handler.perform([request]) } catch {
                call.reject("Text reading failed: \(error.localizedDescription)")
            }
        }
    }
}

/// The app's web view controller: the standard Capacitor one, plus Trailz's own plugins.
class TrailzBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TextReaderPlugin())
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
