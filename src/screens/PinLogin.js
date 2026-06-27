
import React, { useState, useEffect } from "react";

export default function PinLogin({ onLogin }) {
  const [mode, setMode] = useState("login"); // 'login' | 'register'
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Optional: preload the saved username for convenience (if exposed via preload)
  useEffect(() => {
    const loadSaved = async () => {
      try {
        const savedUsername = await window.secureStore.getUsername();
        if (savedUsername) setUsername(savedUsername);
      } catch (_) {}
    };
    loadSaved();
  }, []);

  const resetMessages = () => {
    setError("");
    setInfo("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    resetMessages();

    if (mode === "login") {
      if (!username || !pin) {
        setError("Please enter your username and PIN.");
        return;
      }

      try {
        const isValid = await window.secureStore.validateCredentials(username, pin);
        if (isValid) {
          setInfo("Login successful. Redirecting…");
          onLogin(); // tells App to show the dashboard
        } else {
          setError("Invalid username or PIN. Try again.");
        }
      } catch (err) {
        setError("Login failed. Please try again.");
        console.error(err);
      }
    } else {
      // mode === 'register'
      if (!username) {
        setError("Username is required.");
        return;
      }
      if (!pin || !confirmPin) {
        setError("Please enter and confirm your PIN.");
        return;
      }
      if (pin.length < 4) {
        setError("PIN must be at least 4 digits.");
        return;
      }
      if (pin !== confirmPin) {
        setError("PIN and Confirm PIN do not match.");
        return;
      }

      try {
        const ok = await window.secureStore.registerCredentials(username, pin);
        if (ok) {
          setInfo("Registration successful. You can now log in.");
          setMode("login");
          setPin("");
          setConfirmPin("");
        } else {
          setError("Registration failed. Username may already exist.");
        }
      } catch (err) {
        setError("Registration failed. Please try again.");
        console.error(err);
      }
    }
  };

  return (
    <div className="w-full h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black text-white">
      <div className="bg-white text-black rounded-2xl shadow-xl w-full max-w-sm p-10">
        <h1 className="text-3xl font-ramillas text-center mb-6">
          <span className="font-bold">Studio Photuna Booth App</span>
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Username */}
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 border rounded-lg text-center text-lg tracking-widest focus:ring-2 focus:ring-pink-500"
            placeholder="admin@studiophotuna.com"
            autoComplete="username"
          />

          {/* PIN */}
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="w-full px-4 py-3 border rounded-lg text-center text-lg tracking-widest focus:ring-2 focus:ring-pink-500"
            placeholder="Password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />

          {/* Confirm PIN (only in register mode) */}
          {mode === "register" && (
            <input
              type="password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              className="w-full px-4 py-3 border rounded-lg text-center text-lg tracking-widest focus:ring-2 focus:ring-pink-500"
              placeholder="Confirm Password"
              autoComplete="new-password"
            />
          )}

          {/* Messages */}
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          {info && <p className="text-green-600 text-sm text-center">{info}</p>}

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-pink-500 text-white font-semibold hover:bg-pink-600 transition"
          >
            {mode === "login" ? "Login →" : "Register →"}
          </button>

          {/* Mode Toggle */}
          <div className="text-center mt-2">
            {mode === "login" ? (
              <button
                type="button"
                className="text-pink-600 hover:underline"
                onClick={() => {
                  resetMessages();
                  setMode("register");
                }}
              >
                New here? Create an account
              </button>
            ) : (
              <button
                type="button"
                className="text-pink-600 hover:underline"
                onClick={() => {
                  resetMessages();
                  setMode("login");
                }}
              >
                Already registered? Back to login
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
