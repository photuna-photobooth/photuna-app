// src/screens/Reports.js
import React, { useEffect, useState, useCallback } from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS, Title, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, ArcElement,
} from 'chart.js';
import Papa from 'papaparse';

ChartJS.register(Title, Tooltip, Legend, CategoryScale, LinearScale, BarElement, ArcElement);

function priceForEvent(ev) {
  return (
    ev.settings?.business?.pricing?.pricePerSession ??
    ev.settings?.price ??
    0
  );
}

function isToday(dateStr) {
  const d = new Date(dateStr);
  const t = new Date();
  return (
    d.getDate() === t.getDate() &&
    d.getMonth() === t.getMonth() &&
    d.getFullYear() === t.getFullYear()
  );
}

function buildMetrics(events) {
  let totalRevenue = 0;
  let totalSessions = 0;
  let totalPhotos = 0;
  let totalRetakes = 0;
  let totalCompleted = 0;
  const templateUsage = {};

  for (const ev of events) {
    const price = priceForEvent(ev);
    const sessions = ev.sessions ?? [];

    totalSessions += sessions.length;
    totalRevenue += sessions.length * price;

    for (const s of sessions) {
      totalPhotos += s.photosCount ?? 0;
      totalRetakes += s.retakes ?? 0;
      if (s.completed !== false) totalCompleted++;
      if (s.template) {
        templateUsage[s.template] = (templateUsage[s.template] ?? 0) + 1;
      }
    }
  }

  return {
    totalRevenue,
    avgRevenuePerEvent: events.length ? totalRevenue / events.length : 0,
    sessions: totalSessions,
    photos: totalPhotos,
    retakes: totalRetakes,
    completionRate: totalSessions ? ((totalCompleted / totalSessions) * 100).toFixed(1) : 0,
    popularTemplates: templateUsage,
  };
}

export default function Reports() {
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [events, setEvents] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [filterEventId, setFilterEventId] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await window.api?.getEvents?.();
      if (!Array.isArray(all)) throw new Error('getEvents returned no data');
      setEvents(all);
      setMetrics(buildMetrics(all));
    } catch (err) {
      console.error('[Reports] load failed:', err);
      setError(err?.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-compute metrics whenever filter changes
  const filteredEvents =
    filterEventId === 'all' ? events : events.filter(e => String(e.id) === filterEventId);
  const filteredMetrics = filteredEvents.length ? buildMetrics(filteredEvents) : metrics;

  const handleExportCSV = () => {
    const rows = filteredEvents.flatMap(ev => {
      const price = priceForEvent(ev);
      return (ev.sessions ?? []).map(s => ({
        Event: ev.name ?? ev.id,
        SessionId: s.id,
        Date: s.createdAt ? new Date(s.createdAt).toLocaleString() : '',
        Photos: s.photosCount ?? 0,
        Retakes: s.retakes ?? 0,
        Template: s.template ?? '',
        Completed: s.completed !== false ? 'Yes' : 'No',
        Revenue: price,
      }));
    });

    if (!rows.length) { alert('No sessions to export.'); return; }

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'photobooth_reports.csv';
    link.click();
  };

  const templateChartData = {
    labels: Object.keys(filteredMetrics?.popularTemplates ?? {}),
    datasets: [{
      label: 'Sessions',
      data: Object.values(filteredMetrics?.popularTemplates ?? {}),
      backgroundColor: ['#6366F1', '#22C55E', '#FACC15', '#EF4444', '#3B82F6', '#EC4899', '#F97316'],
    }],
  };

  if (loading) return <div className="p-8 text-center text-lg">Loading reports…</div>;
  if (error)   return <div className="p-8 text-center text-red-500">{error}</div>;

  const m = filteredMetrics ?? {};

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Reports &amp; Insights</h1>
        <div className="flex gap-3 flex-wrap">
          <select
            value={filterEventId}
            onChange={e => setFilterEventId(e.target.value)}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:text-white"
          >
            <option value="all">All Events</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.name ?? ev.id}</option>
            ))}
          </select>
          <button
            onClick={load}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white rounded shadow text-sm"
          >
            Refresh
          </button>
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 bg-indigo-600 text-white rounded shadow hover:bg-indigo-700 text-sm"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Sessions',    value: m.sessions ?? 0 },
          { label: 'Total Photos',      value: m.photos ?? 0 },
          { label: 'Completion Rate',   value: `${m.completionRate ?? 0}%` },
          { label: 'Gross Revenue',     value: `₱${(m.totalRevenue ?? 0).toLocaleString()}` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white dark:bg-gray-800 p-5 rounded shadow text-center">
            <h3 className="text-gray-500 dark:text-gray-400 text-sm">{label}</h3>
            <p className="text-2xl font-semibold text-indigo-600 mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Secondary Stats */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded shadow">
        <h3 className="text-lg font-semibold mb-4 dark:text-white">Engagement</h3>
        <ul className="grid grid-cols-2 gap-y-3 text-sm dark:text-gray-300">
          <li>Total Retakes: <strong>{m.retakes ?? 0}</strong></li>
          <li>Avg Revenue / Event: <strong>₱{(m.avgRevenuePerEvent ?? 0).toFixed(2)}</strong></li>
          <li>Events Covered: <strong>{filteredEvents.length}</strong></li>
          <li>Avg Photos / Session: <strong>
            {m.sessions ? ((m.photos ?? 0) / m.sessions).toFixed(1) : '—'}
          </strong></li>
        </ul>
      </div>

      {/* Template Usage Chart */}
      {Object.keys(m.popularTemplates ?? {}).length > 0 && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded shadow">
          <h3 className="text-lg font-semibold mb-4 dark:text-white">Template Usage</h3>
          <Bar data={templateChartData} options={{ responsive: true, plugins: { legend: { display: false } } }} />
        </div>
      )}

      {/* Per-event breakdown table */}
      {filteredEvents.length > 0 && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded shadow overflow-x-auto">
          <h3 className="text-lg font-semibold mb-4 dark:text-white">By Event</h3>
          <table className="w-full text-sm text-left">
            <thead className="text-gray-500 dark:text-gray-400 border-b">
              <tr>
                <th className="py-2 pr-4">Event</th>
                <th className="py-2 pr-4 text-right">Sessions</th>
                <th className="py-2 pr-4 text-right">Photos</th>
                <th className="py-2 pr-4 text-right">Completed</th>
                <th className="py-2 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="dark:text-gray-300 divide-y dark:divide-gray-700">
              {filteredEvents.map(ev => {
                const sessions = ev.sessions ?? [];
                const price = priceForEvent(ev);
                const completed = sessions.filter(s => s.completed !== false).length;
                return (
                  <tr key={ev.id}>
                    <td className="py-2 pr-4 font-medium">{ev.name ?? ev.id}</td>
                    <td className="py-2 pr-4 text-right">{sessions.length}</td>
                    <td className="py-2 pr-4 text-right">
                      {sessions.reduce((n, s) => n + (s.photosCount ?? 0), 0)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {sessions.length ? `${Math.round(completed / sessions.length * 100)}%` : '—'}
                    </td>
                    <td className="py-2 text-right">₱{(sessions.length * price).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {m.sessions === 0 && (
        <p className="text-center text-gray-400 text-sm">
          No sessions recorded yet. Sessions appear here after photobooth flows complete.
        </p>
      )}
    </div>
  );
}
