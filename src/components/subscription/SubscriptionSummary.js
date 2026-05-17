
// src/components/subscription/SubscriptionSummary.jsx
import React from "react";

const surface = "bg-white border border-gray-200 rounded-xl shadow-sm";
const helper = "text-xs text-gray-600";

function formatTs(ts) {
  if (!ts || typeof ts !== "number") return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(ts * 1000));
}

export default function SubscriptionSummary({ license, gating, prices }) {
  const plan = license?.plan ?? gating?.plan ?? null; // null | 'trial' | 'monthly' | 'yearly'
  const ent = license?.entitlements ?? {};
  const renewOrEnd = license?.expiresAt ?? gating?.expiresAt ?? 0;

  const statusBadge =
    gating?.allow
      ? <span className="text-xs px-2 py-1 rounded border border-green-300 text-green-700">Active</span>
      : <span className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700">Restricted</span>;

  const title =
    plan === "yearly" ? "Pro — Yearly"
    : plan === "monthly" ? "Pro — Monthly"
    : plan === "trial" ? "Free Trial"
    : "No Plan";

  return (
    <div className={`${surface} p-4`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-gray-900 font-medium">Current Subscription</div>
          <div className="text-lg mt-1">{title} {statusBadge}</div>
          <div className={`${helper} mt-1`}>
            {plan
              ? (plan === "trial" ? "Ends" : "Renews") + ` ${formatTs(renewOrEnd)}`
              : "You are currently not subscribed."}
          </div>

          {/* optional value messaging */}
          {plan !== "yearly" && prices?.monthly?.amount && prices?.yearly?.amount ? (
            <div className={`${helper} mt-1`}>
              {(() => {
                const m = prices.monthly.amount;
                const y = prices.yearly.amount;
                const annualMonthly = m * 12;
                const save = Math.max(0, annualMonthly - y);
                const pct = annualMonthly > 0 ? Math.round((save / annualMonthly) * 100) : 0;
                return save > 0
                  ? <>Save <b>{prices.currency === "PHP" ? `₱${save.toLocaleString()}` : save.toLocaleString()}</b> (~{pct}%)
                       by switching to Yearly.</>
                  : null;
              })()}
            </div>
          ) : null}
        </div>

        <div className="text-right">
          <div className="text-xs text-gray-600">Plan price</div>
          <div className="text-base font-medium">
            {plan === "yearly"
              ? (prices?.yearly?.display ?? "₱10,000 / yr")
              : plan === "monthly"
              ? (prices?.monthly?.display ?? "₱1,400 / mo")
              : plan === "trial"
              ? "₱0"
              : "—"}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs text-gray-700 font-medium">Entitlements</div>
        <ul className="mt-2 text-xs text-gray-700 grid grid-cols-1 md:grid-cols-2 gap-y-1">
          <li>Watermark: <b>{ent.watermark ? "Enabled" : "Disabled"}</b></li>
          <li>Max events: <b>{ent.maxEvents ?? 0}</b></li>
          <li>Templates: <b>{ent.templates ?? 0}</b></li>
          <li>Priority support: <b>{ent.prioritySupport ? "Yes" : "No"}</b></li>
          <li>Gallery add-on: <b>{ent.galleryEnabled || ent.galleryAddon ? "Enabled" : "Disabled"}</b></li>
        </ul>
      </div>
    </div>
  );
}
