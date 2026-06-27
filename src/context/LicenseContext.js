import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../services/licensingApi';
import { useAuth } from './AuthContext';

const LicenseCtx = createContext(null);

export function useLicense() {
  return useContext(LicenseCtx);
}

function detectPlatform() {
  if (typeof window !== 'undefined' && window.process?.platform) return window.process.platform;
  if (typeof navigator !== 'undefined') {
    return navigator.userAgentData?.platform || navigator.platform || 'web';
  }
  return 'web';
}

function normalizePem(pem) {
  if (!pem) return pem;
  if (pem.includes('\n')) return pem;
  return pem
    .replace('-----BEGIN PUBLIC KEY-----', '-----BEGIN PUBLIC KEY-----\n')
    .replace('-----END PUBLIC KEY-----', '\n-----END PUBLIC KEY-----');
}

function getEnvPublicKey() {
  const vitePk =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    (import.meta.env.VITE_LICENSE_PUBLIC_KEY || import.meta.env.VITE_PUBLIC_KEY);
  const craPk =
    typeof process !== 'undefined' &&
    process.env &&
    (process.env.REACT_APP_LICENSE_PUBLIC_KEY || process.env.REACT_APP_PUBLIC_KEY);
  return vitePk || craPk || null;
}

function normalizeLicense(raw) {
  if (!raw) return null;
  return {
    ...raw,
    active: ['active', 'trialing'].includes(raw.state) && raw.plan !== 'free',
    expiresAt: raw.expiresAt || raw.expires_at || null,
    trialRedeemed: Boolean(raw.trialRedeemed || raw.trial_redeemed),
    trialExpired: Boolean(raw.trialExpired || raw.trial_expired),
  };
}

// Read license data via IPC — main process uses supabaseAdmin (service role, bypasses RLS).
// This is more reliable than querying from the renderer's anon client which requires
// a SELECT RLS policy and an active session on the anon key.
async function fetchLicenseViaIpc(userId) {
  try {
    const data = await window.electron.invoke('license:read', userId);
    if (!data?.plan) return null;

    const expiresMs = data.expires_at ? new Date(data.expires_at).getTime() : null;
    const trialExpired = data.plan === 'trial' && expiresMs !== null && expiresMs < Date.now();

    // Apply safe defaults for optional columns that may not exist in older Supabase schemas.
    const isPaid = data.plan !== 'free' && data.plan !== 'trial';
    return {
      plan: data.plan,
      state: data.state || 'active',
      expiresAt: data.expires_at ?? null,
      trialRedeemed: Boolean(data.trial_redeemed),
      trialExpired,
      entitlements: {
        watermark:       data.watermark       ?? (isPaid ? false : true),
        maxEvents:       data.max_events      ?? (isPaid ? 100   : 1),
        templates:       data.templates       ?? (isPaid ? 25    : 3),
        prioritySupport: data.priority_support ?? (data.plan === 'yearly'),
        galleryAddon:    Boolean(data.gallery_addon),
        galleryEnabled:  Boolean(data.gallery_addon),
      },
    };
  } catch {
    return null;
  }
}

async function readLicenseCache(userId) {
  try {
    return await window.electron.invoke('license:cache-read', userId);
  } catch { return null; }
}

async function writeLicenseCache(userId, licenseData, signedLicense, publicKey) {
  try {
    await window.electron.invoke('license:cache-write', userId, { licenseData, signedLicense, publicKey });
  } catch { /* best-effort */ }
}

const PLAN_RANK = { free: 0, trial: 1, monthly: 2, yearly: 3 };

// Reasons where we trust the Supabase-sourced license data instead of requiring
// a signed JWT (JWT unavailable = no private key configured or API server down).
const SOFT_FAIL_REASONS = new Set(['no_license', 'no_public_key', 'no_verifier', 'init', 'signature_invalid']);

