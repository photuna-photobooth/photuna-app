import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all ${
        scrolled
          ? "bg-white/90 backdrop-blur shadow-md"
          : "bg-white/40 backdrop-blur"
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/website" className="flex items-center gap-2">
          <img src="/logo.png" alt="Photuna" className="h-10 w-auto" />
          <span className="font-bold text-lg hidden sm:inline">Photuna</span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-gray-700">
          <a href="#features" className="hover:text-purple-600 transition">
            Features
          </a>
          <a href="#pricing" className="hover:text-purple-600 transition">
            Pricing
          </a>
          <a href="#setup" className="hover:text-purple-600 transition">
            Setup
          </a>
          <a href="#faq" className="hover:text-purple-600 transition">
            FAQ
          </a>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <button
                onClick={() => navigate("/admin")}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Dashboard
              </button>
              <button
                onClick={() => navigate("/account")}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Account
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => navigate("/login")}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Sign In
              </button>
              <button
                onClick={() => navigate("/signup")}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Get Started
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
