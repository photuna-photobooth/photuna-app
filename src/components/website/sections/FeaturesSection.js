import React from "react";

const features = [
  {
    title: "Event Management",
    description:
      "Create and manage multiple photo booth events with custom templates, pricing, and availability.",
    icon: "📅",
  },
  {
    title: "Customizable Templates",
    description:
      "Design stunning photo layouts with custom frames, borders, and filters. Apply branding instantly.",
    icon: "🎨",
  },
  {
    title: "Booth Operations",
    description:
      "Run photo sessions with intuitive booth flow, real-time editing, and instant printing capabilities.",
    icon: "📸",
  },
  {
    title: "Instant Sharing",
    description:
      "Share photos via QR codes, email, and cloud links. Generate beautiful galleries customers love.",
    icon: "🔗",
  },
  {
    title: "Payment Processing",
    description:
      "Integrated Stripe payments for easy transactions. Accept cards, track revenue in real-time.",
    icon: "💳",
  },
  {
    title: "Analytics Dashboard",
    description:
      "Monitor sessions, revenue, template usage, and performance metrics across all your events.",
    icon: "📊",
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="px-6 py-24 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Everything you need to succeed
          </h2>
          <p className="text-lg text-gray-600">
            Powerful tools built for professional photo booth studios
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, idx) => (
            <div
              key={idx}
              className="p-8 bg-gray-50 rounded-2xl hover:shadow-lg transition-shadow"
            >
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                {feature.title}
              </h3>
              <p className="text-gray-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