export function LicenseProvider({ children }) {
  const { user, profile, loading: authLoading } = useAuth();

  const [license, setLicense] = useState(null);
  const [signedLicense, setSignedLicense] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  const [usable, setUsable] = useState({ allow: false, reason: 'init' });
  const [loading, setLoading] = useState(true);

  const refreshLicense = useCallback(async ({ hard = false } = {}) => {
    if (authLoading) return null;

    if (!user?.id) {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('device.attached.'))
        .forEach((k) => localStorage.removeItem(k));
      setLicense(null);
      setSignedLicense(null);
      setPublicKey(null);
      setUsable({ allow: false, reason: 'no_user' });
      setLoading(false);
      return null;
    }

    setLoading(true);

    // Restore the local cache immediately so the UI shows the correct plan
    // while network requests are in flight — prevents the "Free" flash on Ctrl+R.
    const earlyCache = await readLicenseCache(user.id);
    if (earlyCache?.licenseData && (PLAN_RANK[earlyCache.licenseData.plan] ?? -1) > PLAN_RANK.free) {
      setLicense(normalizeLicense(earlyCache.licenseData));
      setSignedLicense(earlyCache.signedLicense || null);
      setPublicKey(earlyCache.publicKey || null);
    }

    try {
      // Device attachment
      if (hard) localStorage.removeItem(`device.attached.${user.id}`);
      const alreadyAttached = localStorage.getItem(`device.attached.${user.id}`) === '1';
      const fpRes = await (window.system?.getFingerprint?.() ?? Promise.resolve(null)).catch(() => null);
      if (!alreadyAttached && fpRes?.ok && fpRes.fingerprint) {
        try {
          await api.attachDevice(fpRes.fingerprint, detectPlatform());
          localStorage.setItem(`device.attached.${user.id}`, '1');
        } catch (e) {
          console.warn('attachDevice failed', e);
        }
      }

      // Step 1 — on hard refresh (e.g. after Stripe checkout), pull live state from Stripe
      // into Supabase so the subsequent reads see the updated plan.
      // 30 s timeout: server Supabase calls are now bounded at 9 s, but network + retries
      // can add up. Never let this hang the whole refresh indefinitely.
      let billingResult = null;
      if (hard) {
        try {
          billingResult = await Promise.race([
            api.billingSync(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('billing_sync_timeout')), 30000)
            ),
          ]);
          if (billingResult?.synced && billingResult?.synced_supabase === false) {
            console.error('[license] billingSync: Stripe confirmed but Supabase write FAILED:',
              billingResult.supabase_error,
              '— Check your licensing server console for details.');
          }
        } catch (e) {
          console.warn('[license] billingSync failed or timed out:', e?.message);
        }
      }

      // Step 2 — read license via IPC (supabaseAdmin in main, no RLS/auth issues)
      const sbLicense = await fetchLicenseViaIpc(user.id);

      // Step 3 — try the API for the signed JWT (best-effort; failure is not fatal)
      let apiRes = null;
      try {
        apiRes = hard ? await api.licenseRefresh() : await api.licenseStatus();
      } catch (e) {
        console.warn('[license] API unavailable, using Supabase data:', e?.message);
      }

      // Pick the highest-ranked plan across all three sources.
      // billingSync is authoritative for Stripe-confirmed plans.
      const apiPlanRank     = PLAN_RANK[apiRes?.license?.plan] ?? -1;
      const sbPlanRank      = PLAN_RANK[sbLicense?.plan] ?? -1;
      const billingPlanRank = PLAN_RANK[billingResult?.license?.plan] ?? -1;
      let licenseData = apiPlanRank >= sbPlanRank ? (apiRes?.license ?? sbLicense) : sbLicense;
      if (billingResult?.synced && billingPlanRank > (PLAN_RANK[licenseData?.plan] ?? -1)) {
        licenseData = billingResult.license;
      }

      // If live sources returned nothing or only a free plan, try the local cache.
      // The cache is written only after a confirmed paid plan, so it's safe to trust.
      const livePlanRank = PLAN_RANK[licenseData?.plan] ?? -1;
      if (livePlanRank <= PLAN_RANK.free) {
        const cached = await readLicenseCache(user.id);
        const cachePlanRank = PLAN_RANK[cached?.licenseData?.plan] ?? -1;
        if (cachePlanRank > livePlanRank) {
          console.info('[license] live data is free/absent — restoring from local cache');
          licenseData = cached.licenseData;
          setLicense(normalizeLicense(licenseData));
          setSignedLicense(cached.signedLicense || null);
          setPublicKey(cached.publicKey || null);
          return { license: licenseData };
        }
      }

      if (!licenseData) {
        setUsable({ allow: false, reason: 'no_license_data' });
        return null;
      }

      const useBillingJwt = billingResult?.synced && licenseData === billingResult.license;
      const resolvedSignedLicense = useBillingJwt
        ? (billingResult.signedLicense || null)
        : (apiRes?.signedLicense || null);
      const resolvedPublicKey = useBillingJwt
        ? (billingResult.publicKey || null)
        : (apiRes?.publicKey || null);

      setLicense(normalizeLicense(licenseData));
      setSignedLicense(resolvedSignedLicense);
      setPublicKey(resolvedPublicKey);

      // Persist to local cache whenever we have a paid plan confirmed by live sources.
      if (livePlanRank > PLAN_RANK.free) {
        writeLicenseCache(user.id, licenseData, resolvedSignedLicense, resolvedPublicKey);
      }

      return billingResult?.synced ? billingResult : (apiRes ?? { license: licenseData });
    } catch (err) {
      console.warn('license refresh failed', err);
      setUsable({ allow: false, reason: err?.message || 'license_status_failed' });
      return null;
    } finally {
      setLoading(false);
    }
  }, [authLoading, user?.id]);

  const refreshRef = useRef(refreshLicense);
  useEffect(() => { refreshRef.current = refreshLicense; }, [refreshLicense]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await refreshLicense(); };
    run();
    return () => { cancelled = true; };
  }, [refreshLicense]);

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      const token = signedLicense;
      const pk = normalizePem(publicKey || getEnvPublicKey());
      const expectedUserId = user?.id || null;

      if (!token) { setUsable({ allow: false, reason: 'no_license' }); return; }
      if (!pk) { setUsable({ allow: false, reason: 'no_public_key' }); return; }
      if (!expectedUserId) { setUsable({ allow: false, reason: 'no_subject' }); return; }
      if (!window.licenseVerifier) { setUsable({ allow: false, reason: 'no_verifier' }); return; }

      try {
        const verified = await window.licenseVerifier.verifySignedLicense(token, pk);
        const policy = window.licenseVerifier.isLicenseUsable(verified, {
          expectedIssuer: 'StudioPhotuna-Licensing',
          expectedType: 'license',
          expectedUserId,
        });
        if (!cancelled) setUsable(policy);
      } catch (e) {
        console.warn('[license] verification failed', e);
        if (!cancelled) setUsable({ allow: false, reason: 'signature_invalid' });
      }
    };

    verify();
    return () => { cancelled = true; };
  }, [signedLicense, publicKey, user?.id]);

  const ent = license?.entitlements || {};
  // licenseActive is true if the license JWT confirms an active paid plan,
  // OR if the Supabase profile row already reflects a paid plan (reliable fallback
  // when the JWT is unavailable or hasn't been fetched yet).
  const licenseActive = (
    ['active', 'trialing'].includes(license?.state) && license?.plan !== 'free'
  ) || (
    ['monthly', 'yearly', 'trial'].includes(profile?.subscription_plan)
  );

  const gating = useMemo(() => {
    // When JWT is unavailable (API down, no private key) but Supabase data
    // confirms an active plan, trust the Supabase data and allow access.
    const jwtSoftFail = !usable.allow && SOFT_FAIL_REASONS.has(usable.reason);
    const allow = usable.allow || (jwtSoftFail && licenseActive);

    return {
      allow,
      reason: usable.reason,
      plan: license?.plan || profile?.subscription_plan || null,
      state: license?.state || null,
      active: licenseActive,
      watermark: Boolean(ent.watermark),
      maxEvents: ent.maxEvents ?? 0,
      templates: ent.templates ?? 0,
      prioritySupport: Boolean(ent.prioritySupport),
      galleryAddon: Boolean(ent.galleryAddon),
      galleryEnabled: Boolean(ent.galleryEnabled || ent.galleryAddon),
      expiresAt: license?.expiresAt || null,
    };
  }, [usable, ent, license, licenseActive, profile?.subscription_plan]);

  return (
    <LicenseCtx.Provider value={{ license, signedLicense, publicKey, gating, loading, refreshLicense }}>
      {children}
    </LicenseCtx.Provider>
  );
}
