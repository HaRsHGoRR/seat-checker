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

export default async function handler(req: any, res: any) {
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

    const service1Probe = await probeSingleGsrtcService({
      rawUrl: url1,
      cookie: activeCookie,
      journeyDate: activeDate,
    });
    const service2Probe = await probeSingleGsrtcService({
      rawUrl: url2,
      cookie: activeCookie,
      journeyDate: activeDate,
    });

    const s1Open = service1Probe.result.availableCount;
    const s2Open = service2Probe.result.availableCount;
    const totalOpen = s1Open + s2Open;

    let cronNotificationSent = false;
    // When triggered via GET (e.g. 24/7 external cron job with no browser open),
    // automatically send the ntfy.sh push notification if any seat is open.
    if ((isGet || body.autoNotify === true) && totalOpen > 0 && ntfyTopic) {
      const cleanTopic = String(ntfyTopic)
        .trim()
        .replace(/^https?:\/\/ntfy\.sh\//i, '')
        .replace(/[^a-zA-Z0-9_-]/g, '');

      if (cleanTopic) {
        const s1Labels =
          service1Probe.result.openSeatLabels.join(', ') || 'None';
        const s2Labels =
          service2Probe.result.openSeatLabels.join(', ') || 'None';
        const title = toSafeByteStringHeader(
          `GSRTC OPEN: ${totalOpen} Seat(s) on ${activeDate}`
        );
        const message = [
          `Route: BARODA CENTRAL BUS STATION -> VERAVAL`,
          `Date: ${activeDate} (21:00 Dept)`,
          `Seater 52769 (INR 328): ${s1Open} open (${s1Labels})`,
          `Sleeper 52767 (INR 423): ${s2Open} open (${s2Labels})`,
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
          cronNotificationSent = ntfyRes.ok;
        } catch {
          cronNotificationSent = false;
        }
      }

      if (
        ramConfig.callmebotUrl &&
        ramConfig.callmebotUrl.startsWith('http')
      ) {
        try {
          await fetch(ramConfig.callmebotUrl, { method: 'GET' });
        } catch {
          // ignore callmebot error
        }
      }
    }

    return res.status(200).json({
      ok: true,
      journeyDate: activeDate,
      ntfyTopic,
      configUpdatedAt: ramConfig.updatedAt,
      totalOpen,
      cronNotificationSent,
      service1: service1Probe,
      service2: service2Probe,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Dual check error';
    return res.status(500).json({ ok: false, error: msg });
  }
}


