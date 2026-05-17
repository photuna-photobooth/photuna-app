
// src/App.js
import React, { useEffect, useState, useRef } from "react";
import AdminDashboard from "./screens/AdminDashboard";
import PhotoBooth from "./screens/PhotoBooth";
import AuthGate from "./components/AuthGate"; // from earlier step
import { useAuth } from "./context/AuthContext";
import { useLicense } from "./context/LicenseContext";
import { registerBooth, unregisterBooth } from './services/boothRegistry';
import { sendRemoteAck, subscribeToRemoteCommands } from './services/remoteControl';

function AppLoadingScreen({ message }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-slate-50">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-200 border-t-indigo-600" />
      <p className="text-sm font-medium text-slate-500">{message}</p>
    </div>
  );
}

export default function App() {
  const { user, logout, loading: authLoading } = useAuth();
  const unsubRef = useRef(null);
  const boothIdRef = useRef(null);
  const { gating } = useLicense(); // { allow, reason, plan, watermark, maxEvents, templates, expiresAt }
  const [mode, setMode] = useState("admin"); // "admin" | "photobooth"
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [frames, setFrames] = useState([]);

  // Optional: load frames or other assets once
  useEffect(() => {
    (async () => {
      try {
        const loadedFrames = (await window.api?.getFrames?.()) ?? [];
        setFrames(Array.isArray(loadedFrames) ? loadedFrames : []);
      } catch (err) {
        console.warn("No frames API or failed to load frames", err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    let boothId = null;

    (async () => {
      // Get device fingerprint from Electron
      const fp = await window.system?.getFingerprint?.();
      const fingerprint = fp?.fingerprint ?? null;

      // Register booth in Supabase
      const booth = await registerBooth({
        userId: user.id,
        boothName: 'My Photo Booth',      // or pull from settings
        fingerprint,
        platform: navigator.userAgent,
        appVersion: '1.0.0',
      });

      if (!booth) return;
      boothId = booth.id;
      boothIdRef.current = booth.id;

      // Subscribe to remote commands for this booth
      unsubRef.current = subscribeToRemoteCommands(boothId, handleRemoteCommand);
    })();

    return () => {
      unsubRef.current?.();
      boothIdRef.current = null;
      unregisterBooth();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Called by AdminDashboard when user chooses to start photobooth for an event
  const handleStartPhotobooth = async (eventObj) => {
    if (!eventObj) return;
    // License gate: only allow photobooth if license is usable
    if (!gating.allow) {
      // You can show a toast/modal prompting to Redeem Trial / Upgrade
      alert(
        `Your license is restricted (${gating.reason}). Please redeem the free trial or upgrade to continue.`
      );
      return;
    }

    try {
      const config = (await window.api?.getEventData?.(eventObj.id)) ?? {};
      const ev = { ...eventObj, config };
      setSelectedEvent(ev);
      setMode("photobooth");
    } catch (err) {
      console.error("Failed to load event config", err);
      setSelectedEvent(eventObj);
      setMode("photobooth");
    }
  };

  const handleExitPhotobooth = (updatedEvent) => {
    // You can persist analytics or captures here if desired
    setSelectedEvent(null);
    setMode("admin");
  };

  // Block render while Supabase session is restoring (Ctrl+R, cold start).
  // Without this gate, the app briefly shows AuthGate or a null-license dashboard
  // before the session resolves, making the plan appear as "Free".
  if (authLoading) {
    return <AppLoadingScreen message="Restoring your session…" />;
  }

  // Not logged in? Show Auth Gate (login/register + trial/upgrade)
  if (!user) {
    return <AuthGate />;
  }

  async function handleRemoteCommand(message = {}) {
    const { action } = message;
    const payload = message.payload || {};

    switch (action) {
      case 'update-template':
        // Apply a new template pushed from admin dashboard
        console.log('Remote: update template', payload.templateId);
        // dispatch to your state or call native?.setTemplates?.(...)
        break;

      case 'update-event':
        // Admin pushed updated event settings
        console.log('Remote: update event', payload.event);
        if (payload.event?.id) {
          const currentEvents = (await window.api?.getEvents?.({ userId: user.id })) || [];
          const exists = currentEvents.some((event) => event.id === payload.event.id);
          const nextEvents = exists
            ? currentEvents.map((event) => event.id === payload.event.id ? payload.event : event)
            : [...currentEvents, payload.event];

          await window.api?.setEvents?.(nextEvents, { userId: user.id });
          await window.api?.setCurrentEventId?.(payload.event.id);
          setSelectedEvent((current) =>
            current?.id === payload.event.id ? payload.event : current
          );
          await sendRemoteAck(boothIdRef.current, action, { ok: true, eventId: payload.event.id });
        }
        break;

      case 'restart-booth':
        // Send to Electron to restart the renderer
        window.api?.invoke?.('app:restart');
        break;

      case 'lock-booth':
        // Block the kiosk UI
        console.log('Remote: booth locked');
        break;

      case 'ping':
        // Admin is checking if booth is online
        console.log('Remote: pong');
        await sendRemoteAck(boothIdRef.current, action, { ok: true });
        break;

      default:
        console.warn('Unknown remote command:', action);
    }
  }

  return (
    <div className="w-full h-screen">

      {mode === "photobooth" && selectedEvent ? (
        <PhotoBooth
          frames={frames}
          onShortcut={() => { }}
          initialEvent={selectedEvent}
          onExit={(updatedEvent) => {
            handleExitPhotobooth(updatedEvent);
          }}
        />
      ) : (
        <AdminDashboard
          onLogout={() => {
            // logout() is already called inside AdminDashboard's handleLogoutClick.
            // Setting user = null there causes App to re-render <AuthGate /> here.
            // Nothing extra needed.
          }}
          onStartPhotobooth={handleStartPhotobooth}
        />
      )}
    </div>
  );
}
