import React, { useState } from 'react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  // If already running as an installed standalone PWA, hide the install button
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowInstallGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid="pwa-install-button"
        onClick={handleInstallClick}
        title="Install Monthly Tracker Web App"
        className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
      >
        <i className="fa-solid fa-download text-xs"></i>
        <span>{isIOS ? 'Install on iOS' : 'Install App'}</span>
      </button>

      {showInstallGuide && (
        <div
          onClick={() => setShowInstallGuide(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[#0f172a] border border-slate-700/80 overflow-hidden shadow-2xl"
          >
            <div className="tracker-header-banner px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-slate-100 text-sm tracking-tight flex items-center gap-2">
                <i className="fa-solid fa-mobile-screen-button text-emerald-400"></i>
                <span>
                  {isIOS
                    ? 'Install on iPhone / iPad'
                    : 'Install Monthly Tracker App'}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setShowInstallGuide(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-slate-300 leading-relaxed">
              {isIOS ? (
                <>
                  <p>
                    Install <strong>Monthly Target &amp; Task Tracker</strong>{' '}
                    on your iPhone or iPad home screen for full-screen standalone
                    access:
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-200 font-medium">
                    <li>
                      Tap the <strong>Share</strong> button in your Safari
                      toolbar.
                    </li>
                    <li>
                      Scroll down and tap <strong>Add to Home Screen</strong>.
                    </li>
                    <li>
                      Tap <strong>Add</strong> in the top-right corner.
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <p>
                    You can install{' '}
                    <strong>Monthly Target &amp; Task Tracker</strong> as a
                    standalone app on your device:
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-200 font-medium">
                    <li>
                      Open this app directly in a full browser tab (Chrome,
                      Edge, or Android Chrome).
                    </li>
                    <li>
                      Click the <strong>Install App</strong> icon in the browser
                      address bar (or open the browser menu and select{' '}
                      <strong>Install App / Add to Home Screen</strong>).
                    </li>
                  </ol>
                </>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowInstallGuide(false)}
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition cursor-pointer"
                >
                  Got It
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-lg">
      <i className="fa-solid fa-wifi text-xs"></i>
      <span>Offline Mode — Cached data is being used.</span>
    </div>
  );
};
