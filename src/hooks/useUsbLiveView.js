// src/hooks/useUsbLiveView.js
//
// Shows the USB camera's shared live view (services/usbLiveView.js) in a canvas.
// Pass a canvas ref to draw into it, or null just to keep live view running (the
// template screen does this so the photo screen's preview is ready at once).
// Returns { active, failed }: active once frames arrive, failed when live view is
// unavailable and the screen should use the webcam instead.

import { useEffect, useState } from "react";
import { subscribeUsbLiveView } from "../services/usbLiveView";

export default function useUsbLiveView(enabled, canvasRef) {
  const [state, setState] = useState({ active: false, failed: false });

  useEffect(() => {
    if (!enabled) {
      setState({ active: false, failed: false });
      return undefined;
    }

    return subscribeUsbLiveView({
      onState: (next) => setState({ active: next.active, failed: next.failed }),
      onFrame: (bitmap) => {
        const canvas = canvasRef?.current;
        if (!canvas) return;
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      },
    });
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
