import React, { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function AnalyticsDashboard({ userId }) {
  const [metrics, setMetrics] = useState({
    totalRegistrations: 0,
    monthRegistrations: 0,
    totalRevenue: 0,
    monthRevenue: 0,
    activeSubscriptions: 0,
    churnRate: 0,
    mrr: 0,
    revenueData: [],
    planDistribution: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    fetchAnalytics();
  }, [userId]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);

      const now = new Date();
      const monthAgo = new Date(now.getFullYear(), now.getMonth(), 1);
      const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

      // Fetch registration metrics
      const { data: registrations } = await supabase
        .from("analytics_registrations")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", yearAgo.toISOString());

      const totalReg = registrations?.length || 0;
      const monthReg = registrations?.filter(
        (r) => new Date(r.created_at) >= monthAgo
      ).length || 0;

      // Fetch revenue metrics
      const { data: revenue } = await supabase
        .from("analytics_revenue")
        .select("amount, created_at")
        .eq("user_id", userId)
        .gte("created_at", yearAgo.toISOString());

      const totalRev = revenue?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
      const monthRev = revenue
        ?.filter((r) => new Date(r.created_at) >= monthAgo)
        .reduce((sum, r) => sum + (r.amount || 0), 0) || 0;

      // Fetch subscription metrics
      const { data: subscriptions } = await supabase
        .from("analytics_subscriptions")
        .select("event_type, plan_to, created_at")
        .eq("user_id", userId)
        .gte("created_at", yearAgo.toISOString());

      const activeSubs = subscriptions?.filter(
        (s) => s.event_type !== "subscription_cancelled"
      ).length || 0;

      // Plan distribution
      const planCounts = {};
      subscriptions?.forEach((s) => {
        if (s.plan_to) {
          planCounts[s.plan_to] = (planCounts[s.plan_to] || 0) + 1;
        }
      });

      const planDistribution = Object.entries(planCounts).map(([name, value]) => ({
        name,
        value,
      }));

      // Revenue trend (last 30 days)
      const revenueByDay = {};
      revenue?.forEach((r) => {
        const day = new Date(r.created_at).toISOString().split("T")[0];
        revenueByDay[day] = (revenueByDay[day] || 0) + (r.amount || 0);
      });

      const revenueData = Object.entries(revenueByDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-30)
        .map(([date, amount]) => ({ date: date.slice(-5), amount: Math.round(amount) }));

      // Churn rate (cancellations last 30 days / avg active)
      const cancellations = subscriptions?.filter(
        (s) => s.event_type === "subscription_cancelled" && new Date(s.created_at) >= monthAgo
      ).length || 0;

      const churnRate = activeSubs > 0 ? Math.round((cancellations / activeSubs) * 100) : 0;
      const mrr = (monthRev / 30) * 30; // Rough MRR estimate

      setMetrics({
        totalRegistrations: totalReg,
        monthRegistrations: monthReg,
        totalRevenue: Math.round(totalRev),
        monthRevenue: Math.round(monthRev),
        activeSubscriptions: activeSubs,
        churnRate,
        mrr: Math.round(mrr),
        revenueData,
        planDistribution,
      });
    } catch (error) {
      console.error("[AnalyticsDashboard] Error fetching analytics:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading analytics...</div>;
  }

  const COLORS = ["#6f4dff", "#22c55e", "#f59e0b", "#ef4444"];

  return (
    <div className="space-y-6 p-8 bg-gray-50">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          label="Total Registrations"
          value={metrics.totalRegistrations}
          change={metrics.monthRegistrations}
          suffix=" this month"
        />
        <KPICard
          label="Revenue"
          value={`$${metrics.totalRevenue.toLocaleString()}`}
          change={`$${metrics.monthRevenue.toLocaleString()}`}
          suffix=" this month"
        />
        <KPICard
          label="Active Subscriptions"
          value={metrics.activeSubscriptions}
          change={metrics.churnRate}
          suffix="% churn rate"
        />
        <KPICard
          label="Monthly Recurring Revenue"
          value={`$${Math.round(metrics.mrr).toLocaleString()}`}
          change={`+${Math.max(0, Math.round(metrics.mrr - metrics.monthRevenue))}`}
          suffix=" projected"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Trend */}
        {metrics.revenueData.length > 0 && (
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm">
            <h3 className="text-lg font-semibold mb-4">Revenue Trend (Last 30 Days)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metrics.revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => `$${value}`} />
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke="#6f4dff"
                  dot={{ r: 4 }}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Plan Distribution */}
        {metrics.planDistribution.length > 0 && (
          <div className="bg-white p-6 rounded-2xl shadow-sm">
            <h3 className="text-lg font-semibold mb-4">Subscription Plans</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={metrics.planDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {metrics.planDistribution.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value} users`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({ label, value, change, suffix }) {
  const isPositive = typeof change === "number" ? change > 0 : !change.startsWith("-");

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mb-3">{value}</p>
      <p className={`text-sm ${isPositive ? "text-green-600" : "text-red-600"}`}>
        {isPositive ? "↑" : "↓"} {change} {suffix}
      </p>
    </div>
  );
}
