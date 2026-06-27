import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function trackRegistration(userId, source = "website", utmSource = null) {
  if (!userId) return;
  try {
    const { error } = await supabase.from("analytics_registrations").insert({
      user_id: userId,
      source,
      utm_source: utmSource,
    });
    if (error) console.error("[analyticsTracker] registration failed:", error);
  } catch (err) {
    console.error("[analyticsTracker] registration error:", err);
  }
}

export async function trackSubscriptionEvent(
  userId,
  eventType,
  planTo,
  planFrom = null,
  amount = null,
  stripeId = null
) {
  if (!userId) return;
  try {
    const { error } = await supabase.from("analytics_subscriptions").insert({
      user_id: userId,
      event_type: eventType,
      plan_from: planFrom,
      plan_to: planTo,
      billing_amount: amount,
      stripe_subscription_id: stripeId,
    });
    if (error)
      console.error("[analyticsTracker] subscription event failed:", error);
  } catch (err) {
    console.error("[analyticsTracker] subscription error:", err);
  }
}

export async function trackRevenueEvent(
  userId,
  eventType,
  amount,
  stripeChargeId = null,
  stripeInvoiceId = null,
  boothId = null,
  eventId = null
) {
  if (!userId) return;
  try {
    const { error } = await supabase.from("analytics_revenue").insert({
      user_id: userId,
      event_type: eventType,
      amount,
      stripe_charge_id: stripeChargeId,
      stripe_invoice_id: stripeInvoiceId,
      booth_id: boothId,
      event_id: eventId,
    });
    if (error)
      console.error("[analyticsTracker] revenue event failed:", error);
  } catch (err) {
    console.error("[analyticsTracker] revenue error:", err);
  }
}
