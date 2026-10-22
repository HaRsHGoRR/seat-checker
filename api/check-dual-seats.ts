import {
  DEFAULT_GSRTC_COOKIE,
  DEFAULT_JOURNEY_DATE,
  SERVICE_1_SEATER_URL,
  SERVICE_2_SLEEPER_URL,
  buildGsrtcUrl,
  normalizeGsrtcDate,
  parseGsrtcHtmlResponse,
  parseGsrtcUrl,
} from '../src/utils/seatParser.js';

async function probeSingleGsrtcService(params: {
  rawUrl: string;
  cookie: string;
  journeyDate: string;
}) {
  const startMs = Date.now();
  const serviceInfo = parseGsrtcUrl(params.rawUrl);
  const normDate = normalizeGsrtcDate(params.journeyDate);
  const endpointUsed = buildGsrtcUrl(serviceInfo, normDate);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const upstreamRes = await fetch(endpointUsed, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Length': '0',
        Cookie: params.cookie.trim() || DEFAULT_GSRTC_COOKIE,
        Origin: 'https://gsrtc.in',
        Referer:
          'https://gsrtc.in/OPRSOnline/jqreq.do?hiddenAction=SearchServiceForHome',
        'Sec-Ch-Ua':
          '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const html = await upstreamRes.text();
    const parsed = parseGsrtcHtmlResponse(html, serviceInfo.fareInr);

    return {
      ok: true,
      httpStatus: upstreamRes.status,
      latencyMs: Date.now() - startMs,
      endpointUsed,
      serviceInfo,
      result: parsed,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const errMsg = err instanceof Error ? err.message : 'Network error';
    return {
      ok: false,
      httpStatus: 504,
      latencyMs: Date.now() - startMs,
      endpointUsed,
      serviceInfo,
      result: {
        status: 'ERROR' as const,
        statusHeadline: `GSRTC Request Error (${errMsg})`,
        rawErrorMessage: errMsg,
        bannerTitle: null,
        detectedJourneyDate: normDate,
        pickupInfo: null,
        dropoffInfo: null,
        availableCount: 0,
        ladiesAvailableCount: 0,
        bookedCount: 0,
        totalSeats: 0,
        openSeatLabels: [],
        seats: [],
        diagnosticNote: `Could not reach gsrtc.in (${errMsg}).`,
      },
    };
  }
}

function toSafeByteStringHeader(input: string): string {
  return input
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

interface RuntimeSeatConfig {
  journeyDate: string;
  cookie: string;
  service1Url: string;
  service2Url: string;
  ntfyTopic: string;
  callmebotUrl: string;
  updatedAt: string;
}

const globalStore = globalThis as unknown as {
  __gsrtcRuntimeConfig?: RuntimeSeatConfig;
};

if (!globalStore.__gsrtcRuntimeConfig) {
  globalStore.__gsrtcRuntimeConfig = {
    journeyDate: DEFAULT_JOURNEY_DATE,
    cookie: process.env.GSRTC_COOKIE || DEFAULT_GSRTC_COOKIE,
    service1Url: SERVICE_1_SEATER_URL,
    service2Url: SERVICE_2_SLEEPER_URL,
    ntfyTopic: process.env.NTFY_TOPIC || 'gsrtc-seat-radar-harsh-52769',
    callmebotUrl: '',
    updatedAt: new Date().toISOString(),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendNtfyAndCallAlert(params: {
  ntfyTopic: string;
  callmebotUrl: string;
  activeDate: string;
  totalOpen: number;
  s1Open: number;
  s2Open: number;
  s1Labels: string[];
  s2Labels: string[];
  checkLabel: string;
}): Promise<boolean> {
  let sent = false;
  const cleanTopic = String(params.ntfyTopic || '')
    .trim()
    .replace(/^https?:\/\/ntfy\.sh\//i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '');

  if (cleanTopic) {
    const s1LabelsText = params.s1Labels.join(', ') || 'None';
    const s2LabelsText = params.s2Labels.join(', ') || 'None';
    const title = toSafeByteStringHeader(
      `GSRTC OPEN: ${params.totalOpen} Seat(s) on ${params.activeDate}`
    );
    const message = [
      `Route: BARODA CENTRAL BUS STATION -> VERAVAL`,
      `Date: ${params.activeDate} (21:00 Dept) [${params.checkLabel}]`,
      `Seater 52769 (INR 328): ${params.s1Open} open (${s1LabelsText})`,
      `Sleeper 52767 (INR 423): ${params.s2Open} open (${s2LabelsText})`,
      `Book now: https://gsrtc.in/OPRSOnline/`,
    ].join('\n');

    try {
      const ntfyRes = await fetch(
        `https://ntfy.sh/${encodeURIComponent(cleanTopic)}`,
        {
          method: 'POST',
          headers: {
            Title: title,
            Priority: '5',
            Tags: 'bus,rotating_light,white_check_mark',
            Click: 'https://gsrtc.in/OPRSOnline/',
            'Content-Type': 'text/plain; charset=utf-8',
          },
          body: message,
        }
      );
      sent = ntfyRes.ok;
    } catch {
      sent = false;
    }
  }

  if (params.callmebotUrl && params.callmebotUrl.startsWith('http')) {
    try {
      await fetch(params.callmebotUrl, { method: 'GET' });
    } catch {
      // ignore callmebot error
    }
  }

  return sent;
}

export default async function handler(req: any, res: any) {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
  );
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const ramConfig = globalStore.__gsrtcRuntimeConfig!;
    const isGet = req.method === 'GET';
    const query = req.query || {};
    const body = isGet
      ? {}
      : typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : req.body || {};

    // Update in-RAM config whenever new values are supplied from UI (POST) or query params
    if (typeof body.journeyDate === 'string' && body.journeyDate.trim()) {
      ramConfig.journeyDate = normalizeGsrtcDate(body.journeyDate);
      ramConfig.updatedAt = new Date().toISOString();
    } else if (typeof query.date === 'string' && query.date.trim()) {
      ramConfig.journeyDate = normalizeGsrtcDate(query.date);
      ramConfig.updatedAt = new Date().toISOString();
    }

    if (typeof body.cookie === 'string' && body.cookie.trim()) {
      ramConfig.cookie = body.cookie.trim();
      ramConfig.updatedAt = new Date().toISOString();
    } else if (typeof query.cookie === 'string' && query.cookie.trim()) {
      ramConfig.cookie = query.cookie.trim();
      ramConfig.updatedAt = new Date().toISOString();
    }

    if (typeof body.service1Url === 'string' && body.service1Url.trim()) {
      ramConfig.service1Url = body.service1Url.trim();
      ramConfig.updatedAt = new Date().toISOString();
    }

    if (typeof body.service2Url === 'string' && body.service2Url.trim()) {
      ramConfig.service2Url = body.service2Url.trim();
      ramConfig.updatedAt = new Date().toISOString();
    }

    if (typeof body.ntfyTopic === 'string' && body.ntfyTopic.trim()) {
      ramConfig.ntfyTopic = body.ntfyTopic.trim();
      ramConfig.updatedAt = new Date().toISOString();
    } else if (typeof query.topic === 'string' && query.topic.trim()) {
      ramConfig.ntfyTopic = query.topic.trim();
      ramConfig.updatedAt = new Date().toISOString();
    }

    if (typeof body.callmebotUrl === 'string') {
      ramConfig.callmebotUrl = body.callmebotUrl.trim();
      ramConfig.updatedAt = new Date().toISOString();
    }

    const activeDate = normalizeGsrtcDate(
      ramConfig.journeyDate || DEFAULT_JOURNEY_DATE
    );
    const activeCookie = ramConfig.cookie || DEFAULT_GSRTC_COOKIE;
    const url1 = ramConfig.service1Url || SERVICE_1_SEATER_URL;
    const url2 = ramConfig.service2Url || SERVICE_2_SLEEPER_URL;
    const ntfyTopic = ramConfig.ntfyTopic || 'gsrtc-seat-radar-harsh-52769';

    const halfParam = String(query.half || body.half || '');
    const explicitLoops = Number(query.loops || body.loops || 0);
    const intervalSec = Math.min(
      Math.max(Number(query.intervalSec || body.intervalSec || 10), 2),
      20
    );

    // Determine execution mode:
    // 1. UI POST (no half, no loops): 1 immediate check so UI stays fast (~1s).
    // 2. Cron GET (default, no params needed): 6 checks per minute (every 10s)!
    //    - Half 1 runs Checks #1 (0s), #2 (10s), #3 (20s) (~21s total, well under cron-job.org's 30s timeout)
    //      and spawns Half 2 in parallel at t=0s.
    //    - Half 2 (?half=2) sleeps until t=30s and runs Checks #4 (30s), #5 (40s), #6 (50s).
    // 3. Explicit ?loops=N (e.g. ?loops=6 or ?loops=1): runs N checks in this request.
    let loopsToRun = 1;
    let initialDelayMs = 0;
    let spawnSecondHalf = false;
    let checkIndexOffset = 0;

    if (explicitLoops > 0) {
      loopsToRun = Math.min(explicitLoops, 6);
    } else if (halfParam === '2') {
      loopsToRun = 3;
      initialDelayMs = 29000; // Wake up at ~30s mark for checks #4 (30s), #5 (40s), #6 (50s)
      checkIndexOffset = 3;
    } else if (isGet) {
      loopsToRun = 3; // Checks #1 (0s), #2 (10s), #3 (20s) -> responds in ~21s (<30s cron-job.org limit)
      spawnSecondHalf = true;
    }

    // Fire companion Half 2 at t=0s so Vercel starts the second container while Half 1 stays alive for 21s
    let backgroundHalf2Promise: Promise<unknown> | null = null;
    if (spawnSecondHalf) {
      const proto = req.headers?.['x-forwarded-proto'] || 'https';
      const host =
        req.headers?.['x-forwarded-host'] ||
        req.headers?.host ||
        'seat-checker-taupe.vercel.app';
      const selfUrl = `${proto}://${host}/api/check-dual-seats?half=2`;

      backgroundHalf2Promise = fetch(selfUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          half: '2',
          autoNotify: true,
          journeyDate: activeDate,
          cookie: activeCookie,
          service1Url: url1,
          service2Url: url2,
          ntfyTopic,
          callmebotUrl: ramConfig.callmebotUrl,
        }),
      }).catch(() => null);
    }

    if (initialDelayMs > 0) {
      await sleep(initialDelayMs);
    }

    let lastService1Probe: Awaited<ReturnType<typeof probeSingleGsrtcService>> | null =
      null;
    let lastService2Probe: Awaited<ReturnType<typeof probeSingleGsrtcService>> | null =
      null;
    let anyNotificationSent = false;
    let maxTotalOpen = 0;
    const checksSummary: Array<{
      checkNumber: number;
      timestamp: string;
      s1Open: number;
      s2Open: number;
      totalOpen: number;
      notified: boolean;
      latencyMs: number;
    }> = [];

    for (let i = 0; i < loopsToRun; i++) {
      const loopStartMs = Date.now();
      const checkNumber = checkIndexOffset + i + 1;

      const [service1Probe, service2Probe] = await Promise.all([
        probeSingleGsrtcService({
          rawUrl: url1,
          cookie: activeCookie,
          journeyDate: activeDate,
        }),
        probeSingleGsrtcService({
          rawUrl: url2,
          cookie: activeCookie,
          journeyDate: activeDate,
        }),
      ]);

      lastService1Probe = service1Probe;
      lastService2Probe = service2Probe;

      const s1Open = service1Probe.result.availableCount;
      const s2Open = service2Probe.result.availableCount;
      const totalOpen = s1Open + s2Open;

      let notifiedThisTick = false;
      const shouldNotify =
        (isGet || body.autoNotify === true) &&
        totalOpen > 0 &&
        Boolean(ntfyTopic) &&
        (!anyNotificationSent || totalOpen > maxTotalOpen);

      if (shouldNotify) {
        notifiedThisTick = await sendNtfyAndCallAlert({
          ntfyTopic,
          callmebotUrl: ramConfig.callmebotUrl,
          activeDate,
          totalOpen,
          s1Open,
          s2Open,
          s1Labels: service1Probe.result.openSeatLabels,
          s2Labels: service2Probe.result.openSeatLabels,
          checkLabel: `Check #${checkNumber}/6`,
        });
        if (notifiedThisTick) {
          anyNotificationSent = true;
        }
      }

      if (totalOpen > maxTotalOpen) {
        maxTotalOpen = totalOpen;
      }

      checksSummary.push({
        checkNumber,
        timestamp: new Date().toISOString(),
        s1Open,
        s2Open,
        totalOpen,
        notified: notifiedThisTick,
        latencyMs: Date.now() - loopStartMs,
      });

      if (i < loopsToRun - 1) {
        const elapsedMs = Date.now() - loopStartMs;
        const waitMs = Math.max(1000, intervalSec * 1000 - elapsedMs);
        await sleep(waitMs);
      }
    }

    // Ensure the background request socket was flushed before returning
    if (backgroundHalf2Promise) {
      await Promise.race([backgroundHalf2Promise, sleep(250)]);
    }

    const s1Open = lastService1Probe?.result.availableCount ?? 0;
    const s2Open = lastService2Probe?.result.availableCount ?? 0;
    const totalOpen = s1Open + s2Open;

    return res.status(200).json({
      ok: true,
      journeyDate: activeDate,
      ntfyTopic,
      configUpdatedAt: ramConfig.updatedAt,
      pollingMode: spawnSecondHalf
        ? '6x-per-minute (10s interval: checks #1-#3 complete, checks #4-#6 running in background half=2)'
        : halfParam === '2'
          ? '6x-per-minute (10s interval: checks #4-#6 complete)'
          : `direct (${loopsToRun} check${loopsToRun > 1 ? 's' : ''})`,
      checksCompletedInThisCall: checksSummary.length,
      checksSummary,
      totalOpen,
      maxTotalOpenInBurst: maxTotalOpen,
      cronNotificationSent: anyNotificationSent,
      service1: lastService1Probe,
      service2: lastService2Probe,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Dual check error';
    return res.status(500).json({ ok: false, error: msg });
  }
}



