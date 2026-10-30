import AVFoundation
import Observation

/** Sprachnachricht aufnehmen: gedrückt halten, loslassen zum Senden, wischen zum Abbrechen.
    m4a (AAC) in Sprachqualität – klein genug für 2 Minuten, Whisper versteht das gut. */
@MainActor
@Observable
final class VoiceRecorder {
    struct Recorded {
        var url: URL
        var seconds: Int
    }

    static let maxSeconds = 120

    var isRecording = false
    var seconds = 0
    /** Lautstärke 0–1 für die Pegelanzeige */
    var level: Double = 0
    /** Mikrofon in iOS nicht erlaubt */
    var denied = false
    /** Aufnahme war zu kurz (Antippen statt Halten) */
    var tooShort = false

    @ObservationIgnored var onLimit: (() -> Void)?
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var url: URL?
    /** Finger schon wieder oben, bevor die Aufnahme (nach der Erlaubnis-Frage) überhaupt lief */
    @ObservationIgnored private var released = false

    func begin() {
        guard !isRecording else { return }
        isRecording = true
        released = false
        tooShort = false
        seconds = 0
        level = 0
        Task { await startEngine() }
    }

    private func startEngine() async {
        guard await AVAudioApplication.requestRecordPermission() else {
            isRecording = false
            denied = true
            return
        }
        if released {
            isRecording = false
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("sprache-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC), AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32_000,
            ]
            let r = try AVAudioRecorder(url: file, settings: settings)
            r.isMeteringEnabled = true
            guard r.record() else { isRecording = false; return }
            recorder = r
            url = file
            timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
        } catch {
            isRecording = false
        }
    }

    private func tick() {
        guard let r = recorder else { return }
        r.updateMeters()
        level = max(0, min(1, Double(r.averagePower(forChannel: 0) + 50) / 50))
        seconds = Int(r.currentTime)
        if seconds >= Self.maxSeconds { onLimit?() }
    }

    /** Aufnahme beenden. `cancel`: verwerfen. Gibt die Datei zurück, wenn etwas zu senden ist. */
    func end(cancel: Bool) -> Recorded? {
        released = true
        guard isRecording else { return nil }
        isRecording = false
        timer?.invalidate()
        timer = nil
        guard let r = recorder, let file = url else { return nil }
        let secs = Int(r.currentTime.rounded())
        r.stop()
        recorder = nil
        url = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if cancel || secs < 1 {
            try? FileManager.default.removeItem(at: file)
            tooShort = !cancel
            return nil
        }
        return Recorded(url: file, seconds: secs)
    }
}

/** Spielt eine Sprachnachricht vom Server ab (die Datei braucht den Login, also erst laden) */
@MainActor
@Observable
final class VoicePlayback: NSObject, AVAudioPlayerDelegate {
    var isPlaying = false
    var loading = false
    var failed = false
    @ObservationIgnored private var player: AVAudioPlayer?

    func toggle(id: String) async {
        if let p = player {
            if p.isPlaying { p.pause(); isPlaying = false } else { p.play(); isPlaying = true }
            return
        }
        loading = true
        defer { loading = false }
        do {
            let data = try await API.shared.file(id)
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
            let p = try AVAudioPlayer(data: data, fileTypeHint: "m4a")
            p.delegate = self
            player = p
            p.play()
            isPlaying = true
        } catch {
            failed = true
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.isPlaying = false }
    }
}
