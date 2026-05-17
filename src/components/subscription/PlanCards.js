
// src/components/subscription/PlanCards.jsx
import React from "react";

const ACCENT = "#635bff";
const surface = "bg-white border border-gray-200 rounded-xl shadow-sm";
const helperText = "text-xs text-gray-600";

function Card({ children }) {
  return <div className={`flex-1 ${surface} p-4`}>{children}</div>;
}

function peso(n) {
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₱${Math.round(n).toLocaleString()}`;
  }
}

/**
 * Props:
 *  - plan: null|'trial'|'monthly'|'yearly'
 *  - trialEligible: boolean
 *  - monthlyPriceText, yearlyPriceText, trialPriceText: string
 *  - monthlyPriceAmount, yearlyPriceAmount: number
 *  - onStartTrial, onUpgradeMonthly, onUpgradeYearly, onManageBilling: function
 */
export default function PlanCards({
  plan,
  trialEligible,
  monthlyPriceText,
  yearlyPriceText,
  trialPriceText,
  monthlyPriceAmount,
  yearlyPriceAmount,
  onStartTrial,
  onUpgradeMonthly,
  onUpgradeYearly,
  onManageBilling,
}) {
  const normalizedPlan = plan || "free";

  const showTrialCard = normalizedPlan === "free" || normalizedPlan === "none";
  const showMonthlyUpgrade =
    normalizedPlan === "free" ||
    normalizedPlan === "none" ||
    normalizedPlan === "trial";

  const showYearlyUpgrade =
    normalizedPlan === "free" ||
    normalizedPlan === "none" ||
    normalizedPlan === "trial" ||
    normalizedPlan === "monthly";

  const annualMonthly = Number.isFinite(monthlyPriceAmount) ? monthlyPriceAmount * 12 : null;
  const canComputeSavings = Number.isFinite(annualMonthly) && Number.isFinite(yearlyPriceAmount);
  const savingsValue = canComputeSavings ? Math.max(0, annualMonthly - yearlyPriceAmount) : 0;
  const savingsPct = canComputeSavings && annualMonthly > 0
    ? Math.round((savingsValue / annualMonthly) * 100)
    : null;

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* Trial */}
      {showTrialCard && (
        <Card>
          <div className="text-sm text-gray-900 font-medium">Free Trial</div>
          <div className="text-2xl mt-1">{trialPriceText}</div>
          <ul className={`${helperText} mt-2 list-disc pl-5 space-y-1`}>
            <li>Try core features for a limited time.</li>
            <li>No card required; cancel anytime during trial.</li>
            <li>Great for quick evaluation.</li>
          </ul>
          <button
            type="button"
            onClick={() => onStartTrial?.()}
            disabled={!trialEligible}
            className={`mt-3 w-full py-2 rounded-md text-sm ${trialEligible
              ? "bg-gray-900 text-white hover:opacity-90"
              : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}
            title={trialEligible ? "" : "Trial unavailable (already redeemed/expired or on a paid plan)"}
          >
            {trialEligible ? "Start Trial" : "Trial Unavailable"}
          </button>
        </Card>
      )}

      {/* Monthly */}
      {showMonthlyUpgrade && (
        <Card>
          <div className="text-sm text-gray-900 font-medium">Pro — Monthly</div>
          <div className="text-2xl mt-1">{monthlyPriceText}</div>
          <ul className={`${helperText} mt-2 list-disc pl-5 space-y-1`}>
            <li>Full features billed every month.</li>
            <li>Flexible — switch or cancel anytime.</li>
            <li>Ideal for short-term usage.</li>
          </ul>
          {Number.isFinite(annualMonthly) && (
            <div className={`${helperText} mt-2`}>
              12 months at monthly pricing costs {peso(annualMonthly)}.
            </div>
          )}
          <button
            type="button"
            onClick={() => onUpgradeMonthly?.()}
            className="mt-3 w-full bg-indigo-600 text-white py-2 rounded-md text-sm hover:bg-indigo-700"
            style={{ backgroundColor: ACCENT }}
          >
            Upgrade Monthly
          </button>
        </Card>
      )}

      {/* Yearly */}
      {showYearlyUpgrade && (
        <Card>
          <div className="text-sm text-gray-900 font-medium">Pro — Yearly</div>
          <div className="text-2xl mt-1">{yearlyPriceText}</div>
          <ul className={`${helperText} mt-2 list-disc pl-5 space-y-1`}>
            <li>All features billed once per year.</li>
            <li>Best long-term value and convenience.</li>
            <li>Priority on support & roadmap input.</li>
          </ul>
          {canComputeSavings && savingsValue > 0 && (
            <div className="mt-2 inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
              Save {peso(savingsValue)} {typeof savingsPct === "number" ? `(~${savingsPct}% vs monthly)` : ""}
            </div>
          )}
          <button
            type="button"
            onClick={() => onUpgradeYearly?.()}
            className="mt-3 w-full bg-indigo-600 text-white py-2 rounded-md text-sm hover:bg-indigo-700"
            style={{ backgroundColor: ACCENT }}
          >
            Upgrade Yearly
          </button>
        </Card>
      )}

      {/* Billing */}
      <Card>
        <div className="text-sm text-gray-900 font-medium">Billing</div>
        <ul className={`${helperText} mt-2 list-disc pl-5 space-y-1`}>
          <li>View invoices & receipts</li>
          <li>Manage payment methods</li>
          <li>Cancel or resume subscription</li>
        </ul>
        <button
          type="button"
          onClick={() => onManageBilling?.()}
          className="mt-3 w-full border border-gray-300 text-gray-800 py-2 rounded-md text-sm hover:bg-gray-50"
        >
          Open Customer Portal
        </button>
      </Card>
    </div>
  );
}
