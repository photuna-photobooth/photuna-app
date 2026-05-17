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

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-slate-700">
    <path
      fill="currentColor"
      d="M12 2l7 3v6c0 5-3.4 9.7-7 11-3.6-1.3-7-6-7-11V5l7-3zm0 3.2L7 7.3v3.4c0 3.8 2.3 7.4 5 8.6 2.7-1.2 5-4.8 5-8.6V7.3l-5-2.1z"
    />
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
        <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-slate-700 transition-colors">Terms &amp; Conditions</a>
        <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-slate-700 transition-colors">Privacy Policy</a>
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
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-slate-700">
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
        className="w-full rounded-full border border-slate-200 bg-white px-5 py-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
      />
    </div>
  );
}

function PillPasswordField({ value, onChange, showPassword, onToggle }) {
  return (
    <div>
      <label htmlFor="password" className="mb-2 block text-sm font-semibold text-slate-700">
        Password
      </label>
      <div className="group flex items-center rounded-full border border-slate-200 bg-white pr-2 transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
        <input
          id="password"
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder="Enter your password"
          autoComplete="current-password"
          className="w-full rounded-full bg-transparent px-5 py-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          required
          minLength={6}
        />
        <button
          type="button"
          className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          onClick={onToggle}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

/* Decorative wave pattern matching the reference */
function WavePattern() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <pattern id="photuna-waves" x="0" y="0" width="600" height="120" patternUnits="userSpaceOnUse">
          <path
            d="M0 60 Q 75 20, 150 60 T 300 60 T 450 60 T 600 60"
            fill="none"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="3"
          />
          <path
            d="M0 90 Q 75 50, 150 90 T 300 90 T 450 90 T 600 90"
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="3"
          />
        </pattern>
      </defs>
      <rect width="600" height="800" fill="url(#photuna-waves)" />
    </svg>
  );
}

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
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);

  const isLoggedIn = !!user;

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);

  const viewCopy = useMemo(() => {
    if (mode === 'register') {
      return {
        eyebrow: 'Start your workspace',
        title: 'Create your studio',
        subtitle: 'Set up your Photuna workspace and start running booth events in minutes.',
        submitLabel: loading ? 'Creating account...' : 'Create account',
        switchPrompt: 'Already have an account?',
        switchAction: 'Sign in',
      };
    }
    return {
      eyebrow: 'Studio access',
      title: 'Welcome back',
      subtitle: 'Sign in to manage your booths, events, and licensed templates.',
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
      setMsg('Trial activated! Your 7-day trial is now live.');
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
      <div className="min-h-screen bg-[#f6f5f1] font-sans text-slate-950" style={{ fontFamily: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif' }}>
        {/* Web font loader */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
        />

        <div className="flex min-h-screen w-full">
          <div
            className={[
              'grid min-h-screen w-full overflow-hidden bg-[#f6f5f1] transition-all duration-700 lg:grid-cols-[minmax(420px,0.92fr)_minmax(520px,1.08fr)]',
              mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
            ].join(' ')}
            style={{ minHeight: '100vh' }}
          >
            <section className="flex min-h-screen flex-col justify-between bg-[#f6f5f1] px-6 py-8 sm:px-10 lg:px-14 xl:px-20">
              <div className="m-auto w-full max-w-[520px] py-10">
                {/* Brand */}
              
                <div className="">
                  <h1
                    className="text-4xl font-semibold leading-tight text-slate-950 sm:text-5xl"
                    style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}
                  >
                    {viewCopy.eyebrow.split(' ')[0]}{' '}
                    <span className="inline-block">{viewCopy.eyebrow.split(' ').slice(1).join(' ')}</span>
                  </h1>
                  <p className="mt-4 max-w-md text-base leading-7 text-slate-600">
                    {viewCopy.subtitle}
                  </p>
                </div>

                {/* Social */}
                <div className="mt-10 space-y-3">
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('google')}
                    disabled={loading}
                    className="inline-flex w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white px-5 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <GoogleIcon />
                    Sign in with Google
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSocialLogin('apple')}
                    disabled={loading}
                    className="inline-flex w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white px-5 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <AppleIcon />
                    Sign in with Apple
                  </button>
                </div>

                {/* Divider */}
                <div className="my-7 flex items-center gap-4">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">or continue with email</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
                        className="text-sm font-semibold text-slate-700 transition hover:text-slate-950"
                        onClick={handleForgotPassword}
                      >
                        Forgot Password?
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex w-full items-center justify-center rounded-full bg-slate-950 px-5 py-4 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(15,23,42,0.16)] transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {viewCopy.submitLabel}
                  </button>

                  <p className="pt-1 text-center text-sm text-slate-500">
                    {viewCopy.switchPrompt}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMsg('');
                        setMode((c) => (c === 'login' ? 'register' : 'login'));
                      }}
                      className="font-semibold text-slate-950 underline decoration-slate-300 underline-offset-4 transition hover:decoration-slate-950"
                    >
                      {viewCopy.switchAction}
                    </button>
                  </p>

                  <AuthMessage message={msg} />
                </form>
              </div>

              <p className="mt-10 text-xs text-slate-400">
                &copy; {new Date().getFullYear()} Studio Photuna. All Rights Reserved.
              </p>
            </section>

            <section className="relative hidden min-h-screen overflow-hidden bg-[#121418] p-10 text-white lg:block xl:p-14">
              <WavePattern />

              <div className="relative z-10 flex h-full flex-col justify-between p-2 sm:p-4">
                <div className="max-w-md">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/90">
                    <ShieldIcon />
                    <span>For studios &amp; events</span>
                  </div>

                  <h2
                    className="mt-16 max-w-xl text-5xl font-semibold leading-[1.03] text-white xl:text-6xl"
                    style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}
                  >
                    A focused workspace for modern photo booth studios.
                  </h2>
                  <p className="mt-6 max-w-md text-base leading-7 text-white/70">
                    Manage events, templates, galleries, and licensed booth access from one clean production-ready account.
                  </p>
                </div>

                <div className="mt-10 grid grid-cols-1 gap-3">
                  {[
                    { text: 'Secure operator access' },
                    { text: 'Subscription-aware entitlements' },
                    { text: 'Event and template management' },
                  ].map((item) => (
                    <div
                      key={item.text}
                      className="flex items-center gap-3 border-t border-white/10 pt-3 text-sm text-white/78"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-[#d7ff60]" />
                      <span>{item.text}</span>
                    </div>
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
    <div className="min-h-screen bg-slate-50 px-4 py-6 font-sans sm:px-6 lg:px-8" style={{ fontFamily: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif' }}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
      />

      <div className="mx-auto max-w-5xl">
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.08)]">
          <div className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 px-6 py-7 text-white sm:px-8">
            <WavePattern />
            <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white">
                  Account Center
                </div>
                <h2
                  className="mt-3 text-3xl font-bold tracking-tight"
                  style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}
                >
                  Signed in successfully 👋
                </h2>
                <p className="mt-2 text-sm text-white/85">
                  Manage authentication, subscription access, and workspace visibility.
                </p>
              </div>

              <button
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white hover:text-indigo-700"
                onClick={logout}
              >
                Logout
              </button>
            </div>
          </div>

          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Account</p>
                <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-slate-500">Signed in as</p>
                    <p className="text-lg font-semibold text-slate-900">{user?.email || 'Unknown user'}</p>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
                    Plan: <span className="font-semibold text-slate-900">{gating.plan || 'none'}</span>
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
                    : `Watermark and feature limitations are active${gating.reason ? ` — ${gating.reason}` : '.'}`}
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  {!gating.allow && (
                    <>
                      <button
                        className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700 disabled:opacity-50"
                        onClick={redeemTrial}
                        disabled={planLoading}
                      >
                        {planLoading ? 'Please wait…' : 'Redeem 7-day Trial'}
                      </button>
                      <button
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                        onClick={() => upgrade('monthly')}
                        disabled={planLoading}
                      >
                        {planLoading ? 'Please wait…' : 'Subscribe Monthly'}
                      </button>
                      <button
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                        onClick={() => upgrade('yearly')}
                        disabled={planLoading}
                      >
                        {planLoading ? 'Please wait…' : 'Subscribe Yearly'}
                      </button>
                    </>
                  )}
                  <button
                    className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    onClick={handleRefreshLicense}
                    disabled={planLoading}
                  >
                    {planLoading ? 'Refreshing…' : 'Refresh License'}
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
