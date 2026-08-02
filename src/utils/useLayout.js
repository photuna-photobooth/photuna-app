import { useState, useEffect } from "react";

function measure() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isPortrait = h > w;
  const short = Math.min(w, h);

  // Portrait resolution support:
  //   Min: 1080px wide (1080×1920 FHD portrait) for dedicated kiosk displays
  //   Tablets (iPad) in portrait are narrower but are valid — don't block them.
  const isUnsupported = isPortrait && short < 1080 && w < 768;

  // 2K tier: QHD (1440×2560) and 2K (1920×2880) — larger grids / fonts.
  const isPortrait2K = isPortrait && short >= 1440;

  // Landscape tablet: iPad-sized in landscape only (not relevant for portrait kiosk).
  const isTablet = !isPortrait && short >= 550 && short < 1080;

  return {
    isPortrait,
    isLandscape: !isPortrait,
    isTablet,
    isUnsupported,
    isPortrait2K,
    vw: w,
    vh: h,
  };
}

export function useLayout() {
  const [state, setState] = useState(measure);
  useEffect(() => {
    const update = () => setState(measure());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return state;
}
