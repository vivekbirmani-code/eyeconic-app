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
      await video.play();
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
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return { kind: 'denied' };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') {
    return { kind: 'unavailable', detail: name };
  }
  return { kind: 'error', detail: name || String(err) };
}
