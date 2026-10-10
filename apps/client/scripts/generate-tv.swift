import AVFoundation
import AppKit
import CoreVideo

/// Builds the four original lounge-TV channel clips. Not recordings of real shows.
let outDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "public/tv", isDirectory: true)
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

struct Channel {
  let file: String
  let title: String
  let subtitle: String
  let speech: String
  let red: CGFloat
  let green: CGFloat
  let blue: CGFloat
}

let channels = [
  Channel(file: "news", title: "VILLA NEWS", subtitle: "The house is live tonight", speech: "Villa News. Good evening. The house is live tonight.", red: 0.0, green: 0.28, blue: 0.18),
  Channel(file: "pitch", title: "PITCH DAY", subtitle: "Kickoff on the green", speech: "Pitch Day. The field is green. Kickoff is now.", red: 0.05, green: 0.35, blue: 0.12),
  Channel(file: "market", title: "MARKET HOUR", subtitle: "Tomatoes, peppers, and yams", speech: "Market Hour. Tomatoes, peppers, and yams.", red: 0.45, green: 0.22, blue: 0.08),
  Channel(file: "film", title: "THE VILLA", subtitle: "Tonight's film", speech: "Tonight's film. The Villa. Stay in your seats.", red: 0.08, green: 0.06, blue: 0.12),
]

let width = 640
let height = 360
let fps: Int32 = 12
let frames = 96

for channel in channels {
  let silent = outDir.appendingPathComponent("\(channel.file)-silent.mov")
  let speech = outDir.appendingPathComponent("\(channel.file).aiff")
  let final = outDir.appendingPathComponent("\(channel.file).mp4")
  try writeVideo(channel, to: silent)
  let say = Process()
  say.executableURL = URL(fileURLWithPath: "/usr/bin/say")
  say.arguments = ["-o", speech.path, channel.speech]
  try say.run()
  say.waitUntilExit()
  try mux(video: silent, audio: speech, to: final)
  try? FileManager.default.removeItem(at: silent)
  try? FileManager.default.removeItem(at: speech)
  print("wrote \(final.path)")
}

func writeVideo(_ channel: Channel, to url: URL) throws {
  if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
  let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
  ])
  input.expectsMediaDataInRealTime = false
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
  ])
  writer.add(input)
  writer.startWriting()
  writer.startSession(atSourceTime: .zero)
  let frame = CMTime(value: 1, timescale: fps)
  for i in 0..<frames {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
    guard let pool = adaptor.pixelBufferPool else { break }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
    if let buffer {
      draw(channel, frame: i, into: buffer)
      adaptor.append(buffer, withPresentationTime: CMTimeMultiply(frame, multiplier: Int32(i)))
    }
  }
  input.markAsFinished()
  let done = DispatchSemaphore(value: 0)
  writer.finishWriting { done.signal() }
  done.wait()
  if writer.status != .completed { throw writer.error ?? NSError(domain: "tv", code: 1) }
}

func draw(_ channel: Channel, frame index: Int, into buffer: CVPixelBuffer) {
  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
  guard let ctx = CGContext(
    data: CVPixelBufferGetBaseAddress(buffer),
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
  ) else { return }
  ctx.setFillColor(red: channel.red, green: channel.green, blue: channel.blue, alpha: 1)
  ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
  let stripe = CGFloat(index % 40) / 40
  ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
  ctx.fill(CGRect(x: 0, y: 0, width: CGFloat(width) * stripe, height: 18))
  ctx.setFillColor(red: 0, green: 0.53, blue: 0.32, alpha: 1)
  ctx.fill(CGRect(x: 0, y: height - 28, width: width / 3, height: 28))
  ctx.setFillColor(gray: 1, alpha: 1)
  ctx.fill(CGRect(x: width / 3, y: height - 28, width: width / 3, height: 28))
  ctx.setFillColor(red: 0, green: 0.53, blue: 0.32, alpha: 1)
  ctx.fill(CGRect(x: 2 * width / 3, y: height - 28, width: width / 3, height: 28))
  let image = ctx.makeImage()!
  let rep = NSBitmapImageRep(cgImage: image)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let title = NSAttributedString(string: channel.title, attributes: [
    .font: NSFont.boldSystemFont(ofSize: 54),
    .foregroundColor: NSColor.white,
  ])
  let sub = NSAttributedString(string: channel.subtitle, attributes: [
    .font: NSFont.systemFont(ofSize: 28),
    .foregroundColor: NSColor.white,
  ])
  title.draw(at: NSPoint(x: 48, y: 150))
  sub.draw(at: NSPoint(x: 48, y: 100))
  NSGraphicsContext.restoreGraphicsState()
  if let painted = rep.cgImage {
    ctx.draw(painted, in: CGRect(x: 0, y: 0, width: width, height: height))
  }
}

func mux(video: URL, audio: URL, to url: URL) throws {
  if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
  let mix = AVMutableComposition()
  let vAsset = AVURLAsset(url: video)
  let aAsset = AVURLAsset(url: audio)
  let vTrack = mix.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
  let aTrack = mix.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
  let vSrc = vAsset.tracks(withMediaType: .video)[0]
  try vTrack?.insertTimeRange(CMTimeRange(start: .zero, duration: vAsset.duration), of: vSrc, at: .zero)
  if let aSrc = aAsset.tracks(withMediaType: .audio).first {
    let dur = CMTimeMinimum(aAsset.duration, vAsset.duration)
    try aTrack?.insertTimeRange(CMTimeRange(start: .zero, duration: dur), of: aSrc, at: .zero)
  }
  guard let exp = AVAssetExportSession(asset: mix, presetName: AVAssetExportPreset640x480) else { throw NSError(domain: "tv", code: 2) }
  exp.outputURL = url
  exp.outputFileType = .mp4
  let done = DispatchSemaphore(value: 0)
  exp.exportAsynchronously { done.signal() }
  done.wait()
  if exp.status != .completed { throw exp.error ?? NSError(domain: "tv", code: 3) }
}
