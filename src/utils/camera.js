// src/utils/camera.js
export async function initCamera(videoRef) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 1920, height: 1080 },
    audio: false,
  });
  if (videoRef.current) videoRef.current.srcObject = stream;
  return stream;
}

export function capturePhoto(videoRef, canvasRef, frameUrl = null) {
  const video = videoRef.current;
  const canvas = canvasRef.current;
  const ctx = canvas.getContext("2d");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  if (frameUrl) {
    const img = new Image();
    img.src = frameUrl;
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/png");
}

export function stopCamera(stream) {
  stream.getTracks().forEach((track) => track.stop());
}
