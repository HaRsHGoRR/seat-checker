import React from 'react';
import {
  DEFAULT_GSRTC_COOKIE,
  DEFAULT_JOURNEY_DATE,
  SERVICE_1_SEATER_URL,
  SERVICE_2_SLEEPER_URL,
  gsrtcDateToIso,
  normalizeGsrtcDate,
} from '../utils/seatParser';

interface RouteInspectorPanelProps {
  journeyDate: string;
  cookie: string;
  service1Url: string;
  service2Url: string;
  ntfyTopic: string;
  callmebotUrl: string;
  onJourneyDateChange: (date: string) => void;
  onCookieChange: (cookie: string) => void;
  onService1UrlChange: (url: string) => void;
  onService2UrlChange: (url: string) => void;
  onNtfyTopicChange: (topic: string) => void;
  onCallmebotUrlChange: (url: string) => void;
  onSaveAndCheckNow: () => void;
  onResetDefaults: () => void;
}

export const RouteInspectorPanel: React.FC<RouteInspectorPanelProps> = ({
  journeyDate,
  cookie,
  service1Url,
  service2Url,
  ntfyTopic,
  callmebotUrl,
  onJourneyDateChange,
  onCookieChange,
  onService1UrlChange,
  onService2UrlChange,
  onNtfyTopicChange,
  onCallmebotUrlChange,
  onSaveAndCheckNow,
  onResetDefaults,
}) => {
  return (
    <section
      id="route-config"
      aria-labelledby="route-config-heading"
      className="bg-white border border-slate-200 rounded-xl p-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h2
            id="route-config-heading"
            className="text-lg font-semibold text-slate-900 tracking-tight"
          >
            01. Live Runtime Configuration (Date, Cookie, Dual Payloads & Free
            Push / Call Alerts)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Change Journey Date, <code className="font-mono">JSESSIONID</code>{' '}
            cookie, or free notification settings while the app is running—no
            server restart needed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onJourneyDateChange('06/11/2026')}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              journeyDate === '06/11/2026'
                ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Target Date: 06/11/2026
          </button>
          <button
            type="button"
            onClick={() => onJourneyDateChange('28/10/2026')}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              journeyDate === '28/10/2026'
                ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Test Date w/ Open Seats: 28/10/2026
          </button>
          <button
            type="button"
            onClick={onResetDefaults}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            Restore Hardcoded Defaults
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-6">
        {/* Left 7 Cols: Live Date, Cookie & Dual Service Payloads */}
        <div className="lg:col-span-7 space-y-4">
          <div>
            <label
              htmlFor="live-date-text"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Target Journey Date (DD/MM/YYYY — Default: {DEFAULT_JOURNEY_DATE})
            </label>
            <div className="flex items-center gap-2">
              <input
                id="live-date-text"
                type="text"
                value={journeyDate}
                onChange={e => onJourneyDateChange(e.target.value)}
                placeholder="06/11/2026"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              <input
                aria-label="Pick Journey Date from Calendar"
                type="date"
                value={gsrtcDateToIso(journeyDate)}
                onChange={e =>
                  onJourneyDateChange(normalizeGsrtcDate(e.target.value))
                }
                className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-mono text-slate-700 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="gsrtc-cookie-input"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Active GSRTC Cookie Header (Hardcoded fallback:{' '}
              <code className="font-mono">
                {DEFAULT_GSRTC_COOKIE.slice(0, 36)}...
              </code>
              )
            </label>
            <textarea
              id="gsrtc-cookie-input"
              rows={2}
              value={cookie}
              onChange={e => onCookieChange(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="service-1-url"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Payload 1 — Service 52769 (Lower Deck Seater · slNo=15 · ₹328.00 ·
              2100BRDVRLSPL30)
            </label>
            <input
              id="service-1-url"
              type="text"
              value={service1Url}
              onChange={e => onService1UrlChange(e.target.value)}
              placeholder={SERVICE_1_SEATER_URL}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-mono text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="service-2-url"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Payload 2 — Service 52767 (Upper Deck Sleeper · slNo=14 · ₹423.00 ·
              2100BRDVRLSPL15)
            </label>
            <input
              id="service-2-url"
              type="text"
              value={service2Url}
              onChange={e => onService2UrlChange(e.target.value)}
              placeholder={SERVICE_2_SLEEPER_URL}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-mono text-slate-800 focus:bg-white focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={onSaveAndCheckNow}
              className="py-2.5 px-5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Save Live Config & Probe Both Services Now
            </button>
          </div>
        </div>

        {/* Right 5 Cols: Free Phone Push Alarm (ntfy.sh) & Free Voice Call / WhatsApp (CallMeBot) */}
        <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              02. Free Phone Push Alarm & Free Voice Call (No Passwords Needed)
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Zero-password mobile notifications when Service 52769 or 52767
              has open seats:
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="ntfy-topic-input"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  1. ntfy.sh Topic (Active Now — 100% Free Phone Push & Alarm)
                </label>
                <input
                  id="ntfy-topic-input"
                  type="text"
                  value={ntfyTopic}
                  onChange={e => onNtfyTopicChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono text-slate-800 focus:border-slate-900 focus:outline-none"
                />
                <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                  Install the free <strong>ntfy</strong> app on Android/iOS (or
                  open{' '}
                  <a
                    href={`https://ntfy.sh/${encodeURIComponent(ntfyTopic)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-slate-900 font-mono"
                  >
                    ntfy.sh/{ntfyTopic}
                  </a>
                  ) and subscribe to{' '}
                  <code className="font-mono font-semibold">{ntfyTopic}</code>.
                  No account or password needed.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-200">
                <label
                  htmlFor="callmebot-url-input"
                  className="block text-xs font-semibold text-slate-800 mb-1"
                >
                  2. CallMeBot Free Automated Voice Call / WhatsApp Webhook
                  (Optional)
                </label>
                <input
                  id="callmebot-url-input"
                  type="url"
                  value={callmebotUrl}
                  onChange={e => onCallmebotUrlChange(e.target.value)}
                  placeholder="http://api.callmebot.com/start.php?user=@your_telegram&lang=en-US-Standard-B"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono text-slate-800 focus:border-slate-900 focus:outline-none"
                />
                <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                  Want a real ringing phone call for free? Message{' '}
                  <code className="font-mono">@CallMeBot_txtbot</code> on
                  Telegram with <code className="font-mono">/start</code>, then
                  paste your <code className="font-mono">api.callmebot.com</code>{' '}
                  link above. It will call your phone and speak the open seat
                  numbers out loud.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
