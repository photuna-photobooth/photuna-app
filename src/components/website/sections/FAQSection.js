import React, { useState } from "react";

const faqs = [
  {
    q: "Do I need technical skills to use Photuna?",
    a: "No. Photuna is designed for non-technical users. Our intuitive interface guides you through setup and booth operations.",
  },
  {
    q: "Can I use Photuna on multiple booths?",
    a: "Yes! Manage unlimited booths and events from your admin dashboard. Sync templates and settings across all devices.",
  },
  {
    q: "Does Photuna include printing support?",
    a: "Yes. Photuna integrates with USB printers and wireless thermal printers for instant printing.",
  },
  {
    q: "Can customers share their photos?",
    a: "Absolutely. Customers receive QR codes and links to download, share, and print their photos.",
  },
  {
    q: "What payment methods are supported?",
    a: "We support all major credit cards, debit cards, and other payment methods via Stripe.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes! Start with our free plan. Upgrade anytime with no contracts.",
  },
];

export default function FAQSection() {
  const [expanded, setExpanded] = useState(null);

  return (
    <section id="faq" className="px-6 py-24 bg-gray-50">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Frequently asked questions
          </h2>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, idx) => (
            <button
              key={idx}
              onClick={() => setExpanded(expanded === idx ? null : idx)}
              className="w-full p-6 bg-white rounded-lg text-left hover:shadow-md transition"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">{faq.q}</h3>
                <span className="text-purple-600 text-xl">
                  {expanded === idx ? "−" : "+"}
                </span>
              </div>
              {expanded === idx && (
                <p className="mt-4 text-gray-600">{faq.a}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
