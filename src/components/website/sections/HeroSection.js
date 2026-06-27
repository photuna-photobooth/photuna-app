import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";

export default function HeroSection() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <section className="relative px-6 py-24 md:py-32 overflow-hidden bg-gradient-to-br from-purple-50 via-white to-indigo-50">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-200 rounded-full blur-3xl opacity-20"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-200 rounded-full blur-3xl opacity-20"></div>
      </div>

      <div className="relative max-w-4xl mx-auto text-center">
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
          The complete photo booth software
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600">
            for Korean-style studios
          </span>
        </h1>

        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Manage events, customize designs, run booths, and analyze performance—all in one powerful platform.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
          {user ? (
            <button
              onClick={() => navigate("/admin")}
              className="px-8 py-4 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition"
            >
              Go to Dashboard
            </button>
          ) : (
            <>
              <button
                onClick={() => navigate("/signup")}
                className="px-8 py-4 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition"
              >
                Start Free Trial
              </button>
              <button
                onClick={() => navigate("/login")}
                className="px-8 py-4 border-2 border-purple-600 text-purple-600 font-semibold rounded-lg hover:bg-purple-50 transition"
              >
                Sign In
              </button>
            </>
          )}
        </div>

        <div className="mt-12 bg-gray-900 rounded-2xl p-8 shadow-2xl">
          <div className="bg-gray-800 h-64 rounded-lg flex items-center justify-center text-gray-400">
            <svg
              className="w-16 h-16"
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
          </div>
          <p className="text-center text-gray-400 text-sm mt-4">
            Demo: Photo booth booth interface and editing suite
          </p>
        </div>
      </div>
    </section>
  );
}
