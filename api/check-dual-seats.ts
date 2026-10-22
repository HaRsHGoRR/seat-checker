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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { service1Url, service2Url, cookie, journeyDate } = body;

    const activeDate = normalizeGsrtcDate(journeyDate || DEFAULT_JOURNEY_DATE);
    const activeCookie =
      (typeof cookie === 'string' && cookie.trim()) || DEFAULT_GSRTC_COOKIE;
    const url1 =
      (typeof service1Url === 'string' && service1Url.trim()) ||
      SERVICE_1_SEATER_URL;
    const url2 =
      (typeof service2Url === 'string' && service2Url.trim()) ||
      SERVICE_2_SLEEPER_URL;

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

    return res.status(200).json({
      ok: true,
      journeyDate: activeDate,
      service1: service1Probe,
      service2: service2Probe,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Dual check error';
    return res.status(500).json({ ok: false, error: msg });
  }
}
