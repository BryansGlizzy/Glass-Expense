import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Sparkles, ArrowDownToLine, RefreshCw, AlertCircle } from 'lucide-react';

export const OTAUpdateManager: React.FC = () => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [version, setVersion] = useState<string>('');
  const [statusText, setStatusText] = useState('Checking for updates...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let isMounted = true;
    let downloadListener: any = null;

    const checkForUpdates = async () => {
      try {
        // 1. Notify that current bundle booted successfully (guards against rollback)
        await CapacitorUpdater.notifyAppReady().catch(() => {});

        // 2. Fetch server update info with a 4s timeout (so offline / slow network doesn't block startup)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch('/api/app-update/check', {
          signal: controller.signal,
          headers: { 'Cache-Control': 'no-cache' },
        }).catch(() => null);

        clearTimeout(timeoutId);

        if (!response || !response.ok) {
          // Server unreachable or offline — drop straight into the app
          return;
        }

        const data = await response.json();
        if (!data || !data.available || !data.version || !data.url) {
          return;
        }

        // 3. Compare with currently active bundle
        const currentBundle = await CapacitorUpdater.current().catch(() => null);
        const currentVersion = currentBundle?.bundle?.version;

        if (currentVersion === data.version) {
          // Already on the latest version!
          return;
        }

        // An update is available! Display visible progress overlay
        if (!isMounted) return;
        setIsUpdating(true);
        setVersion(data.version);
        setStatusText('Downloading update...');
        setProgress(5);

        // 4. Attach download progress listener
        downloadListener = await CapacitorUpdater.addListener('download', (event) => {
          if (!isMounted) return;
          if (typeof event.percent === 'number') {
            setProgress(Math.max(5, Math.min(95, Math.round(event.percent))));
          }
        });

        // 5. Download the update bundle
        // The server publishes the bundle's SHA-256; the updater refuses to install a bundle that doesn't match.
        const bundle = await CapacitorUpdater.download({
          url: data.url,
          version: data.version,
          ...(data.checksum ? { checksum: data.checksum } : {}),
        });

        if (!isMounted) return;
        setProgress(100);
        setStatusText('Applying update & restarting...');

        // Short visual pause at 100% before reload
        setTimeout(async () => {
          try {
            await CapacitorUpdater.set(bundle);
          } catch (err: any) {
            console.error('Failed to set bundle:', err);
            if (isMounted) {
              setErrorMessage('Failed to apply update. Continuing to app...');
              setTimeout(() => setIsUpdating(false), 2000);
            }
          }
        }, 600);

      } catch (err: any) {
        console.error('OTA Update check/download failed:', err);
        // Fail-safe: Never block the user if update fails
        if (isMounted) {
          setIsUpdating(false);
        }
      }
    };

    checkForUpdates();

    return () => {
      isMounted = false;
      if (downloadListener) {
        downloadListener.remove?.();
      }
    };
  }, []);

  if (!isUpdating) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 backdrop-blur-2xl p-6 select-none animate-in fade-in duration-300">
      <div className="w-full max-w-sm rounded-3xl bg-slate-900/80 border border-emerald-500/30 p-8 shadow-[0_0_50px_rgba(16,185,129,0.15)] flex flex-col items-center text-center">
        {/* Glow Icon */}
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/30">
            {errorMessage ? (
              <AlertCircle className="w-8 h-8 text-white" />
            ) : progress >= 100 ? (
              <RefreshCw className="w-8 h-8 animate-spin text-white" />
            ) : (
              <ArrowDownToLine className="w-8 h-8 text-slate-950 animate-bounce" />
            )}
          </div>
        </div>

        {/* Title & Version */}
        <div className="flex items-center gap-2 mb-1.5">
          <h2 className="text-xl font-bold text-white tracking-tight">Updating GlassExpense</h2>
          <Sparkles className="w-4 h-4 text-emerald-400" />
        </div>
        <p className="text-xs text-emerald-400/90 font-medium tracking-wide uppercase px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
          Version {version || 'New Release'}
        </p>

        {/* Progress Bar Container */}
        <div className="w-full mb-3">
          <div className="w-full h-3 rounded-full bg-slate-800/90 border border-white/10 p-0.5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-300 ease-out shadow-[0_0_15px_rgba(52,211,153,0.6)]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Status & Percentage */}
        <div className="w-full flex items-center justify-between text-xs text-slate-400 font-medium px-1">
          <span className="truncate max-w-[200px] text-left">{statusText}</span>
          <span className="text-emerald-400 font-semibold">{progress}%</span>
        </div>

        {errorMessage && (
          <p className="text-xs text-red-400 mt-4 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg">
            {errorMessage}
          </p>
        )}

        <p className="text-[11px] text-slate-500 mt-6">
          Please keep the app open while we finish applying updates.
        </p>
      </div>
    </div>
  );
};
