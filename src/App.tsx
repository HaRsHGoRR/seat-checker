/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Volume2,
  VolumeX,
  Send,
  Search,
  ExternalLink,
} from 'lucide-react';
import {
  AvailabilityState,
  DEFAULT_GSRTC_COOKIE,
  DEFAULT_JOURNEY_DATE,
  DEFAULT_NTFY_TOPIC,
  GsrtcServiceInfo,
  ParsedSeatCheckResult,
  SERVICE_1_SEATER_URL,
  SERVICE_2_SLEEPER_URL,
  generateMockGsrtcHtml,
  normalizeGsrtcDate,
  parseGsrtcHtmlResponse,
  parseGsrtcUrl,
  shouldTriggerAlert,
} from './utils/seatParser';
import { CoachSeatMap } from './components/CoachSeatMap';
import { RouteInspectorPanel } from './components/RouteInspectorPanel';

export interface CheckLogEntry {
  id: string;
  timestamp: string;
  journeyDate: string;
  s1Summary: string;
  s2Summary: string;
  combinedStatus: AvailabilityState;
  totalOpenCount: number;
  latencyMs: number;
  alertAction: string;
  alertDispatched: boolean;
}

function playAlertChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    osc1.frequency.setValueAtTime(880, now + 0.14);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.45);
  } catch {
    // Ignore if user has not interacted yet
  }
}

