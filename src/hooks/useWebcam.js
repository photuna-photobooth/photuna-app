// src/hooks/useWebcam.js
import { useEffect, useRef } from 'react';

function parseResolution(res) {
  if (!res || typeof res !== 'string') return { width: 1280, height: 720 };
  const [w, h] = res.split('x').map(n => parseInt(n, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return { width: 1280, height: 720 };
  return { width: w, height: h };
}

export default function useWebcam(
  videoRef,
  { resolution = '1280x720', deviceId, facingMode = 'user', onError, flipHorizontal = false } = {}
) {
  const streamRef = useRef(null);

  useEffect(() => {
    const { width, height } = parseResolution(resolution);

    const tryConstraints = async (constraintsList) => {
      for (const c of constraintsList) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: c, audio: false });
          return stream;
        } catch (e) {
          // try next constraint
        }
      }
      throw new Error('All camera constraints failed');
    };

    const constraintsChain = [
      { width: { ideal: width }, height: { ideal: height }, facingMode },
      { width, height, facingMode },                // exact fallback
      { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode },
      { width: { ideal: 640 }, height: { ideal: 480 }, facingMode },
      { facingMode }                                // last resort
    ];

    if (deviceId) {
      constraintsChain.unshift({ deviceId: { exact: deviceId } });
    }

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('getUserMedia not supported. Use HTTPS (or Chrome on localhost).');
        }
        const stream = await tryConstraints(constraintsChain);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // important for iOS Safari
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.muted = true;  // ensure autoplay
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        if (onError) onError(err);
        // eslint-disable-next-line no-console
        console.error('Webcam error:', err);
      }
    };

    start();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [resolution, deviceId, facingMode, videoRef, onError]);

  // optional helper class to flip via CSS
  useEffect(() => {
    if (!videoRef.current) return;
    if (flipHorizontal) {
      videoRef.current.style.transform = 'scaleX(-1)';
    } else {
      videoRef.current.style.transform = '';
    }
  }, [flipHorizontal, videoRef]);
}
