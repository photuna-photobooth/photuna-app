// src/components/subscription/SubscriptionSummary.jsx
import React from "react";

const surface = "bg-white border border-gray-200 rounded-xl shadow-sm";
const helper = "text-xs text-gray-600";

function formatTs(ts) {
  if (!ts || typeof ts !== "number") return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(ts * 1000));
}

function formatSavings(amount, currency) {
  if (currency === "USD") return `$${amount.toLocaleString()}`;
  if (currency === "PHP") return `PHP ${amount.toLocaleString()}`;
  return amount.toLocaleString();
}

export default function SubscriptionSummary({ license, gating, prices }) {
  const plan = license?.plan ?? gating?.plan ?? null; // null | 'trial'|'monthly'|'yearly'
  const ent = license?.entitlements ?? {};
  const renewOrEnd = license?.expiresAt ?? gating?.expiresAt ?? 0;

  const statusBadge = gating?.allow
    ? <span className="rounded border border-green-300 px-2 py-1 text-xs text-green-700">Active</span>
    : <span className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700">Restricted</span>;

  const title =
    plan === "yearly" ? "Pro - Yearly"
      : plan === "monthly" ? "Pro - Monthly"
        : plan === "trial" ? "Free Trial"
          : "No Plan";

  const priceText =
    plan === "yearly" ? (prices?.yearly?.display ?? "$204 / yr")
      : plan === "monthly" ? (prices?.monthly?.display ?? "$30 / mo")
        : plan === "trial" ? "$0"
          : "-";

  return (
    <div className={`${surface} p-4`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium text-gray-900">Current Subscription</div>
          <div className="mt-1 text-lg">{title} {statusBadge}</div>
          <div className={`${helper} mt-1`}>
            {plan
              ? (plan === "trial" ? "Ends" : "Renews") + ` ${formatTs(renewOrEnd)}`
              : "You are currently not subscribed."}
          </div>

          {plan !== "yearly" && prices?.monthly?.amount && prices?.yearly?.amount ? (
            <div className={`${helper} mt-1`}>
              {(() => {
                const monthly = prices.monthly.amount;
                const yearly = prices.yearly.amount;
                const annualMonthly = monthly * 12;
                const save = Math.max(0, annualMonthly - yearly);
                const pct = annualMonthly > 0 ? Math.round((save / annualMonthly) * 100) : 0;
                return save > 0
                  ? <>Save <b>{formatSavings(save, prices.currency)}</b> (~{pct}%) by switching to Yearly.</>
                  : null;
              })()}
            </div>
          ) : null}
        </div>

        <div className="text-right">
          <div className="text-xs text-gray-600">Plan price</div>
          <div className="text-base font-medium">{priceText}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-medium text-gray-700">Entitlements</div>
        <ul className="mt-2 grid grid-cols-1 gap-y-1 text-xs text-gray-700 md:grid-cols-2">
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
