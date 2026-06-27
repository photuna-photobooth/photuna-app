// src/components/subscription/PlanCards.jsx
import React, { useState } from "react";

const ACCENT = "#635bff";
const surface = "bg-white border border-gray-200 rounded-xl shadow-sm";
const helperText = "text-xs text-gray-600";

function Card({ children, className = "" }) {
  return <div className={`flex-1 ${surface} p-4 ${className}`}>{children}</div>;
}

function formatSavings(amount, currency) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (currency === "USD") return `$${amount.toLocaleString()}`;
  if (currency === "PHP") return `PHP ${amount.toLocaleString()}`;
  return amount.toLocaleString();
}

/**
 * Props:
 *  - plan: null|'trial'|'monthly'|'yearly'
 *  - trialEligible: boolean
 *  - monthlyPriceText, yearlyPriceText, trialPriceText: string
 *  - monthlyPriceAmount, yearlyPriceAmount: number
 *  - currency: string
 *  - onStartTrial, onUpgradeMonthly, onUpgradeYearly, onManageBilling: function
 */
export default function PlanCards({
  plan,
  trialEligible,
  monthlyPriceText = "$30 / mo",
  yearlyPriceText = "$204 / yr",
  trialPriceText = "$0",
  monthlyPriceAmount = 30,
  yearlyPriceAmount = 204,
  currency = "USD",
  onStartTrial,
  onUpgradeMonthly,
  onUpgradeYearly,
  onManageBilling,
}) {
  const [billingCycle, setBillingCycle] = useState("yearly");
  const normalizedPlan = plan || "free";

  const showTrialCard = normalizedPlan === "free" || normalizedPlan === "none";
  const showUpgrade =
    normalizedPlan === "free" ||
    normalizedPlan === "none" ||
    normalizedPlan === "trial" ||
    normalizedPlan === "monthly";

  const annualMonthly = Number.isFinite(monthlyPriceAmount) ? monthlyPriceAmount * 12 : null;
  const canComputeSavings = Number.isFinite(annualMonthly) && Number.isFinite(yearlyPriceAmount);
  const savingsValue = canComputeSavings ? Math.max(0, annualMonthly - yearlyPriceAmount) : 0;
  const savingsPct = canComputeSavings && annualMonthly > 0
    ? Math.round((savingsValue / annualMonthly) * 100)
    : 43;
  const selectedPlan = billingCycle === "yearly"
    ? {
      label: "Yearly",
      display: yearlyPriceText,
      note: "$17/mo when billed yearly. Best value for operators ready to book events.",
      action: onUpgradeYearly,
      button: "Upgrade Yearly",
    }
    : {
      label: "Monthly",
      display: monthlyPriceText,
      note: "Flexible monthly access for testing demand or running short-term operations.",
      action: onUpgradeMonthly,
      button: "Upgrade Monthly",
    };

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      {showTrialCard && (
        <Card>
          <div className="text-sm font-medium text-gray-900">14-Day Free Trial</div>
          <div className="mt-1 text-2xl">{trialPriceText}</div>
          <ul className={`${helperText} mt-2 list-disc space-y-1 pl-5`}>
            <li>Test the Studio Photuna operator workflow.</li>
            <li>Try templates, events, QR sharing, and license sync.</li>
            <li>No expensive kiosk required to evaluate the setup.</li>
          </ul>
          <button
            type="button"
            onClick={() => onStartTrial?.()}
            disabled={!trialEligible}
            className={`mt-3 w-full rounded-md py-2 text-sm ${trialEligible
              ? "bg-gray-900 text-white hover:opacity-90"
              : "cursor-not-allowed bg-gray-200 text-gray-500"
              }`}
            title={trialEligible ? "" : "Trial unavailable because it was already redeemed, expired, or a paid plan is active"}
          >
            {trialEligible ? "Start 14-Day Trial" : "Trial Unavailable"}
          </button>
        </Card>
      )}

      {showUpgrade && (
        <Card className="border-indigo-100 bg-indigo-50/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-gray-900">Studio Photuna Pro</div>
              <div className="mt-1 text-2xl">{selectedPlan.display}</div>
            </div>
            <div className="inline-flex rounded-full border border-indigo-100 bg-white p-1">
              {["monthly", "yearly"].map((cycle) => (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => setBillingCycle(cycle)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    billingCycle === cycle ? "bg-gray-950 text-white" : "text-gray-500 hover:text-gray-950"
                  }`}
                >
                  {cycle}
                </button>
              ))}
            </div>
          </div>

          <p className={`${helperText} mt-2`}>{selectedPlan.note}</p>
          <ul className={`${helperText} mt-2 list-disc space-y-1 pl-5`}>
            <li>Full software access for photobooth operators.</li>
            <li>Professional DSLR workflow, templates, and event tools.</li>
            <li>Cloud-aware account and subscription access.</li>
          </ul>

          {billingCycle === "yearly" && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700">
              Save {formatSavings(savingsValue, currency) || "43%"} {typeof savingsPct === "number" ? `(~${savingsPct}% vs monthly)` : ""}
            </div>
          )}

          <button
            type="button"
            onClick={() => selectedPlan.action?.()}
            className="mt-3 w-full rounded-md bg-indigo-600 py-2 text-sm text-white hover:bg-indigo-700"
            style={{ backgroundColor: ACCENT }}
          >
            {selectedPlan.button}
          </button>
        </Card>
      )}

      <Card>
        <div className="text-sm font-medium text-gray-900">Billing</div>
        <ul className={`${helperText} mt-2 list-disc space-y-1 pl-5`}>
          <li>View invoices and receipts</li>
          <li>Manage payment methods</li>
          <li>Cancel or resume subscription</li>
        </ul>
        <button
          type="button"
          onClick={() => onManageBilling?.()}
          className="mt-3 w-full rounded-md border border-gray-300 py-2 text-sm text-gray-800 hover:bg-gray-50"
        >
          Open Customer Portal
        </button>
      </Card>
    </div>
  );
}
