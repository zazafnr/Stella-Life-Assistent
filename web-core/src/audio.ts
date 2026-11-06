// Sprachnachrichten aufnehmen (MediaRecorder). Chrome/Firefox/Electron liefern webm/opus, Safari mp4.
// Höchstens 2 Minuten – danach stoppt die Aufnahme von selbst.

export const MAX_SECONDS = 120;

export interface Recording {
  /** Aufnahme beenden und die Datei bekommen */
  finish: () => Promise<{ blob: Blob; seconds: number }>;
  /** Aufnahme verwerfen */
  cancel: () => void;
  /** Lautstärke 0–1 für die Pegelanzeige */
  level: () => number;
}

export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export async function startRecording(onAutoStop?: () => void): Promise<Recording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    throw new Error('Ich darf das Mikrofon nicht benutzen. Erlaube es in den Einstellungen des Browsers bzw. der App.');
  }
  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const startedAt = Date.now();
  rec.start(250);

  // Pegel: AnalyserNode auf dem Mikrofon
  let level = 0;
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const meter = setInterval(() => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }, 80);
  const auto = setTimeout(() => onAutoStop?.(), MAX_SECONDS * 1000);

  const release = () => {
    clearInterval(meter);
    clearTimeout(auto);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };

  return {
    level: () => level,
    cancel: () => { try { rec.stop(); } catch { /* schon gestoppt */ } release(); },
    finish: () => new Promise((resolve, reject) => {
      rec.onstop = () => {
        release();
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
        blob.size > 200 ? resolve({ blob, seconds: Math.min(MAX_SECONDS, Math.round((Date.now() - startedAt) / 1000)) }) : reject(new Error('Die Aufnahme ist leer geblieben.'));
      };
      try { rec.stop(); } catch (err) { release(); reject(err as Error); }
    }),
  };
}
