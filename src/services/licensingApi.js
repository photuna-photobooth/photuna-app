import { supabase } from '../services/supabase.js';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8080';

// Cache the token via an auth-state subscriber so every API request doesn't
// call getSession() — concurrent getSession() calls fight for the navigator
// lock and cause "lock was released because another request stole it" errors.
let _cachedToken = null;

supabase.auth.onAuthStateChange((_event, session) => {
  _cachedToken = session?.access_token ?? null;
});

async function getAccessToken() {
  if (_cachedToken) return _cachedToken;
  // First call before any auth event — one-time fallback to getSession()
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message || 'Unable to get Supabase session');
  _cachedToken = data?.session?.access_token ?? null;
  return _cachedToken;
}

async function request(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const token = auth ? await getAccessToken() : null;

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const payload = await res.json();
      message = payload?.error || payload?.message || message;
    } catch {
      const text = await res.text().catch(() => '');
      message = text || message;
    }
    throw new Error(message);
  }

  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : res.text();
}

/* =========================
   Billing
========================= */

export const listInvoices = () => request('/billing/invoices');
export const downloadInvoice = (invoiceId) => request(`/billing/invoices/${invoiceId}/download`);
export const listPaymentMethods = () => request('/billing/payment-methods');

export const createSetupIntent = () =>
  request('/billing/create-setup-intent', { method: 'POST' });

export const setDefaultPaymentMethod = (paymentMethodId) =>
  request('/billing/default-payment-method', {
    method: 'POST',
    body: { paymentMethodId },
  });

export const detachPaymentMethod = (paymentMethodId) =>
  request('/billing/detach-payment-method', {
    method: 'POST',
    body: { paymentMethodId },
  });

export const getSubscription = () => request('/billing/subscription');

export const cancelSubscription = (atPeriodEnd = true) =>
  request('/billing/cancel-subscription', {
    method: 'POST',
    body: { atPeriodEnd },
  });

export const resumeSubscription = () =>
  request('/billing/resume-subscription', { method: 'POST' });

export const createCheckoutSession = (plan) =>
  request('/billing/create-checkout-session', {
    method: 'POST',
    body: { plan },
  });

export const createGalleryAddonCheckoutSession = () =>
  request('/billing/create-gallery-addon-session', {
    method: 'POST',
  });

// Call this after Stripe checkout redirects back to pull live subscription state
// from Stripe directly and write it to Supabase — does not depend on webhooks.
export const billingSync = () => request('/billing/sync', { method: 'POST' });

export const customerPortal = () =>
  request('/billing/customer-portal', { method: 'POST' });

export const getDisplayPrices = () =>
  request('/billing/prices', { auth: false });

/* =========================
   License
========================= */

export const licenseStatus = () => request('/license/status');

export const licenseRefresh = () => request('/license/refresh', { method: 'POST' });

export const attachDevice = (fingerprint, platform) =>
  request('/license/attach-device', {
    method: 'POST',
    body: { fingerprint, platform },
  });

export const detachDevice = (fingerprint) =>
  request('/license/detach-device', {
    method: 'POST',
    body: { fingerprint },
  });

export const redeemTrial = () =>
  request('/license/redeem-trial', { method: 'POST' });

/**
 * Test/dev only. Production upgrades should go through createCheckoutSession().
 * This now points to the Supabase license route, not the removed SQLite route.
 */
export const setPlan = (plan) =>
  request('/license/set-plan', {
    method: 'POST',
    body: { plan },
  });

/* =========================
   Profile
========================= */

export const me = () => request('/me');

export const updateUserProfile = (profile) =>
  request('/me', {
    method: 'PUT',
    body: profile,
  });

// Upload a raw image file as the user's avatar; returns { ok, avatar_url }.
export async function uploadAvatar(file) {
  const token = await getAccessToken();
  const res = await fetch(`${API}/me/avatar`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'image/jpeg',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const p = await res.json(); message = p?.error || message; } catch {}
    throw new Error(message);
  }
  return res.json();
}

// Change the current user's password after verifying their current password.
export const changePassword = (currentPassword, newPassword) =>
  request('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });

/* =========================
   Admin
========================= */

export const adminSetSubscription = (userId, payload) =>
  request(`/admin/users/${userId}/subscription`, {
    method: 'POST',
    body: payload,
  });

export const adminStartTrial = (userId, days = 7) =>
  request(`/admin/users/${userId}/trial`, {
    method: 'POST',
    body: { days },
  });

export const adminRevokeSubscription = (userId) =>
  request(`/admin/users/${userId}/subscription`, {
    method: 'DELETE',
  });
