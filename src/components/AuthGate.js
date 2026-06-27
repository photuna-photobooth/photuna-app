import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLicense } from '../context/LicenseContext';
import * as api from '../services/licensingApi';

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.2-1.7 3.6-5.5 3.6-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.3.8 4.1 1.6l2.8-2.8C16.7 2.3 14.6 1.5 12 1.5 6.8 1.5 2.5 5.8 2.5 11S6.8 20.5 12 20.5c7 0 9.7-4.9 9.7-7.4 0-.5 0-1-.1-1.4H12z" />
    <path fill="#4285F4" d="M21.6 12.2c0-.8-.1-1.4-.2-2H12v3.9h5.5c-.1.9-.7 2.2-2 3.1l3.2 2.5c1.9-1.8 2.9-4.4 2.9-7.5z" />
    <path fill="#FBBC05" d="M5.6 13.3c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2L2.4 6.8C1.6 8.3 1.1 10.1 1.1 12s.5 3.7 1.3 5.2l3.2-2.5c-.4-.9-.7-1.9-.7-3z" />
    <path fill="#34A853" d="M12 22.5c2.7 0 5-.9 6.7-2.4l-3.2-2.5c-.9.6-2 1-3.5 1-2.7 0-5-1.8-5.8-4.3l-3.2 2.5C4.6 20.4 8 22.5 12 22.5z" />
  </svg>
);

const AppleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
    <path d="M16.365 12.159c.03 3.304 2.887 4.404 2.919 4.42-.025.08-.456 1.565-1.508 3.104-.908 1.332-1.852 2.662-3.334 2.689-1.458.026-1.927-.873-3.593-.873-1.667 0-2.191.846-3.571.899-1.44.054-2.539-1.44-3.455-2.766-1.878-2.716-3.315-7.664-1.388-11.007.956-1.666 2.664-2.724 4.514-2.75 1.41-.028 2.738.953 3.593.953.856 0 2.475-1.179 4.178-1.005.711.029 2.71.287 3.99 2.165-.103.064-2.383 1.39-2.345 4.171zM13.58 3.658c.764-.925 1.275-2.215 1.137-3.5-1.1.045-2.434.732-3.231 1.655-.71.816-1.328 2.128-1.163 3.388 1.229.095 2.492-.619 3.257-1.543z" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Small subcomponents                                                */
/* ------------------------------------------------------------------ */

function Footer() {
  return (
    <footer className="mt-8 text-center text-xs text-slate-400">
      <nav className="flex items-center justify-center gap-4">
        <a href="mailto:support@photuna.app" className="hover:text-slate-700 transition-colors">Contact Us</a>
        <a href="mailto:support@photuna.app?subject=Studio%20Photuna%20Terms" className="hover:text-slate-700 transition-colors">Terms &amp; Conditions</a>
        <a href="mailto:support@photuna.app?subject=Studio%20Photuna%20Privacy" className="hover:text-slate-700 transition-colors">Privacy Policy</a>
      </nav>
      <p className="mt-2">© {new Date().getFullYear()} Studio Photuna. All Rights Reserved.</p>
    </footer>
  );
}

function AuthMessage({ message }) {
  if (!message) return null;
  const isError = /error|failed|invalid|unexpected|restricted/i.test(message);
  return (
    <div
      className={[
        'rounded-2xl border px-4 py-3 text-sm',
        isError
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700',
      ].join(' ')}
    >
      {message}
    </div>
  );
}

function PillInput({ id, label, type = 'text', value, onChange, placeholder, required, minLength, autoComplete }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-extrabold text-[#111827]">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        className="min-h-[52px] w-full rounded-2xl border border-[#dedfe6] bg-white px-4 text-sm text-[#111827] outline-none transition placeholder:text-[#8b92a6] focus:border-[#6f4dff] focus:ring-4 focus:ring-[#6f4dff]/10"
      />
    </div>
  );
}

