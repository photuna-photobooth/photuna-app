
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

/* ------------------------------- Helpers ------------------------------- */
function getBridge() {
  if (typeof window === "undefined") return null;
  return window.api ?? window.electron ?? null;
}

function normalizeToFileUrl(raw) {
  if (!raw) return raw;
  if (typeof raw === "string" && raw.startsWith("data:")) return raw;

  let p = String(raw).replace(/\\/g, "/");
  if (p.startsWith("file:")) {
    p = "file:///" + p.replace(/^file:\/+/, "").replace(/^\/+/, "");
    return encodeURI(p);
  }
  if (p.startsWith("/")) return encodeURI("file://" + p);
  if (/^[A-Za-z]:\//.test(p)) return encodeURI("file:///" + p);
  return encodeURI("file:///" + p.replace(/^\/+/, ""));
}

function loadGoogleFont(fontName) {
  if (!fontName || typeof document === "undefined") return;
  const id = `google-font-${fontName.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;

  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(
    /\s+/g,
    "+"
  )}:wght@300;400;600;700&display=swap`;
  document.head.appendChild(link);
}

/**
 * PaymentScreen (AdminDashboard-aligned)
 *
 * Props:
 * - event (preferred): object from AdminDashboard
 * - eventId (optional): ID to fetch event via window.api.getEvents()
 * - appearance (optional): external appearance override
 * - onCancel, onNext, onSuccess
 * - amountDue (fallback for legacy-only scenarios)
 */
export default function PaymentScreen({
  event = null,
  eventId = null,
  appearance = {},
  onCancel = () => { },
  onNext = () => { },
  onBack = () => { },
  onSuccess = null,
  amountDue = 150,
}) {
  const api = getBridge();

  /* --------------------- Global fallbacks if no event prop --------------------- */
  const [globalAppearance, setGlobalAppearance] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);
  const [loadedEvent, setLoadedEvent] = useState(event ?? null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!api) return;

        // Fetch event by id when not supplied as prop
        if (!event && eventId && api.getEvents) {
          const all = await api.getEvents();
          const found = Array.isArray(all)
            ? all.find((e) => String(e.id) === String(eventId))
            : null;
          if (mounted && found) setLoadedEvent(found);
        }

        // Global appearance/settings fallbacks
        if (api.getAppearance) {
          const a = await api.getAppearance();
          if (mounted) setGlobalAppearance(a ?? null);
        }
        if (api.getSettings) {
          const s = await api.getSettings();
          if (mounted) setGlobalSettings(s ?? null);
        }
      } catch (err) {
        console.warn("PaymentScreen: load fallbacks failed", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [api, event, eventId]);

  const currentEvent = loadedEvent ?? event ?? null;

  /* ------------------------------- Appearance ------------------------------- */
  const evApp = currentEvent?.appearance ?? {};
  const gApp = globalAppearance ?? {};
  const mergedAppearance = {
    headerFont: evApp.headerFont ?? appearance.headerFont ?? gApp.headerFont ?? "Ramillas",
    generalFont: evApp.generalFont ?? appearance.generalFont ?? gApp.generalFont ?? "Interphases",
    headerFontColor: evApp.headerFontColor ?? appearance.headerFontColor ?? gApp.headerFontColor ?? "#000000",
    generalFontColor: evApp.generalFontColor ?? appearance.generalFontColor ?? gApp.generalFontColor ?? "#000000",
    bgColor: evApp.bgColor ?? appearance.bgColor ?? gApp.bgColor ?? "#ffffff",
    boothName: evApp.boothName ?? appearance.boothName ?? gApp.boothName ?? "",
    boothSlogan: evApp.boothSlogan ?? appearance.boothSlogan ?? gApp.boothSlogan ?? "",
    logoUrl: evApp.logoPath ?? appearance.logoPath ?? gApp.logoPath ?? null,
    backgroundMediaUrl:
      evApp.backgroundMediaPath ?? appearance.backgroundMediaPath ?? gApp.backgroundMediaPath ?? null,
    buttonBgColor: evApp.buttonBgColor ?? appearance.buttonBgColor ?? gApp.buttonBgColor ?? "#2563eb",
    buttonHoverColor: evApp.buttonHoverColor ?? appearance.buttonHoverColor ?? gApp.buttonHoverColor ?? "#1e40af",
    buttonFont: evApp.buttonFont ?? appearance.buttonFont ?? gApp.buttonFont ?? "Interphases",
    buttonFontColor: evApp.buttonFontColor ?? appearance.buttonFontColor ?? gApp.buttonFontColor ?? "#ffffff",
  };

  const {
    headerFont,
    generalFont,
    headerFontColor,
    generalFontColor,
    bgColor,
    boothName,
    boothSlogan,
    logoUrl: rawLogoUrl,
    backgroundMediaUrl: rawBackgroundUrl,
    buttonBgColor,
    buttonHoverColor,
    buttonFont,
    buttonFontColor,
  } = mergedAppearance;

  // Normalize file/data URLs and load fonts
  const logoUrl = rawLogoUrl ? normalizeToFileUrl(rawLogoUrl) : null;
  const backgroundMediaUrl = rawBackgroundUrl ? normalizeToFileUrl(rawBackgroundUrl) : null;

  useEffect(() => {
    loadGoogleFont(headerFont);
    loadGoogleFont(generalFont);
    loadGoogleFont(buttonFont);
  }, [headerFont, generalFont, buttonFont]);

  /* ------------------------------- Settings ------------------------------- */
  const numberOfShots = currentEvent?.settings?.numberOfShots ?? 1;

  const appMode = currentEvent?.settings?.appMode ?? globalSettings?.appMode ?? "business";
  const business = currentEvent?.settings?.business ?? globalSettings?.business ?? {};
  const paymentEnabled = business?.paymentEnabled ?? (appMode === "business");

  /* ------------------------------- Language ------------------------------- */
  const langRaw = currentEvent?.settings?.language ?? globalSettings?.language ?? "en";
  const isTagalog =
    ["tagalog", "tl", "filipino"].includes(String(langRaw).toLowerCase());

  const t = {
    titleChoose: isTagalog ? "Piliin ang" : "Choose",
    titlePaymentOption: isTagalog ? "Paraan ng Bayad" : "Payment Option",
    hintProceed: isTagalog
      ? "Kapag kumpleto na ang bayad, tutuloy ka sa photo section."
      : "Once your payment is complete, you'll move on to the photo section, where you'll have a set amount of time to capture your photos.",
    nonRefundable: isTagalog
      ? "Ang mga bayad ay hindi na maibabalik. Kapag matagumpay, kumpletuhin ang buong photobooth experience."
      : "Please note that payments are non-refundable. Once your payment is successful, we invite you to enjoy and complete the full photo booth experience.",
    backToTemplates: isTagalog ? "Bumalik sa Template Screen" : "Back to Template Screen",
    totalAmount: isTagalog ? "Kabuuang halaga" : "Total amount",
    cashTitle: isTagalog ? "Bayad" : "Payment",
    cashInstruction: isTagalog
      ? "Maghulog ng pera sa dispenser. Awtomatikong magpapatuloy kapag umabot sa kinakailangang halaga."
      : "Insert cash into the dispenser. The flow auto-continues once the required amount is reached.",
    back: isTagalog ? "← Balik" : "← Back",
    qrTitle: isTagalog ? "Bayad" : "Payment",
    qrInstruction: isTagalog
      ? "I-scan ang QR code gamit ang banking app para magbayad ng kabuuang halaga."
      : "Scan the QR code with your banking app to pay the total amount.",
    paymentConfirmed: isTagalog ? "Nakumpirma ang bayad" : "Payment confirmed",
    processingCash: isTagalog ? "Pinoproseso ang bayad sa cash..." : "Processing cash payment...",
    recorded: isTagalog ? "Naitala ang bayad" : "Payment recorded",
    completeNotPersisted: isTagalog ? "Kumpleto ang bayad (hindi naitala)" : "Payment complete (not persisted)",
    selectMethod: isTagalog ? "Pumili ng paraan ng bayad upang magpatuloy" : "Select a payment method to continue",
    externalConfirm: isTagalog ? "Kumpirmahin ang bayad" : "Confirm payment received",
    attendantConfirm: isTagalog
      ? "Dapat kumpirmahin ng operator ang bayad bago magsimula ang session."
      : "An operator should confirm the payment before starting the session.",
    tipQR: isTagalog
      ? "Gamitin ang merchant QR ng booth at kumpirmahin kapag natanggap na ang bayad."
      : "Use the booth's merchant QR and confirm only after the payment is received.",
    timeoutReturn: isTagalog ? "Natapos ang oras. Babalik sa main screen..." : "Time expired. Returning to main screen...",
    rentalSkip: isTagalog ? "Walang bayad sa Rental mode. Tutuloy tayo..." : "No payment required in Rental mode. Proceeding...",
    discountLabel: isTagalog ? "Discount code (opsyonal)" : "Discount code (optional)",
    discountApply: isTagalog ? "I-apply" : "Apply",
    discountInvalid: isTagalog ? "Hindi wasto ang discount code" : "Invalid discount code",
    discountApplied: isTagalog ? "Nailapat ang discount" : "Discount applied",
    proceed: isTagalog ? "Magpatuloy" : "Proceed",
    processing: isTagalog ? "Pinoproseso..." : "Processing...",
    amountDueLabel: isTagalog ? "Kabuuang babayaran: " : "Amount Due: ",
  };

  const providers = {
    gcash: !!business?.payment?.providers?.gcash,
    paypal: !!business?.payment?.providers?.paypal,
    stripe: !!business?.payment?.providers?.stripe,
    cash: !!business?.payment?.providers?.cash,
  };
  const noProviders = !providers.cash && !providers.gcash && !providers.paypal && !providers.stripe;

  // If payment is enabled but there's nothing to pick, auto-skip with a notice
  useEffect(() => {
    if (paymentEnabled && noProviders) {
      setMessage(isTagalog ? "Walang naka-enable na payment provider. Lalaktawan..." : "No payment providers are enabled. Skipping...");
      const tid = setTimeout(() => onNext(), 800);
      return () => clearTimeout(tid);
    }
  }, [paymentEnabled, noProviders, onNext, isTagalog]);

  const pricingModel =
    business?.pricing?.model ??
    (currentEvent?.settings?.price != null ? "perSession" : "perSession");
  const pricePerSession = business?.pricing?.pricePerSession ?? null;
  const pricePerPhoto = business?.pricing?.pricePerPhoto ?? null;
  const legacyPrice = currentEvent?.settings?.price ?? null;
  const currency = business?.pricing?.currency ?? globalSettings?.business?.pricing?.currency ?? "PHP";
  const taxEnabled = business?.pricing?.taxEnabled ?? false;
  const taxRate = business?.pricing?.taxRate ?? 0;
  const discountList = Array.isArray(business?.pricing?.discountCodes)
    ? business.pricing.discountCodes
    : [];

  // Timer: event → global → default (20s)
  const resolvedTimer =
    currentEvent?.settings?.screenTimers?.payment ??
    globalSettings?.screenTimers?.payment ??
    20;

  /* ------------------------------- Currency ------------------------------- */
  const currencySymbol = (cur) => (cur === "USD" ? "$" : cur === "EUR" ? "€" : "₱");
  const fmt = (amt) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency === "PHP" ? "PHP" : currency,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amt);
    } catch {
      return `${currencySymbol(currency)} ${Number(amt).toFixed(2)}`;
    }
  };

  /* ----------------------- Price (subtotal → discount → tax) ----------------------- */
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState(null); // {code, percent? , amount?}

  const subtotal = useMemo(() => {
    // prefer business fields; fallback to legacy price or amountDue
    if (pricingModel === "perPhoto") {
      // If you price per print/photo, multiply by numberOfShots by default.
      // Adjust here if you count per-template slots instead.
      const unit =
        (pricePerPhoto != null ? Number(pricePerPhoto) : null) ??
        (legacyPrice != null ? Number(legacyPrice) : Number(amountDue));
      return Math.max(0, unit);
    }
    // perSession
    const unit =
      (pricePerSession != null ? Number(pricePerSession) : null) ??
      (legacyPrice != null ? Number(legacyPrice) : Number(amountDue));
    return Math.max(0, unit);
  }, [pricingModel, pricePerSession, pricePerPhoto, legacyPrice, numberOfShots, amountDue]);

  const discounted = useMemo(() => {
    if (!appliedDiscount) return subtotal;
    const { percent, amount } = appliedDiscount;
    if (percent != null) {
      return Math.max(0, subtotal * (1 - Number(percent) / 100));
    }
    if (amount != null) {
      return Math.max(0, subtotal - Number(amount));
    }
    return subtotal;
  }, [subtotal, appliedDiscount]);

  const total = useMemo(() => {
    if (!taxEnabled) return discounted;
    const rate = Math.max(0, Number(taxRate) || 0);
    return discounted * (1 + rate / 100);
  }, [discounted, taxEnabled, taxRate]);

  /* ------------------------------- Flow/UI state ------------------------------- */
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(resolvedTimer);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(null);

  const paymentSlides = [
    providers.gcash && { key: "qr", label: "GCash QR" },
    providers.cash && { key: "cash", label: "Cash" },
    providers.paypal && { key: "paypal", label: "PayPal" },
    providers.stripe && { key: "card", label: "Card terminal" },
  ].filter(Boolean);

  const [paymentIndex, setPaymentIndex] = useState(0);

  useEffect(() => {
    if (paymentIndex > paymentSlides.length - 1) {
      setPaymentIndex(0);
    }
  }, [paymentSlides.length, paymentIndex]);

  const activePayment = paymentSlides[paymentIndex]?.key ?? null;

  const goToPayment = (index) => {
    if (index < 0 || index >= paymentSlides.length) return;
    setPaymentIndex(index);
    setMessage(null);
  };

  const nextPayment = () => {
    if (!paymentSlides.length) return;
    setPaymentIndex((prev) => (prev + 1) % paymentSlides.length);
    setMessage(null);
  };

  const prevPayment = () => {
    if (!paymentSlides.length) return;
    setPaymentIndex((prev) => (prev - 1 + paymentSlides.length) % paymentSlides.length);
    setMessage(null);
  };

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setTimeLeft(resolvedTimer);
  }, [resolvedTimer]);

  const onTimeout = () => {
    setMessage(t.timeoutReturn);
    setTimeout(() => onCancel(), 700);
  };

  // Timer: only when payment is enabled (business mode)
  useEffect(() => {
    if (!paymentEnabled) return;
    if (timeLeft <= 0) {
      onTimeout();
      return;
    }
    const interval = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(interval);
  }, [timeLeft, paymentEnabled]);

  // Rental or payment disabled → skip
  useEffect(() => {
    if (appMode !== "business" || !paymentEnabled) {
      setMessage(t.rentalSkip);
      const tid = setTimeout(() => onNext(), 600);
      return () => clearTimeout(tid);
    }
  }, [appMode, paymentEnabled, onNext]);

  const price = total;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = (timeLeft / Math.max(1, resolvedTimer)) * circumference;

  const persistPayment = async (paymentRecord) => {
    try {
      if (window.api?.recordPayment) {
        await window.api.recordPayment(paymentRecord);
        return true;
      }
      if (window.api?.getEvents && window.api?.setEvents) {
        const all = (await window.api.getEvents()) || [];
        const updated = all.map((e) => {
          if (e.id === currentEvent?.id) {
            e.analytics = e.analytics || {};
            e.analytics.sessionsToday = (e.analytics.sessionsToday || 0) + 1;
            e.analytics.revenueToday = (e.analytics.revenueToday || 0) + (paymentRecord.amount ?? 0);
            if (typeof e.analytics.sessionsWeekly === "number") e.analytics.sessionsWeekly += 1;
            if (typeof e.analytics.revenueWeekly === "number") e.analytics.revenueWeekly += paymentRecord.amount ?? 0;
            if (typeof e.analytics.sessionsMonthly === "number") e.analytics.sessionsMonthly += 1;
            if (typeof e.analytics.revenueMonthly === "number") e.analytics.revenueMonthly += paymentRecord.amount ?? 0;
            e.lastPayment = paymentRecord;
          }
          return e;
        });
        await window.api.setEvents(updated);
        return true;
      }
    } catch (err) {
      console.warn("persistPayment failed", err);
    }
    return false;
  };

  const basePaymentRecord = {
    amount: Number(price),
    currency,
    timestamp: Date.now(),
    eventId: currentEvent?.id ?? null,
    pricingModel,
    numberOfShots,
    discount: appliedDiscount ?? undefined,
    tax: taxEnabled ? Number(taxRate) : 0,
  };

  const confirmManualPayment = async (method) => {
    setProcessing(true);
    const paymentRecord = { method, ...basePaymentRecord };
    const persisted = await persistPayment(paymentRecord);
    setProcessing(false);
    setMessage(persisted ? t.recorded : t.completeNotPersisted);
    onSuccess?.(paymentRecord);
    setTimeout(() => onNext(), 600);
  };

  const handleCashProceed = async () => {
    setProcessing(true);
    setMessage(t.processingCash);

    const paymentRecord = { method: "cash", ...basePaymentRecord };

    try {
      if (window.electron?.finalizeCashPayment) {
        await window.electron.finalizeCashPayment({ amount: Number(price), currency });
      }
    } catch (err) {
      console.warn("finalizeCashPayment failed", err);
    }

    const persisted = await persistPayment(paymentRecord);
    setProcessing(false);
    setMessage(persisted ? t.recorded : t.completeNotPersisted);
    onSuccess?.(paymentRecord);
    setTimeout(() => onNext(), 600);
  };

  const handleQrProceed = async () => {
    await confirmManualPayment("gcash");
  };

  const handlePayPalProceed = async () => {
    await confirmManualPayment("paypal");
  };

  const handleCardProceed = async () => {
    await confirmManualPayment("card");
  };

  /* ------------------------------- Buttons ------------------------------- */
  const baseButtonStyle = useMemo(
    () => ({
      backgroundColor: buttonBgColor,
      color: buttonFontColor,
      fontFamily: buttonFont,
      borderRadius: 12,
      transition: "background-color 160ms ease",
      cursor: "pointer",
      border: "none",
    }),
    [buttonBgColor, buttonFontColor, buttonFont]
  );

  const applyHover = (e, hover = true) => {
    try {
      e.currentTarget.style.backgroundColor = hover ? buttonHoverColor : buttonBgColor;
    } catch { }
  };

  /* ------------------------------- Discounts ------------------------------- */
  const [discountMessage, setDiscountMessage] = useState(null);
  const tryApplyDiscount = () => {
    const found = discountList.find(
      (d) =>
        String(d?.code || "").trim().toLowerCase() ===
        String(discountCodeInput).trim().toLowerCase()
    );
    if (!found) {
      setAppliedDiscount(null);
      setDiscountMessage(t.discountInvalid);
      return;
    }
    const normalized = {
      code: found.code,
      percent: found.percent != null ? Number(found.percent) : undefined,
      amount: found.amount != null ? Number(found.amount) : undefined,
    };
    setAppliedDiscount(normalized);
    setDiscountMessage(t.discountApplied);
  };

  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  const onTouchStartCarousel = (e) => {
    const touch = e.changedTouches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  };

  const onTouchEndCarousel = (e) => {
    if (touchStartX.current == null || touchStartY.current == null) return;

    const touch = e.changedTouches[0];
    const diffX = touch.clientX - touchStartX.current;
    const diffY = touch.clientY - touchStartY.current;

    // only react to horizontal swipe
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 0) prevPayment();
      else nextPayment();
    }

    touchStartX.current = null;
    touchStartY.current = null;
  };

  /* ------------------------------- Modal body ------------------------------- */
  const renderUnifiedPaymentPanel = () => {
    return (
      <div className="w-full max-w-[980px] mx-auto px-6 md:px-10 relative z-10">
        <div
          className="w-full px-4 py-4 touch-pan-y"
          onTouchStart={onTouchStartCarousel}
          onTouchEnd={onTouchEndCarousel}
        >
          <div className="flex flex-col items-center text-center">

            <div className="w-full bg-white shadow-xl border border-black/5 rounded-[20px] max-w-[650px] min-h-[470px] flex items-start justify-center">
              {activePayment === "qr" && (
                <div className="w-full m-4 flex flex-col items-center text-center">
                  <h3
                    className="text-2xl md:text-3xl font-bold"
                    style={{ fontFamily: headerFont, color: headerFontColor }}
                  >
                    {isTagalog ? "QR Payment" : "QR Payment"}
                  </h3>

                  <p
                    className="mt-3 text-sm md:text-base max-w-[520px]"
                    style={{ fontFamily: generalFont, color: generalFontColor }}
                  >
                    {isTagalog
                      ? "I-scan gamit ang GCash o Maya para awtomatikong magsimula ang session kapag nakumpirma ang bayad."
                      : "Scan with GCash or Maya. The session will automatically start once payment is confirmed."}
                  </p>

                  <div
                    className="mt-6 w-[240px] h-[240px] md:w-[300px] md:h-[300px] rounded-[18px] shadow-inner flex items-center justify-center"
                    style={{
                      backgroundColor: "#ffffff",
                      border: "1px solid rgba(0,0,0,0.08)",
                    }}
                  >
                    <div className="text-gray-400 text-lg font-semibold">MERCHANT QR</div>
                  </div>

                  <div
                    className="mt-4 text-xs md:text-sm"
                    style={{ fontFamily: generalFont, color: "#6b7280" }}
                  >
                    {t.tipQR}
                  </div>

                  <button
                    type="button"
                    onClick={handleQrProceed}
                    disabled={processing}
                    className="mt-6 px-8 py-3 text-sm font-bold disabled:opacity-60"
                    style={baseButtonStyle}
                    onMouseEnter={(e) => applyHover(e, true)}
                    onMouseLeave={(e) => applyHover(e, false)}
                  >
                    {processing ? t.processing : t.externalConfirm}
                  </button>
                </div>
              )}

              {activePayment === "cash" && (
                <div className="w-full m-4 flex flex-col items-center text-center">
                  <h3
                    className="text-2xl md:text-3xl font-bold"
                    style={{ fontFamily: headerFont, color: headerFontColor }}
                  >
                    {isTagalog ? "Cash Payment" : "Cash Payment"}
                  </h3>

                  <p
                    className="mt-3 text-sm md:text-base max-w-[520px]"
                    style={{ fontFamily: generalFont, color: generalFontColor }}
                  >
                    {isTagalog
                      ? "Tanggapin ang cash at kumpirmahin lamang kapag kumpleto na ang bayad."
                      : "Accept cash and confirm only after the full amount is received."}
                  </p>

                  <div className="mt-6 grid grid-cols-1 gap-4 w-full max-w-[420px]">
                    <div className="text-center">
                      <div className="text-xs mb-1" style={{ color: "#6b7280" }}>
                        {isTagalog ? "To Pay" : "To Pay"}
                      </div>
                      <div
                        className="text-2xl md:text-3xl font-bold"
                        style={{ fontFamily: generalFont, color: generalFontColor }}
                      >
                        {fmt(price)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 text-xs md:text-sm" style={{ color: "#6b7280", fontFamily: generalFont }}>
                    {t.attendantConfirm}
                  </div>

                  <button
                    type="button"
                    onClick={handleCashProceed}
                    disabled={processing}
                    className="mt-6 px-8 py-3 text-sm font-bold disabled:opacity-60"
                    style={baseButtonStyle}
                    onMouseEnter={(e) => applyHover(e, true)}
                    onMouseLeave={(e) => applyHover(e, false)}
                  >
                    {processing ? t.processing : t.externalConfirm}
                  </button>
                </div>
              )}

              {activePayment === "paypal" && (
                <div className="w-full m-4 flex flex-col items-center text-center">
                  <h3
                    className="text-2xl md:text-3xl font-bold"
                    style={{ fontFamily: headerFont, color: headerFontColor }}
                  >
                    PayPal
                  </h3>

                  <p
                    className="mt-3 text-sm md:text-base max-w-[520px]"
                    style={{ fontFamily: generalFont, color: generalFontColor }}
                  >
                    {isTagalog
                      ? "Kumpletuhin ang bayad gamit ang PayPal. Magsisimula ang session kapag nakumpirma ang bayad."
                      : "Complete payment with PayPal. The session starts once the payment is confirmed."}
                  </p>

                  <div
                    className="mt-8 w-full max-w-[420px] rounded-[18px] px-6 py-8"
                    style={{ backgroundColor: "rgba(0,0,0,0.03)" }}
                  >
                    <div
                      className="text-base md:text-lg font-semibold"
                      style={{ fontFamily: generalFont, color: generalFontColor }}
                    >
                      {fmt(price)}
                    </div>
                    <div
                      className="mt-2 text-sm"
                      style={{ fontFamily: generalFont, color: "#6b7280" }}
                    >
                      {isTagalog ? "Kumpirmahin sa PayPal Business app" : "Confirm in the PayPal Business app"}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handlePayPalProceed}
                    disabled={processing}
                    className="mt-6 px-8 py-3 text-sm font-bold disabled:opacity-60"
                    style={baseButtonStyle}
                    onMouseEnter={(e) => applyHover(e, true)}
                    onMouseLeave={(e) => applyHover(e, false)}
                  >
                    {processing ? t.processing : t.externalConfirm}
                  </button>
                </div>
              )}

              {activePayment === "card" && (
                <div className="w-full m-4 flex flex-col items-center text-center">
                  <h3
                    className="text-2xl md:text-3xl font-bold"
                    style={{ fontFamily: headerFont, color: headerFontColor }}
                  >
                    {isTagalog ? "Card Payment" : "Card Payment"}
                  </h3>

                  <p
                    className="mt-3 text-sm md:text-base max-w-[520px]"
                    style={{ fontFamily: generalFont, color: generalFontColor }}
                  >
                    {isTagalog
                      ? "I-tap, i-insert, o i-swipe ang iyong card sa terminal. Awtomatikong magsisimula ang session kapag nakumpirma ang bayad."
                      : "Tap, insert, or swipe your card on the terminal. The session will automatically start once payment is confirmed."}
                  </p>

                  <div
                    className="mt-8 w-full max-w-[420px] rounded-[18px] px-6 py-8"
                    style={{ backgroundColor: "rgba(0,0,0,0.03)" }}
                  >
                    <div
                      className="text-base md:text-lg font-semibold"
                      style={{ fontFamily: generalFont, color: generalFontColor }}
                    >
                      {isTagalog ? "Terminal Ready" : "Terminal Ready"}
                    </div>
                    <div
                      className="mt-2 text-sm"
                      style={{ fontFamily: generalFont, color: "#6b7280" }}
                    >
                      {isTagalog ? "Kumpirmahin sa POS, Maya, o Stripe terminal." : "Confirm on the POS, Maya, or Stripe terminal."}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCardProceed}
                    disabled={processing}
                    className="mt-6 px-8 py-3 text-sm font-bold disabled:opacity-60"
                    style={baseButtonStyle}
                    onMouseEnter={(e) => applyHover(e, true)}
                    onMouseLeave={(e) => applyHover(e, false)}
                  >
                    {processing ? t.processing : t.externalConfirm}
                  </button>
                </div>
              )}
            </div>

            {paymentSlides.length > 1 && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={prevPayment}
                  className="w-10 h-10 rounded-full border border-black/10 text-lg"
                  style={{ color: generalFontColor, backgroundColor: "#fff" }}
                >
                  ‹
                </button>

                <div className="flex items-center gap-2">
                  {paymentSlides.map((item, i) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => goToPayment(i)}
                      className={`transition-all duration-300 rounded-full ${paymentIndex === i ? "w-8 h-2.5" : "w-2.5 h-2.5"
                        }`}
                      style={{
                        backgroundColor:
                          paymentIndex === i ? buttonBgColor : "rgba(0,0,0,0.18)",
                      }}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={nextPayment}
                  className="w-10 h-10 rounded-full border border-black/10 text-lg"
                  style={{ color: generalFontColor, backgroundColor: "#fff" }}
                >
                  ›
                </button>
              </div>
            )}

            {message && (
              <div
                className="mt-6 text-center text-sm md:text-base"
                style={{ color: generalFontColor, fontFamily: generalFont }}
              >
                {message}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ------------------------------- Provider options ------------------------------- */
  const hasPrimaryCenterPayment = providers.gcash || providers.cash;

  const resetMessages = () => {
    setMessage(null);
    setDiscountMessage(null);
  };

  /* --------------------------------- Render --------------------------------- */
  const isGif = !!backgroundMediaUrl && backgroundMediaUrl.toLowerCase().endsWith(".gif");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={mounted ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="relative w-full h-screen text-black overflow-hidden py-[50px]"
      style={{ backgroundColor: bgColor }}
    >

      {/* Brand (bottom-right): logo, else booth name */}
      <div className="absolute bottom-6 right-6 sm:bottom-12 sm:right-20 z-30 flex flex-col items-end">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="logo"
            className="max-w-[300px] sm:max-w-[300px] md:max-w-[400px]"
          />
        ) : (
          <>
            {boothName && (
              <div
                className="text-5xl font-bold"
                style={{ fontFamily: headerFont, color: headerFontColor }}
              >
                {boothName}
              </div>
            )}

            {boothSlogan && (
              <div
                className="text-lg"
                style={{ fontFamily: generalFont, color: generalFontColor }}
              >
                {boothSlogan}
              </div>
            )}
          </>
        )}
      </div>

      {/* Header */}
      <div className="grid grid-cols-1 lg:grid-cols-2 px-6 sm:px-12 lg:px-20 pt-6 gap-6 items-start relative z-10">
        <div>
          <h1
            className="text-3xl sm:text-5xl md:text-6xl lg:text-8xl leading-tight"
            style={{ fontFamily: headerFont, color: headerFontColor }}
          >
            {t.titleChoose}
            <br />
            {isTagalog ? "iyong " : "your "}
            <span className="italic font-bold">{t.titlePaymentOption}</span>
          </h1>
          <div
            className="inline-flex items-center gap-3 px-5 py-3 rounded-full"
            style={{
              background: "rgba(0,0,0,0.04)",
              fontFamily: generalFont,
              color: generalFontColor,
            }}
          >
            <span className="text-sm md:text-base">{t.amountDueLabel}</span>
            <span className="text-xl md:text-2xl font-bold">{fmt(price)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end text-right space-y-4 lg:pr-10">
          <p
            className="max-w-md text-sm sm:text-md md:text-xl"
            style={{ fontFamily: generalFont, color: generalFontColor }}
          >
            {t.hintProceed}
          </p>

          {paymentEnabled && (
            <div className="z-30">
              <div
                className="px-8 py-3 rounded-full text-2xl font-bold shadow-sm"
                style={{
                  fontFamily: generalFont,
                  backgroundColor: `${buttonBgColor}`,
                  color: buttonFontColor,
                }}
                aria-live="polite"
              >
                {Math.max(0, timeLeft)}s
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative z-10">
        {noProviders ? (
          <div
            className="text-center text-sm mt-10"
            style={{ color: "#6b7280", fontFamily: generalFont }}
          >
            {isTagalog
              ? "Walang naka-enable na payment provider."
              : "No payment providers are enabled."}
          </div>
        ) : (
          renderUnifiedPaymentPanel()
        )}
      </div>

      <div className="pb-20" />
    </motion.div>
  );
}
