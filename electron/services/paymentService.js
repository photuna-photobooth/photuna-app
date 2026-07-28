const QRCode = require("qrcode");

const PAYMONGO_BASE = "https://api.paymongo.com/v1";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const SOURCE_TYPES = {
  gcash: "gcash",
  maya: "paymaya",
  grabpay: "grab_pay",
};

function toCentavos(php) {
  return Math.round(Number(php) * 100);
}

function basicAuth(secretKey) {
  return "Basic " + Buffer.from(secretKey + ":").toString("base64");
}

async function paymongoFetch(path, secretKey, options = {}) {
  const url = `${PAYMONGO_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: basicAuth(secretKey),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const msg =
      body?.errors?.[0]?.detail ||
      body?.errors?.[0]?.code ||
      `PayMongo API error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.paymongoErrors = body?.errors;
    throw err;
  }

  return body;
}

class PayMongoService {
  constructor(secretKey) {
    this.secretKey = secretKey;
  }

  async validateKeys() {
    // Create a minimal payment intent (PHP 100 = 10000 centavos) to verify credentials.
    // PayMongo doesn't charge until a payment method is attached, so this is safe.
    const body = await paymongoFetch("/payment_intents", this.secretKey, {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            amount: 10000,
            currency: "PHP",
            payment_method_allowed: ["card"],
            capture_type: "automatic",
            description: "Key validation test",
          },
        },
      }),
    });
    return !!body?.data?.id;
  }

  async createSource(type, amountPhp, currency = "PHP", description = "Photobooth session") {
    const sourceType = SOURCE_TYPES[type];
    if (!sourceType) throw new Error(`Unsupported source type: ${type}`);

    const body = await paymongoFetch("/sources", this.secretKey, {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            amount: toCentavos(amountPhp),
            currency,
            type: sourceType,
            redirect: {
              success: "https://studiophotuna.com/payment/success",
              failed: "https://studiophotuna.com/payment/failed",
            },
            description,
          },
        },
      }),
    });

    const source = body?.data;
    return {
      id: source?.id,
      checkoutUrl: source?.attributes?.redirect?.checkout_url,
      status: source?.attributes?.status,
    };
  }

  async getSource(sourceId) {
    const body = await paymongoFetch(`/sources/${sourceId}`, this.secretKey);
    const attrs = body?.data?.attributes;
    return {
      id: body?.data?.id,
      status: attrs?.status,
      amount: attrs?.amount,
      currency: attrs?.currency,
      type: attrs?.type,
    };
  }

  async createCharge(sourceId, amountPhp, currency = "PHP", description = "Photobooth session") {
    const body = await paymongoFetch("/payments", this.secretKey, {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            amount: toCentavos(amountPhp),
            currency,
            description,
            source: { id: sourceId, type: "source" },
          },
        },
      }),
    });

    const payment = body?.data;
    return {
      id: payment?.id,
      status: payment?.attributes?.status,
      amount: payment?.attributes?.amount,
      netAmount: payment?.attributes?.net_amount,
    };
  }

  async createPaymentIntent(amountPhp, currency = "PHP", description = "Photobooth session") {
    const body = await paymongoFetch("/payment_intents", this.secretKey, {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            amount: toCentavos(amountPhp),
            currency,
            description,
            payment_method_allowed: ["card"],
            capture_type: "automatic",
          },
        },
      }),
    });

    const intent = body?.data;
    return {
      id: intent?.id,
      clientKey: intent?.attributes?.client_key,
      status: intent?.attributes?.status,
    };
  }
}

// Manages active poll loops — one per sourceId.
// Calls onConfirmed/onFailed callbacks and auto-cleans up.
class PaymentPollManager {
  constructor() {
    this.activePolls = new Map();
  }

  start({ sourceId, amountPhp, currency, service, onConfirmed, onFailed }) {
    this.cancel(sourceId);

    const startTime = Date.now();
    const interval = setInterval(async () => {
      try {
        const source = await service.getSource(sourceId);

        if (source.status === "chargeable") {
          this.cancel(sourceId);
          try {
            const charge = await service.createCharge(sourceId, amountPhp, currency);
            onConfirmed({ sourceId, paymentId: charge.id, amount: charge.amount, status: charge.status });
          } catch (chargeErr) {
            onFailed({ sourceId, reason: chargeErr.message });
          }
          return;
        }

        if (source.status === "paid") {
          this.cancel(sourceId);
          onConfirmed({ sourceId, paymentId: null, amount: source.amount, status: "paid" });
          return;
        }

        if (source.status === "expired" || source.status === "cancelled") {
          this.cancel(sourceId);
          onFailed({ sourceId, reason: `Payment ${source.status}` });
          return;
        }

        if (Date.now() - startTime > POLL_TIMEOUT_MS) {
          this.cancel(sourceId);
          onFailed({ sourceId, reason: "Payment timed out after 5 minutes" });
        }
      } catch (err) {
        if (Date.now() - startTime > POLL_TIMEOUT_MS) {
          this.cancel(sourceId);
          onFailed({ sourceId, reason: err.message || "Poll failed" });
        }
      }
    }, POLL_INTERVAL_MS);

    this.activePolls.set(sourceId, interval);
  }

  cancel(sourceId) {
    const timer = this.activePolls.get(sourceId);
    if (timer) {
      clearInterval(timer);
      this.activePolls.delete(sourceId);
    }
  }

  cancelAll() {
    for (const [id] of this.activePolls) {
      this.cancel(id);
    }
  }
}

async function generateQrDataUrl(text) {
  return QRCode.toDataURL(text, { width: 400, margin: 2 });
}

function isTestMode(key) {
  return typeof key === "string" && key.includes("_test_");
}

module.exports = {
  PayMongoService,
  PaymentPollManager,
  generateQrDataUrl,
  toCentavos,
  isTestMode,
  SOURCE_TYPES,
};
