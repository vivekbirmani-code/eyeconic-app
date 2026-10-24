/**
 * Web proctoring engine — camera source.
 *
 * getUserMedia front-camera stream attached to a hidden-but-rendered
 * <video> element (Safari requires the element to be in the DOM and playing
 * for frames to flow). Track lifecycle events surface as camera errors so
 * the engine can classify them (permission revoked mid-quiz, track ended by
 * OS/another app claiming the camera). No pixels ever leave this page —
 * the video feeds the in-page detector only.
 */

export type CameraSourceError =
  | { kind: 'denied' }
  | { kind: 'unavailable'; detail?: string }
  | { kind: 'track-ended' }
  | { kind: 'error'; detail?: string };

export interface WebCameraSource {
  readonly video: HTMLVideoElement;
  start(): Promise<void>;
  /** Registers the mid-stream failure callback (fires at most once). */
  onIssue(cb: (error: CameraSourceError) => void): void;
  stop(): void;
}

/**
 * Bounded wait for the first decodable frame after play() resolves. A
 * GRANTED-but-frameless track (live track, readyState stuck below 2 — seen
 * on some devices right after another stream released the camera) would
 * otherwise leave the engine silently analyzing nothing for the whole
 * attempt; here it surfaces as an honest `unavailable` startup failure the
 * engine records and retries. Diagnostics timing, not policy.
 */
const FIRST_FRAME_TIMEOUT_MS = 5000;

function waitForFirstFrame(video: HTMLVideoElement, timeoutMs = FIRST_FRAME_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2) { resolve(); return; }
    const startedAt = Date.now();
    const poll = window.setInterval(() => {
      if (video.readyState >= 2) {
        window.clearInterval(poll);
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(poll);
        reject(new Error('frames_not_flowing'));
      }
    }, 100);
  });
}

export function createWebCameraSource(): WebCameraSource {
  const video = document.createElement('video');
  // In-DOM but visually absent (NOT display:none — some browsers stall
  // offscreen-video decoding; a 1px transparent layer keeps frames flowing).
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  video.style.position = 'fixed';
  video.style.left = '-9999px';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';

  let stream: MediaStream | null = null;
  let issueCb: ((error: CameraSourceError) => void) | null = null;
  let stopped = false;

  return {
    video,
    onIssue(cb) {
      issueCb = cb;
    },
    async start() {
      stopped = false;
      document.body.appendChild(video);
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (stopped) {
        // stop() ran while the permission prompt was up — this stream is
        // post-teardown; kill it so the camera never lingers after unmount.
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = media;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (!stopped && issueCb) issueCb({ kind: 'track-ended' });
        });
      });
      video.srcObject = stream;
      try {
        await video.play();
        // A resolved play() does NOT guarantee frames are being pumped to
        // the element — verify the first frame actually arrives (see
        // waitForFirstFrame) so a frameless grant fails loudly, not silently.
        await waitForFirstFrame(video);
      } catch (err) {
        // The stream we may have grabbed is not usable — release it before
        // surfacing the failure so a retry starts from a clean device state.
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
        video.srcObject = null;
        if (stopped) return;
        if (err instanceof Error && err.message === 'frames_not_flowing') {
          throw { kind: 'unavailable', detail: 'frames_not_flowing' } as CameraSourceError;
        }
        throw err;
      }
    },
    stop() {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      video.srcObject = null;
      video.remove();
    },
  };
}

/** Maps a getUserMedia failure to the coarse camera-source error kinds. */
export function classifyGetUserMediaError(err: unknown): CameraSourceError {
  // A rethrown CameraSourceError (start()'s own failure taxonomy) passes
  // through unchanged.
  if (typeof err === 'object' && err !== null && typeof (err as CameraSourceError).kind === 'string') {
    return err as CameraSourceError;
  }
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return { kind: 'denied' };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') {
    return { kind: 'unavailable', detail: name };
  }
  return { kind: 'error', detail: name || String(err) };
}