export default function App() {
  const [journeyDate, setJourneyDate] = useState<string>(DEFAULT_JOURNEY_DATE);
  const [cookie, setCookie] = useState<string>(DEFAULT_GSRTC_COOKIE);
  const [service1Url, setService1Url] = useState<string>(SERVICE_1_SEATER_URL);
  const [service2Url, setService2Url] = useState<string>(SERVICE_2_SLEEPER_URL);

  const [service1Info, setService1Info] = useState<GsrtcServiceInfo>(() =>
    parseGsrtcUrl(SERVICE_1_SEATER_URL)
  );
  const [service2Info, setService2Info] = useState<GsrtcServiceInfo>(() =>
    parseGsrtcUrl(SERVICE_2_SLEEPER_URL)
  );

  const [pollIntervalSec, setPollIntervalSec] = useState<number>(10);
  const [secondsUntilNext, setSecondsUntilNext] = useState<number>(10);
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const [service1Result, setService1Result] = useState<ParsedSeatCheckResult>(
    () =>
      parseGsrtcHtmlResponse(
        generateMockGsrtcHtml(
          'sold_out',
          parseGsrtcUrl(SERVICE_1_SEATER_URL),
          DEFAULT_JOURNEY_DATE
        ),
        328
      )
  );
  const [service2Result, setService2Result] = useState<ParsedSeatCheckResult>(
    () =>
      parseGsrtcHtmlResponse(
        generateMockGsrtcHtml(
          'sold_out',
          parseGsrtcUrl(SERVICE_2_SLEEPER_URL),
          DEFAULT_JOURNEY_DATE
        ),
        423
      )
  );

  const [lastHttpStatus, setLastHttpStatus] = useState<number>(200);
  const [lastLatencyMs, setLastLatencyMs] = useState<number>(42);
  const [lastCheckedTime, setLastCheckedTime] = useState<string>(() =>
    new Date().toLocaleTimeString('en-US', { hour12: false })
  );

  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);

  // Zero-password Free Notification Configuration (ntfy.sh + optional CallMeBot)
  const [ntfyTopic, setNtfyTopic] = useState<string>(DEFAULT_NTFY_TOPIC);
  const [callmebotUrl, setCallmebotUrl] = useState<string>('');

  const [cooldownSec, setCooldownSec] = useState<number>(60);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [lastAlertNote, setLastAlertNote] = useState<string>(
    'Monitoring 52769 + 52767 for 06/11/2026; instant push alarm will fire to ntfy.sh as soon as >=1 seat opens.'
  );
  const [testAlertStatus, setTestAlertStatus] = useState<string | null>(null);

  const [logFilter, setLogFilter] = useState<
    'all' | 'available' | 'alerts' | 'issues'
  >('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [checkLogs, setCheckLogs] = useState<CheckLogEntry[]>([]);

  const isCheckingRef = useRef<boolean>(false);
  const countdownRef = useRef<number>(10);
  const prevStatusRef = useRef<AvailabilityState>('SOLD_OUT');
  const lastAlertTimeMsRef = useRef<number | null>(null);

  const handleToggleSeatId = (seatKey: string) => {
    setSelectedSeatIds(prev => {
      if (prev.includes(seatKey)) {
        return prev.filter(k => k !== seatKey);
      }
      if (prev.length >= 6) return prev;
      return [...prev, seatKey];
    });
  };

  const dispatchPushAndCallAlert = useCallback(
    async (subject: string, message: string) => {
      if (audioEnabled) {
        playAlertChime();
      }
      try {
        const res = await fetch('/api/notify/alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject,
            message,
            ntfyTopic,
            callmebotUrl,
          }),
        });
        const data = await res.json();
        return String(data.note || `Push sent to ntfy.sh/${ntfyTopic}`);
      } catch {
        return `Alert logged locally for ntfy.sh/${ntfyTopic}`;
      }
    },
    [audioEnabled, ntfyTopic, callmebotUrl]
  );

  const runDualSeatCheck = useCallback(
    async (overrideParams?: {
      date?: string;
      cookieStr?: string;
      url1?: string;
      url2?: string;
      force?: boolean;
    }) => {
      if (isCheckingRef.current && !overrideParams?.force) return;
      isCheckingRef.current = true;
      setIsChecking(true);

      const activeDate = normalizeGsrtcDate(
        overrideParams?.date ?? journeyDate
      );
      const activeCookie = overrideParams?.cookieStr ?? cookie;
      const activeUrl1 = overrideParams?.url1 ?? service1Url;
      const activeUrl2 = overrideParams?.url2 ?? service2Url;

      const startMs = Date.now();

      try {
        const response = await fetch('/api/check-dual-seats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service1Url: activeUrl1,
            service2Url: activeUrl2,
            cookie: activeCookie,
            journeyDate: activeDate,
          }),
        });

        const payload = await response.json();
        if (!payload.ok) {
          throw new Error(payload.error || 'Dual seat check failed');
        }

        const s1Info: GsrtcServiceInfo =
          payload.service1.serviceInfo || parseGsrtcUrl(activeUrl1);
        const s2Info: GsrtcServiceInfo =
          payload.service2.serviceInfo || parseGsrtcUrl(activeUrl2);
        const s1Res: ParsedSeatCheckResult = payload.service1.result;
        const s2Res: ParsedSeatCheckResult = payload.service2.result;

        setService1Info(s1Info);
        setService2Info(s2Info);
        setService1Result(s1Res);
        setService2Result(s2Res);

        const s1Open = s1Res.availableCount + s1Res.ladiesAvailableCount;
        const s2Open = s2Res.availableCount + s2Res.ladiesAvailableCount;
        const totalOpen = s1Open + s2Open;

        let combinedStatus: AvailabilityState = 'SOLD_OUT';
        if (totalOpen > 0) {
          combinedStatus = 'AVAILABLE';
        } else if (
          s1Res.status === 'SESSION_EXPIRED' ||
          s2Res.status === 'SESSION_EXPIRED'
        ) {
          combinedStatus = 'SESSION_EXPIRED';
        } else if (s1Res.status === 'ERROR' && s2Res.status === 'ERROR') {
          combinedStatus = 'ERROR';
        }

        const httpStatus = Number(payload.service1.httpStatus || 200);
        const latencyMs = Math.max(
          Number(payload.service1.latencyMs || 15),
          Number(payload.service2.latencyMs || 15),
          Date.now() - startMs
        );

        const nowMs = Date.now();
        const dedup = shouldTriggerAlert({
          previousStatus: prevStatusRef.current,
          currentStatus: combinedStatus,
          totalAvailableSeats: totalOpen,
          lastAlertTimestampMs: lastAlertTimeMsRef.current,
          nowTimestampMs: nowMs,
          cooldownMs: cooldownSec * 1000,
        });

        prevStatusRef.current = combinedStatus;

        if (dedup.shouldAlert) {
          lastAlertTimeMsRef.current = nowMs;
          const subject = `GSRTC SEATS OPEN (${activeDate}): ${s1Open} Seater + ${s2Open} Sleeper Available!`;
          const bodyLines = [
            `GSRTC Seat Alert for Journey Date: ${activeDate}`,
            `Route: ${s1Info.boardingPoint} -> ${s1Info.destinationCity} (Dep ${s1Info.departureTime})`,
            `1. Service ${s1Info.serviceId} (Seater, slNo=${s1Info.slNo}, INR ${s1Info.fareInr}): ${s1Open}/${s1Res.totalSeats} Open ${
              s1Res.openSeatLabels.length > 0
                ? `[${s1Res.openSeatLabels.join(', ')}]`
                : ''
            }`,
            `2. Service ${s2Info.serviceId} (Sleeper, slNo=${s2Info.slNo}, INR ${s2Info.fareInr}): ${s2Open}/${s2Res.totalSeats} Open ${
              s2Res.openSeatLabels.length > 0
                ? `[${s2Res.openSeatLabels.join(', ')}]`
                : ''
            }`,
          ];
          await dispatchPushAndCallAlert(subject, bodyLines.join('\n'));
        }

        setLastHttpStatus(httpStatus);
        setLastLatencyMs(latencyMs);
        const timeStr = new Date().toLocaleTimeString('en-US', {
          hour12: false,
        });
        setLastCheckedTime(timeStr);
        setLastAlertNote(dedup.reason);

        const newLog: CheckLogEntry = {
          id: `${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: timeStr,
          journeyDate: activeDate,
          s1Summary:
            s1Open > 0
              ? `${s1Open}/${s1Res.totalSeats} Open (${s1Res.openSeatLabels.slice(0, 4).join(', ')})`
              : `${s1Res.status} (0/${s1Res.totalSeats})`,
          s2Summary:
            s2Open > 0
              ? `${s2Open}/${s2Res.totalSeats} Open (${s2Res.openSeatLabels.slice(0, 4).join(', ')})`
              : `${s2Res.status} (0/${s2Res.totalSeats})`,
          combinedStatus,
          totalOpenCount: totalOpen,
          latencyMs,
          alertAction: dedup.reason,
          alertDispatched: dedup.shouldAlert,
        };

        setCheckLogs(prev => [newLog, ...prev.slice(0, 49)]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Check failed';
        setLastAlertNote(`Check error: ${msg}`);
      } finally {
        isCheckingRef.current = false;
        setIsChecking(false);
        if (pollIntervalSec > 0) {
          countdownRef.current = pollIntervalSec;
          setSecondsUntilNext(pollIntervalSec);
        }
      }
    },
    [
      journeyDate,
      cookie,
      service1Url,
      service2Url,
      cooldownSec,
      dispatchPushAndCallAlert,
      pollIntervalSec,
    ]
  );

  const latestRunCheckRef = useRef(runDualSeatCheck);
  useEffect(() => {
    latestRunCheckRef.current = runDualSeatCheck;
  }, [runDualSeatCheck]);

  useEffect(() => {
    void latestRunCheckRef.current({ force: true });
  }, []);

  useEffect(() => {
    if (pollIntervalSec <= 0) return;
    countdownRef.current = pollIntervalSec;
    setSecondsUntilNext(pollIntervalSec);

    const timer = setInterval(() => {
      if (isCheckingRef.current) return;
      countdownRef.current -= 1;
      if (countdownRef.current <= 0) {
        countdownRef.current = pollIntervalSec;
        setSecondsUntilNext(pollIntervalSec);
        void latestRunCheckRef.current();
      } else {
        setSecondsUntilNext(countdownRef.current);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [pollIntervalSec]);

  const handleQuickDateSwitch = (newDate: string) => {
    const norm = normalizeGsrtcDate(newDate);
    setJourneyDate(norm);
    prevStatusRef.current = 'SOLD_OUT';
    lastAlertTimeMsRef.current = null;
    countdownRef.current = pollIntervalSec > 0 ? pollIntervalSec : 10;
    void runDualSeatCheck({ date: norm, force: true });
  };

  const handleManualTestAlert = async () => {
    const s1Open =
      service1Result.availableCount + service1Result.ladiesAvailableCount;
    const s2Open =
      service2Result.availableCount + service2Result.ladiesAvailableCount;
    const subject = `[TEST] GSRTC Seat Radar (${journeyDate}) - Services 52769 & 52767`;
    const body = `Test push alert for Baroda -> Veraval (${journeyDate}).\nService 52769 (Seater): ${s1Open}/${service1Result.totalSeats} open\nService 52767 (Sleeper): ${s2Open}/${service2Result.totalSeats} open`;
    const note = await dispatchPushAndCallAlert(subject, body);
    setTestAlertStatus(note);
    setTimeout(() => setTestAlertStatus(null), 6000);
  };

  const handleResetDefaults = () => {
    setJourneyDate(DEFAULT_JOURNEY_DATE);
    setCookie(DEFAULT_GSRTC_COOKIE);
    setService1Url(SERVICE_1_SEATER_URL);
    setService2Url(SERVICE_2_SLEEPER_URL);
    setNtfyTopic(DEFAULT_NTFY_TOPIC);
    setCallmebotUrl('');
    prevStatusRef.current = 'SOLD_OUT';
    lastAlertTimeMsRef.current = null;
    void runDualSeatCheck({
      date: DEFAULT_JOURNEY_DATE,
      cookieStr: DEFAULT_GSRTC_COOKIE,
      url1: SERVICE_1_SEATER_URL,
      url2: SERVICE_2_SLEEPER_URL,
      force: true,
    });
  };

  const s1OpenCount =
    service1Result.availableCount + service1Result.ladiesAvailableCount;
  const s2OpenCount =
    service2Result.availableCount + service2Result.ladiesAvailableCount;
  const combinedOpenCount = s1OpenCount + s2OpenCount;
  const combinedTotalSeats =
    (service1Result.totalSeats || 30) + (service2Result.totalSeats || 15);

  let overallStatus: AvailabilityState = 'SOLD_OUT';
  if (combinedOpenCount > 0) {
    overallStatus = 'AVAILABLE';
  } else if (
    service1Result.status === 'SESSION_EXPIRED' ||
    service2Result.status === 'SESSION_EXPIRED'
  ) {
    overallStatus = 'SESSION_EXPIRED';
  } else if (
    service1Result.status === 'ERROR' &&
    service2Result.status === 'ERROR'
  ) {
    overallStatus = 'ERROR';
  }

  const filteredLogs = checkLogs.filter(entry => {
    if (logFilter === 'available' && entry.combinedStatus !== 'AVAILABLE')
      return false;
    if (logFilter === 'alerts' && !entry.alertDispatched) return false;
    if (
      logFilter === 'issues' &&
      entry.combinedStatus !== 'SOLD_OUT' &&
      entry.combinedStatus !== 'SESSION_EXPIRED' &&
      entry.combinedStatus !== 'ERROR'
    ) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        entry.journeyDate.toLowerCase().includes(q) ||
        entry.s1Summary.toLowerCase().includes(q) ||
        entry.s2Summary.toLowerCase().includes(q) ||
        entry.alertAction.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          <a
            href="#monitor"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            GSRTC Seat Radar
          </a>

          <nav
            aria-label="Primary Workspace Navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            <a
              href="#monitor"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Dual Monitor
            </a>
            <a
              href="#seat-map"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Coach Decks
            </a>
            <a
              href="#route-config"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Live Date & Cookie
            </a>
            <a
              href="#check-log"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Alert Log
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => void runDualSeatCheck({ force: true })}
              disabled={isChecking}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isChecking ? 'Checking Both...' : 'Check Both Now'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 space-y-8">
        {/* Section 1: Dual Service Monitor (52769 + 52767) & Inline Live Date/Cookie Bar */}
        <section
          id="monitor"
          aria-labelledby="monitor-heading"
          className="bg-white border border-slate-200 rounded-xl p-6"
        >
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <span className="text-xs font-medium text-slate-500">
                Live Dual-Service Monitor · Journey Date: {journeyDate}
              </span>
              <h1
                id="monitor-heading"
                className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mt-0.5"
              >
                {service1Info.boardingPoint} to {service1Info.destinationCity}
              </h1>
              {/* Zero-Pill Metadata Discipline */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1.5 font-mono tabular-nums">
                <span>Date {journeyDate}</span>
                <span aria-hidden="true">·</span>
                <span>Dept 21:00 (Duration 08:35 · via Rjt,Jnd,Ksd)</span>
                <span aria-hidden="true">·</span>
                <span>2100BRDVRLSPL30 (Seater ₹328, slNo=15)</span>
                <span aria-hidden="true">·</span>
                <span>2100BRDVRLSPL15 (Sleeper ₹423, slNo=14)</span>
              </div>
            </div>
          </div>

          {/* Inline Quick Runtime Date & Cookie Controls (No Server Restart Required) */}
          <div className="py-4 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center bg-slate-50/70 -mx-6 px-6">
            <div className="lg:col-span-5 flex flex-wrap items-center gap-1.5">
              <label
                htmlFor="quick-date-input"
                className="text-xs font-semibold text-slate-700 whitespace-nowrap mr-1"
              >
                Live Date:
              </label>
              <input
                id="quick-date-input"
                type="text"
                value={journeyDate}
                onChange={e => setJourneyDate(e.target.value)}
                className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              {['06/11/2026', '23/10/2026', '28/10/2026', '01/11/2026'].map(
                presetDate => (
                  <button
                    key={presetDate}
                    type="button"
                    onClick={() => handleQuickDateSwitch(presetDate)}
                    className={`px-2 py-1.5 text-xs font-mono rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                      journeyDate === presetDate
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {presetDate}
                  </button>
                )
              )}
            </div>

            <div className="lg:col-span-7 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <label
                htmlFor="quick-cookie-input"
                className="text-xs font-semibold text-slate-700 whitespace-nowrap"
              >
                Live Cookie:
              </label>
              <input
                id="quick-cookie-input"
                type="text"
                value={cookie}
                onChange={e => setCookie(e.target.value)}
                placeholder="JSESSIONID=..."
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono text-slate-800 focus:border-slate-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={() =>
                  void runDualSeatCheck({
                    date: journeyDate,
                    cookieStr: cookie,
                  })
                }
                className="px-3.5 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Apply & Check
              </button>
            </div>
          </div>

          {/* Primary Status Banner + Dual Service Breakdown */}
          <div className="pt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div
              className={`lg:col-span-7 rounded-xl border p-5 flex flex-col justify-between ${
                overallStatus === 'AVAILABLE'
                  ? 'bg-emerald-50/60 border-emerald-300 text-emerald-950'
                  : overallStatus === 'SOLD_OUT'
                    ? 'bg-amber-50/60 border-amber-300 text-amber-950'
                    : 'bg-red-50/60 border-red-300 text-red-950'
              }`}
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {overallStatus === 'AVAILABLE' ? (
                      <CheckCircle2
                        className="w-5 h-5 text-emerald-700 shrink-0"
                        aria-hidden="true"
                      />
                    ) : overallStatus === 'SOLD_OUT' ? (
                      <AlertTriangle
                        className="w-5 h-5 text-amber-700 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircle
                        className="w-5 h-5 text-red-700 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="text-xs font-mono uppercase tracking-wider font-semibold">
                      Combined Status ({journeyDate}): {overallStatus}
                    </span>
                  </div>

                  <span className="text-xs font-mono tabular-nums opacity-80">
                    HTTP {lastHttpStatus} · {lastLatencyMs}ms · {lastCheckedTime}
                  </span>
                </div>

                <h2
                  data-testid="current-status-headline"
                  className="text-xl sm:text-2xl font-bold tracking-tight mt-2.5"
                >
                  {overallStatus === 'AVAILABLE'
                    ? `${combinedOpenCount} Total Seats/Berths Available (${s1OpenCount} Seater, ${s2OpenCount} Sleeper)`
                    : overallStatus === 'SOLD_OUT'
                      ? `0 Open Seats for ${journeyDate} (30/30 Seater Booked, 15/15 Sleeper Booked)`
                      : service1Result.statusHeadline}
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-black/10 text-xs">
                  <div>
                    <div className="font-semibold">
                      1. Service {service1Info.serviceId} (Lower Seater · slNo=
                      {service1Info.slNo})
                    </div>
                    <div className="font-mono tabular-nums mt-0.5">
                      {s1OpenCount} / {service1Result.totalSeats || 30} Open ·
                      INR {service1Info.fareInr} · {service1Info.tripCode}
                    </div>
                    {service1Result.openSeatLabels.length > 0 && (
                      <div className="font-mono text-[11px] mt-0.5 opacity-90">
                        Open:{' '}
                        {service1Result.openSeatLabels.slice(0, 8).join(', ')}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="font-semibold">
                      2. Service {service2Info.serviceId} (Upper Sleeper · slNo=
                      {service2Info.slNo})
                    </div>
                    <div className="font-mono tabular-nums mt-0.5">
                      {s2OpenCount} / {service2Result.totalSeats || 15} Open ·
                      INR {service2Info.fareInr} · {service2Info.tripCode}
                    </div>
                    {service2Result.openSeatLabels.length > 0 && (
                      <div className="font-mono text-[11px] mt-0.5 opacity-90">
                        Open:{' '}
                        {service2Result.openSeatLabels.slice(0, 8).join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-black/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>
                  Push Alert:{' '}
                  <strong className="font-semibold">{lastAlertNote}</strong>
                </span>
                <span className="font-mono tabular-nums">
                  {pollIntervalSec > 0
                    ? `Next dual check in ${String(secondsUntilNext).padStart(2, '0')}s`
                    : 'Auto-polling paused'}
                </span>
              </div>
            </div>

            {/* Right 5 Cols: Metrics, Polling Cadence & Free Push Test */}
            <div className="lg:col-span-5 flex flex-col justify-between border border-slate-200 rounded-xl p-5 bg-slate-50">
              <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="text-xs text-slate-500">
                    Combined Open (Both Services)
                  </div>
                  <div
                    data-testid="metric-total-open"
                    className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5"
                  >
                    {combinedOpenCount}
                    <span className="text-xs font-normal text-slate-500 ml-1">
                      / {combinedTotalSeats}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    {s1OpenCount} Seater (52769) · {s2OpenCount} Sleeper (52767)
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-500">
                    GSRTC Session Banner Date
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {service1Result.detectedJourneyDate || journeyDate}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    {service1Result.bookedCount + service2Result.bookedCount}{' '}
                    Booked Total
                  </div>
                </div>
              </div>

              <div className="pt-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-700">
                    Auto-Poll Interval
                  </span>
                  <div
                    role="group"
                    aria-label="Polling Interval"
                    className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200"
                  >
                    {[
                      { label: '10s', value: 10 },
                      { label: '30s', value: 30 },
                      { label: '60s', value: 60 },
                      { label: 'Pause', value: 0 },
                    ].map(opt => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => {
                          setPollIntervalSec(opt.value);
                          if (opt.value > 0) setSecondsUntilNext(opt.value);
                        }}
                        className={`px-2.5 py-1 text-xs font-mono tabular-nums rounded transition-colors whitespace-nowrap shrink-0 ${
                          pollIntervalSec === opt.value
                            ? 'bg-slate-900 text-white font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAudioEnabled(prev => !prev)}
                      className="px-2.5 py-1.5 text-xs font-medium border border-slate-200 bg-white rounded-lg text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      {audioEnabled ? (
                        <Volume2 className="w-3.5 h-3.5 text-slate-900" />
                      ) : (
                        <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span>{audioEnabled ? 'Chime On' : 'Muted'}</span>
                    </button>

                    <select
                      aria-label="Alert Deduplication Cooldown"
                      value={cooldownSec}
                      onChange={e => setCooldownSec(Number(e.target.value))}
                      className="px-2.5 py-1.5 text-xs border border-slate-200 bg-white rounded-lg text-slate-700 font-mono tabular-nums"
                    >
                      <option value={0}>Alert: Every Poll</option>
                      <option value={30}>Dedup: 30s</option>
                      <option value={60}>Dedup: 1m</option>
                      <option value={300}>Dedup: 5m</option>
                      <option value={900}>Dedup: 15m</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleManualTestAlert()}
                    className="px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white text-slate-800 rounded-lg hover:bg-slate-100 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3 h-3" aria-hidden="true" />
                    <span>Send Test Push Alert</span>
                  </button>
                </div>

                {testAlertStatus && (
                  <p className="text-xs text-emerald-700 font-mono font-medium">
                    {testAlertStatus}
                  </p>
                )}

                <div className="pt-1 flex items-center gap-3 text-xs">
                  <a
                    href={`https://ntfy.sh/${encodeURIComponent(ntfyTopic)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-slate-700 underline font-mono"
                  >
                    <span>Open Live Feed: ntfy.sh/{ntfyTopic}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Side-by-Side Dual Deck Seat Layout (52769 Seater + 52767 Sleeper) */}
        <CoachSeatMap
          service1Info={service1Info}
          service1Result={service1Result}
          service2Info={service2Info}
          service2Result={service2Result}
          selectedSeatIds={selectedSeatIds}
          onToggleSeatId={handleToggleSeatId}
          onClearSelection={() => setSelectedSeatIds([])}
        />

        {/* Section 3: Live Runtime Config (Date, Cookie, Dual Payloads & Free Push/Call Setup) */}
        <RouteInspectorPanel
          journeyDate={journeyDate}
          cookie={cookie}
          service1Url={service1Url}
          service2Url={service2Url}
          ntfyTopic={ntfyTopic}
          callmebotUrl={callmebotUrl}
          onJourneyDateChange={handleQuickDateSwitch}
          onCookieChange={setCookie}
          onService1UrlChange={setService1Url}
          onService2UrlChange={setService2Url}
          onNtfyTopicChange={setNtfyTopic}
          onCallmebotUrlChange={setCallmebotUrl}
          onSaveAndCheckNow={() => void runDualSeatCheck()}
          onResetDefaults={handleResetDefaults}
        />

        {/* Section 4: Dual Probe & Alert Log */}
        <section
          id="check-log"
          aria-labelledby="check-log-heading"
          className="bg-white border border-slate-200 rounded-xl p-6"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <h2
                id="check-log-heading"
                className="text-lg font-semibold text-slate-900 tracking-tight"
              >
                03. Dual-Service Probe & Push Alert Log
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Simultaneous probe log for Service 52769 (slNo=15) and Service
                52767 (slNo=14) with alert deduplication.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label="Filter Check Logs"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                {(
                  [
                    ['all', 'All Checks'],
                    ['available', 'Open Seats'],
                    ['alerts', 'Alerts Sent'],
                    ['issues', 'Sold Out / Issues'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLogFilter(key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      logFilter === key
                        ? 'bg-white text-slate-900 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  aria-label="Search probe logs"
                  placeholder="Filter by date or status..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-800 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => setCheckLogs([])}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                Clear Log
              </button>
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-slate-700">
                No Matching Dual-Service Check Entries
              </p>
              <button
                type="button"
                onClick={() => {
                  setLogFilter('all');
                  setSearchQuery('');
                  void runDualSeatCheck();
                }}
                className="mt-4 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Check Both Services Now
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto pt-3">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-2.5 pr-4">Time</th>
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4">52769 (Seater 30)</th>
                    <th className="py-2.5 px-4">52767 (Sleeper 15)</th>
                    <th className="py-2.5 px-4 text-right">Total Open</th>
                    <th className="py-2.5 px-4 text-right">Latency</th>
                    <th className="py-2.5 pl-4">Push / Call Alert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredLogs.map(log => (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-2.5 pr-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {log.timestamp}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                        {log.journeyDate}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-800">
                        {log.s1Summary}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-800">
                        {log.s2Summary}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {log.totalOpenCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {log.latencyMs}ms
                      </td>
                      <td className="py-2.5 pl-4 text-slate-600">
                        {log.alertDispatched ? (
                          <span className="font-semibold text-emerald-700">
                            {log.alertAction}
                          </span>
                        ) : (
                          <span>{log.alertAction}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-4 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>
            GSRTC Seat Radar · Dual Monitor for 52769 (Seater) & 52767 (Sleeper)
            · Baroda to Veraval
          </span>
          <div className="flex items-center gap-4">
            <a
              href="#monitor"
              className="hover:text-slate-900 transition-colors"
            >
              Monitor
            </a>
            <a
              href="#seat-map"
              className="hover:text-slate-900 transition-colors"
            >
              Dual Decks
            </a>
            <a
              href="#route-config"
              className="hover:text-slate-900 transition-colors"
            >
              Live Config
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