function PillPasswordField({ value, onChange, showPassword, onToggle }) {
  return (
    <div>
      <label htmlFor="password" className="mb-2 block text-sm font-extrabold text-[#111827]">
        Password
      </label>
      <div className="group flex min-h-[52px] items-center rounded-2xl border border-[#dedfe6] bg-white pr-2 transition focus-within:border-[#6f4dff] focus-within:ring-4 focus-within:ring-[#6f4dff]/10">
        <input
          id="password"
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder="Enter your password"
          autoComplete="current-password"
          className="w-full bg-transparent px-4 text-sm text-[#111827] outline-none placeholder:text-[#8b92a6]"
          required
          minLength={6}
        />
        <button
          type="button"
          className="rounded-full px-3 py-1.5 text-xs font-extrabold text-[#5f6678] transition hover:bg-[#f4f5f8] hover:text-[#111827]"
          onClick={onToggle}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

const authInfoSlides = [
  {
    eyebrow: 'Account access',
    title: 'Connect this booth to your operator workspace.',
    copy: 'Your login unlocks the Windows app, keeps license status in sync, and connects this device to the same account used for events, templates, galleries, and subscription access.',
    cards: [
      ['01', 'Account sync', 'Reads the correct Supabase user, profile, plan, and trial state.'],
      ['02', 'License access', 'Refreshes subscription access after checkout and keeps restricted mode accurate.'],
      ['03', 'Operator workspace', 'Opens dashboard tools for events, templates, settings, reports, and galleries.'],
      ['04', 'Device session', 'Keeps this Windows booth signed in until you intentionally log out.'],
    ],
  },
  {
    eyebrow: 'Business workflow',
    title: 'Run booth operations from one production workspace.',
    copy: 'Studio Photuna keeps the setup focused on the work operators need before and during an event, without adding a kiosk-only workflow.',
    cards: [
      ['01', 'Event setup', 'Create client events and prepare booth settings before the booking starts.'],
      ['02', 'Template control', 'Manage layouts, frames, branding, safe margins, and event-specific designs.'],
      ['03', 'Guest flow', 'Move guests through capture, retake, preview, QR sharing, and thank-you screens.'],
      ['04', 'Reports', 'Review sessions, output, revenue, print counts, and event activity after bookings.'],
    ],
  },
  {
    eyebrow: 'Subscription ready',
    title: 'Built for operators who need reliable app access.',
    copy: 'The account layer keeps trial, subscription, and device access attached to the correct operator so refreshes and restarts stay predictable.',
    cards: [
      ['01', '14-day trial', 'Start with full access before choosing a paid plan.'],
      ['02', 'Monthly plan', '$30 per month for operators who need flexibility.'],
      ['03', 'Yearly plan', '$204 yearly, equal to $17 per month for the best value.'],
      ['04', 'Secure logout', 'Clears stored identity so the next restart does not restore the old user.'],
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function AuthGate({ children }) {
  const {
    user,
    login,
    register,
    logout,
    loginWithGoogle,
    loginWithApple,
    sendPasswordReset,
  } = useAuth();
  const { gating, refreshLicense } = useLicense();

  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [billingCycle, setBillingCycle] = useState('yearly');
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeAuthSlide, setActiveAuthSlide] = useState(0);

  const isLoggedIn = !!user;
  const proPlans = {
    monthly: {
      label: 'Monthly',
      plan: 'monthly',
      price: '$30/mo',
      note: 'Best for operators who want monthly flexibility before committing.',
      cta: 'Subscribe Monthly',
      chips: ['Monthly billing', 'Full software access', 'Cancel when needed'],
    },
    yearly: {
      label: 'Yearly',
      plan: 'yearly',
      price: '$17/mo',
      note: '$204 billed yearly. Save 43% compared with monthly billing.',
      cta: 'Subscribe Yearly',
      chips: ['Best value', 'Priority support', '12-month business access'],
    },
  };
  const selectedProPlan = proPlans[billingCycle];

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (isLoggedIn) return undefined;
    const interval = setInterval(() => {
      setActiveAuthSlide((current) => (current + 1) % authInfoSlides.length);
    }, 60000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  const activeInfo = authInfoSlides[activeAuthSlide];

  const viewCopy = useMemo(() => {
    if (mode === 'register') {
      return {
        eyebrow: 'Start',
        title: 'Create account',
        subtitle: '',
        submitLabel: loading ? 'Creating account...' : 'Create account',
        switchPrompt: 'Already have an account?',
        switchAction: 'Sign in',
      };
    }
    return {
      eyebrow: 'Login',
      title: 'Welcome back',
      subtitle: '',
      submitLabel: loading ? 'Signing in...' : 'Login',
      switchPrompt: 'New to Photuna?',
      switchAction: 'Create an account',
    };
  }, [loading, mode]);

  /* -------------------- handlers (unchanged behavior) -------------------- */

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        setMsg('Signed in successfully.');
      } else {
        await register(email, password, name);
        setMsg('Account created successfully.');
      }
    } catch (err) {
      setMsg(err?.message ? String(err.message) : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setMsg('');
    try {
      if (!email) {
        setMsg('Enter your email first to receive a password reset link.');
        return;
      }
      if (!sendPasswordReset) {
        setMsg('Password reset is not available right now.');
        return;
      }
      await sendPasswordReset(email);
      setMsg('Password reset email sent.');
    } catch (error) {
      setMsg(error?.message ? String(error.message) : 'Reset failed.');
    }
  };

  const handleSocialLogin = async (provider) => {
    setMsg('');
    setLoading(true);
    try {
      if (provider === 'google') {
        if (!loginWithGoogle) throw new Error('Google sign-in not available.');
        await loginWithGoogle();
      }
      if (provider === 'apple') {
        if (!loginWithApple) throw new Error('Apple sign-in not available.');
        await loginWithApple();
      }
    } catch (error) {
      setMsg(error?.message ? String(error.message) : `${provider} sign-in failed.`);
    } finally {
      setLoading(false);
    }
  };

  const redeemTrial = async () => {
    setMsg('');
    if (!isLoggedIn) return;
    setPlanLoading(true);
    try {
      await api.redeemTrial();
      await refreshLicense();
      setMsg('Trial activated! Your 14-day trial is now live.');
    } catch (err) {
      setMsg(err?.message ? `Trial error: ${err.message}` : 'Trial: Unexpected error');
    } finally {
      setPlanLoading(false);
    }
  };

  const upgrade = async (plan) => {
    setMsg('');
    setPlanLoading(true);
    try {
      const res = await api.createCheckoutSession(plan);
      if (res?.url) {
        if (window.system?.openExternal) {
          await window.system.openExternal(res.url);
        } else {
          window.open(res.url, '_blank');
        }
        setMsg('Checkout opened in your browser. Complete payment, then click Refresh License below.');
      } else {
        setMsg('No checkout URL returned. Please try again.');
      }
    } catch (err) {
      setMsg(err?.message ? `Checkout error: ${err.message}` : 'Checkout failed. Please try again.');
    } finally {
      setPlanLoading(false);
    }
  };

  const handleRefreshLicense = async () => {
    setMsg('');
    setPlanLoading(true);
    try {
      await refreshLicense({ hard: true });
      setMsg('License refreshed.');
    } catch (err) {
      setMsg('Refresh failed. Please try again.');
    } finally {
      setPlanLoading(false);
    }
  };

  /* -------------------- LOGGED OUT - full-page auth layout -------------------- */

  if (!isLoggedIn) {
    return (
      <div className="h-screen overflow-hidden bg-white font-sans text-[#111827]" style={{ fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        {/* Web font loader */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
        />

        <div className="relative z-10 flex h-screen w-full">
          <div
            className={[
              'grid h-screen w-full overflow-hidden transition-all duration-700 lg:grid-cols-[minmax(430px,0.92fr)_minmax(540px,1.08fr)]',
              mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
            ].join(' ')}
          >
            <section className="relative flex h-screen items-center justify-center overflow-hidden bg-white px-5 py-5 sm:px-8 lg:px-12">
              <div className="pointer-events-none absolute left-[-130px] top-[-90px] h-64 w-80 rotate-[-10deg] rounded-[58px] bg-[radial-gradient(circle_at_35%_40%,rgba(111,77,255,0.18),transparent_50%),#f4f5f8]" />
              <div className="pointer-events-none absolute bottom-[-150px] right-[-150px] h-72 w-80 rotate-[12deg] rounded-[64px] bg-[radial-gradient(circle_at_70%_25%,rgba(34,197,94,0.14),transparent_46%),#f4f5f8]" />

              <div className="relative z-10 w-full max-w-[500px]">
                <div className="mb-6 flex justify-center">
                  <img src="/logo.png" alt="Studio Photuna" className="h-16 w-auto sm:h-[72px]" />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('google')}
                    disabled={loading}
                    className="inline-flex min-h-[52px] w-full items-center justify-center gap-3 rounded-full border border-[#dedfe6] bg-white px-5 text-sm font-black text-[#111827] transition hover:bg-[#f4f5f8] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <GoogleIcon />
                    Sign in with Google
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSocialLogin('apple')}
                    disabled={loading}
                    className="inline-flex min-h-[52px] w-full items-center justify-center gap-3 rounded-full border border-[#dedfe6] bg-white px-5 text-sm font-black text-[#111827] transition hover:bg-[#f4f5f8] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <AppleIcon />
                    Sign in with Apple
                  </button>
                </div>

                {/* Divider */}
                <div className="my-5 flex items-center gap-4">
                  <div className="h-px flex-1 bg-[#dedfe6]" />
                  <span className="text-xs font-black uppercase tracking-[0.16em] text-[#8b92a6]">or continue with email</span>
                  <div className="h-px flex-1 bg-[#dedfe6]" />
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4 rounded-[28px] border border-[#dedfe6] bg-white p-5 text-left shadow-[0_30px_90px_rgba(17,24,39,0.12)] sm:p-6" noValidate>
                  <div className="grid grid-cols-2 gap-2 rounded-full bg-[#f4f5f8] p-1.5">
                    {[
                      ['login', 'Login'],
                      ['register', 'Sign up'],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setMsg('');
                          setMode(key);
                        }}
                        className={[
                          'rounded-full px-4 py-3 text-sm font-black transition',
                          mode === key ? 'bg-white text-[#111827] shadow-[0_8px_22px_rgba(17,24,39,0.08)]' : 'text-[#111827]/70 hover:text-[#111827]',
                        ].join(' ')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {mode === 'register' && (
                    <PillInput
                      id="name"
                      label="Full name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      autoComplete="name"
                      required
                    />
                  )}

                  <PillInput
                    id="email"
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />

                  <PillPasswordField
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    showPassword={showPassword}
                    onToggle={() => setShowPassword((s) => !s)}
                  />

                  {mode === 'login' && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="text-sm font-extrabold text-[#6f4dff] transition hover:text-[#4b32c3]"
                        onClick={handleForgotPassword}
                      >
                        Forgot Password?
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex min-h-[54px] w-full items-center justify-center rounded-full bg-[#6f4dff] px-6 text-[15px] font-black text-white transition hover:-translate-y-0.5 hover:bg-[#4b32c3] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {viewCopy.submitLabel}
                  </button>

                  <p className="pt-1 text-center text-sm text-[#5f6678]">
                    {viewCopy.switchPrompt}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMsg('');
                        setMode((c) => (c === 'login' ? 'register' : 'login'));
                      }}
                      className="font-black text-[#111827] underline decoration-[#dedfe6] underline-offset-4 transition hover:text-[#6f4dff]"
                    >
                      {viewCopy.switchAction}
                    </button>
                  </p>

                  <AuthMessage message={msg} />
                </form>
              </div>
            </section>

            <section className="relative hidden h-screen overflow-hidden bg-[#f4f5f8] text-[#111827] lg:block">
              <div className="pointer-events-none absolute right-[-160px] top-[-110px] h-[330px] w-[430px] rotate-[9deg] rounded-[72px] bg-[radial-gradient(circle_at_70%_35%,rgba(111,77,255,0.18),transparent_48%),#e9ebf2]" />
              <div className="pointer-events-none absolute bottom-[-160px] left-[18%] h-[320px] w-[360px] rotate-[-10deg] rounded-[76px] bg-[radial-gradient(circle_at_30%_30%,rgba(236,72,153,0.12),transparent_46%),#eceef5]" />

              <div className="relative z-10 flex h-full flex-col justify-center px-10 py-10 xl:px-16">
                <div key={activeInfo.title}>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-[#6f4dff]">{activeInfo.eyebrow}</p>
                  <h2 className="max-w-xl text-5xl font-black leading-[1.03] tracking-[-0.06em] text-[#111827] xl:text-6xl">
                    {activeInfo.title}
                  </h2>
                  <p className="mt-5 max-w-xl text-base leading-7 text-[#5f6678]">
                    {activeInfo.copy}
                  </p>
                </div>

                <div className="mt-8 grid grid-cols-2 gap-4">
                  {activeInfo.cards.map(([number, title, copy]) => (
                    <div key={`${activeInfo.eyebrow}-${title}`} className="min-h-[168px] rounded-[26px] border border-[#dedfe6] bg-white p-5 shadow-[0_16px_46px_rgba(17,24,39,0.08)] transition duration-300 hover:-translate-y-1">
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-[#f4f5f8] text-xs font-black text-[#6f4dff]">{number}</span>
                      <h3 className="mt-5 text-lg font-black text-[#111827]">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-[#5f6678]">{copy}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 flex items-center gap-3">
                  {authInfoSlides.map((slide, index) => (
                    <button
                      key={slide.eyebrow}
                      type="button"
                      onClick={() => setActiveAuthSlide(index)}
                      className={[
                        'h-2.5 rounded-full transition-all',
                        activeAuthSlide === index ? 'w-10 bg-[#6f4dff]' : 'w-2.5 bg-[#cfd3dd] hover:bg-[#8b92a6]',
                      ].join(' ')}
                      aria-label={`Show ${slide.eyebrow}`}
                    />
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  /* -------------------- LOGGED IN — account center (refreshed) -------------------- */

  return (
    <div className="min-h-screen bg-white px-4 py-6 font-sans text-[#5f6678] sm:px-6 lg:px-8" style={{ fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
      />

      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <img src="/logo-dark.png" alt="Studio Photuna" className="h-11 w-auto" />
          <button
            className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-[#dedfe6] bg-white px-6 text-sm font-extrabold text-[#111827] transition hover:bg-[#f4f5f8]"
            onClick={logout}
          >
            Logout
          </button>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-[#dedfe6] bg-white shadow-[0_30px_90px_rgba(17,24,39,0.12)]">
          <div className="relative overflow-hidden border-b border-[#dedfe6] bg-[#f4f5f8] px-6 py-7 text-[#111827] sm:px-8">
            <div className="pointer-events-none absolute right-[-80px] top-[-70px] h-48 w-64 rotate-[10deg] rounded-[46px] bg-[radial-gradient(circle_at_70%_30%,rgba(111,77,255,0.2),transparent_50%),#e8e9f0]" />
            <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#dedfe6] bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-[#6f4dff]">
                  Account Center
                </div>
                <h2
                  className="mt-3 text-4xl font-black tracking-[-0.055em] text-[#111827]"
                >
                  Signed in successfully
                </h2>
                <p className="mt-2 text-sm text-[#5f6678]">
                  Manage authentication, subscription access, and booth business workflow.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="space-y-6">
              <div className="rounded-3xl border border-[#dedfe6] bg-[#f4f5f8] p-5">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8b92a6]">Account</p>
                <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-[#5f6678]">Signed in as</p>
                    <p className="text-lg font-black text-[#111827]">{user?.email || 'Unknown user'}</p>
                  </div>
                  <div className="rounded-full border border-[#dedfe6] bg-white px-4 py-2 text-sm text-[#5f6678]">
                    Plan: <span className="font-black text-[#111827]">{gating.plan || 'none'}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">License status</p>
                    <h3 className="mt-2 text-lg font-semibold text-slate-900">
                      {gating.allow ? 'Workspace unlocked' : 'Restricted mode active'}
                    </h3>
                  </div>
                  <span
                    className={[
                      'inline-flex rounded-full px-3 py-1 text-xs font-semibold',
                      gating.allow ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
                    ].join(' ')}
                  >
                    {gating.allow ? 'Licensed' : 'Restricted'}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {gating.allow
                    ? 'All configured dashboard features are available for this account.'
                    : `Watermark and feature limitations are active${gating.reason ? ` - ${gating.reason}` : '.'}`}
                </p>

                {!gating.allow && (
                  <div className="mt-5 rounded-3xl border border-indigo-100 bg-indigo-50/70 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Studio Photuna Pro</p>
                        <h4 className="mt-1 text-2xl font-semibold text-slate-950">{selectedProPlan.price}</h4>
                        <p className="mt-1 max-w-lg text-sm leading-6 text-slate-600">{selectedProPlan.note}</p>
                      </div>

                      <div className="inline-flex rounded-full border border-indigo-200 bg-white p-1">
                        {Object.values(proPlans).map((item) => (
                          <button
                            key={item.plan}
                            type="button"
                            onClick={() => setBillingCycle(item.plan)}
                            className={[
                              'rounded-full px-4 py-2 text-xs font-semibold transition',
                              billingCycle === item.plan
                                ? 'bg-slate-950 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-950',
                            ].join(' ')}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedProPlan.chips.map((chip) => (
                        <span key={chip} className="rounded-full border border-indigo-100 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-3">
                  {!gating.allow && (
                    <>
                      <button
                        className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700 disabled:opacity-50"
                        onClick={redeemTrial}
                        disabled={planLoading}
                      >
                        {planLoading ? 'Please wait...' : 'Redeem 14-day Trial'}
                      </button>
                      <button
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                        onClick={() => upgrade(selectedProPlan.plan)}
                        disabled={planLoading}
                      >
                        {planLoading ? 'Please wait...' : selectedProPlan.cta}
                      </button>
                    </>
                  )}
                  <button
                    className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    onClick={handleRefreshLicense}
                    disabled={planLoading}
                  >
                    {planLoading ? 'Refreshing...' : 'Refresh License'}
                  </button>
                </div>
              </div>

              <AuthMessage message={msg} />

              <div className="rounded-3xl border border-slate-200 bg-white p-5">
                {children}
              </div>
            </section>

            <aside className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">License entitlements</p>
                <div className="mt-4 space-y-2.5 text-sm text-slate-600">
                  {[
                    { label: 'Plan', value: gating.plan || 'Free' },
                    { label: 'Status', value: gating.allow ? 'Licensed' : 'Restricted' },
                    { label: 'Watermark', value: gating.watermark ? 'Enabled' : 'Off' },
                    { label: 'Max events', value: gating.maxEvents ? String(gating.maxEvents) : 'Unlimited' },
                    { label: 'Templates', value: gating.templates ? String(gating.templates) : 'Unlimited' },
                    { label: 'Priority support', value: gating.prioritySupport ? 'Yes' : 'No' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-2.5">
                      <span className="text-slate-500">{label}</span>
                      <span className="font-semibold text-slate-900">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>

        <Footer />
      </div>
    </div>
  );
}
