import React from "react";
import { useNavigate } from "react-router-dom";

export default function PricingSection() {
  const navigate = useNavigate();

  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      features: ["1 event", "Basic templates", "10 photos/month", "Email support"],
      cta: "Start Free",
      highlighted: false,
    },
    {
      name: "Professional",
      price: "$30",
      period: "per month",
      features: [
        "Unlimited events",
        "Advanced templates",
        "Unlimited photos",
        "Printing integration",
        "Analytics dashboard",
        "Priority support",
      ],
      cta: "Upgrade Now",
      highlighted: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      period: "contact us",
      features: [
        "Everything in Pro",
        "Custom branding",
        "API access",
        "Dedicated support",
        "White-label options",
      ],
      cta: "Contact Sales",
      highlighted: false,
    },
  ];

  return (
    <section id="pricing" className="px-6 py-24 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-lg text-gray-600">
            Choose the plan that fits your business
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan, idx) => (
            <div
              key={idx}
              className={`rounded-2xl p-8 ${
                plan.highlighted
                  ? "bg-purple-600 text-white scale-105 shadow-2xl"
                  : "bg-white"
              }`}
            >
              <h3
                className={`text-2xl font-bold mb-2 ${
                  plan.highlighted ? "text-white" : "text-gray-900"
                }`}
              >
                {plan.name}
              </h3>
              <div
                className={`text-4xl font-bold mb-1 ${
                  plan.highlighted ? "text-white" : "text-gray-900"
                }`}
              >
                {plan.price}
              </div>
              <p
                className={`text-sm mb-8 ${
                  plan.highlighted ? "text-purple-100" : "text-gray-600"
                }`}
              >
                {plan.period}
              </p>

              <ul className="space-y-4 mb-8">
                {plan.features.map((feature, i) => (
                  <li
                    key={i}
                    className={`flex items-start ${
                      plan.highlighted ? "text-purple-100" : "text-gray-600"
                    }`}
                  >
                    <span className="mr-3">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => navigate("/signup")}
                className={`w-full py-3 font-semibold rounded-lg transition ${
                  plan.highlighted
                    ? "bg-white text-purple-600 hover:bg-purple-50"
                    : "bg-purple-600 text-white hover:bg-purple-700"
                }`}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
