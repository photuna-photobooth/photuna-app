import React, { useState } from "react";

const steps = [
  {
    num: "1",
    title: "Install the App",
    desc: "Download and install Photuna on your booth computer or smartphone.",
  },
  {
    num: "2",
    title: "Configure Events",
    desc: "Create your events, set pricing, customize templates, and upload branding.",
  },
  {
    num: "3",
    title: "Run the Booth",
    desc: "Start a session, capture photos, edit with templates, and print or share instantly.",
  },
  {
    num: "4",
    title: "Manage Analytics",
    desc: "Track revenue, sessions, templates used, and grow your business with insights.",
  },
];

export default function SetupGuideSection() {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <section id="setup" className="px-6 py-24 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Get started in 4 steps
          </h2>
          <p className="text-lg text-gray-600">
            From setup to first session in minutes
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-6 mb-12">
          {steps.map((step, idx) => (
            <button
              key={idx}
              onClick={() => setActiveStep(idx)}
              className={`p-6 rounded-2xl text-left transition ${
                activeStep === idx
                  ? "bg-purple-600 text-white shadow-lg"
                  : "bg-gray-50 text-gray-900 hover:bg-gray-100"
              }`}
            >
              <div
                className={`text-3xl font-bold mb-3 ${
                  activeStep === idx ? "text-purple-200" : "text-purple-600"
                }`}
              >
                {step.num}
              </div>
              <h3 className="font-semibold mb-2">{step.title}</h3>
              <p className={`text-sm ${activeStep === idx ? "text-purple-100" : "text-gray-600"}`}>
                {step.desc}
              </p>
            </button>
          ))}
        </div>

        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-12 text-center min-h-96 flex items-center justify-center">
          <div className="text-gray-400">
            <svg
              className="w-24 h-24 mx-auto mb-4 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <p className="text-lg">Demo: {steps[activeStep].title}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
