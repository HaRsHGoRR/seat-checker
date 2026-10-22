import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_GSRTC_COOKIE,
  DEFAULT_JOURNEY_DATE,
  DEFAULT_NTFY_TOPIC,
  SERVICE_1_SEATER_URL,
  SERVICE_2_SLEEPER_URL,
  buildGsrtcUrl,
  generateMockGsrtcHtml,
  normalizeGsrtcDate,
  parseGsrtcHtmlResponse,
  parseGsrtcUrl,
} from './src/utils/seatParser.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RuntimeConfig {
  journeyDate: string;
  cookie: string;
  service1Url: string;
  service2Url: string;
  ntfyTopic: string;
  callmebotUrl: string;
}

export interface ServerAlertLogItem {
  id: string;
  timestamp: string;
  subject: string;
  ntfyStatus: string;
  callStatus: string | null;
  errorDetails: string | null;
}

const runtimeConfig: RuntimeConfig = {
  journeyDate: DEFAULT_JOURNEY_DATE,
  cookie: DEFAULT_GSRTC_COOKIE,
  service1Url: SERVICE_1_SEATER_URL,
  service2Url: SERVICE_2_SLEEPER_URL,
  ntfyTopic: DEFAULT_NTFY_TOPIC,
  callmebotUrl: '',
};

const serverAlertLogs: ServerAlertLogItem[] = [];

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/config', (_req, res) => {
    res.json({
      ok: true,
      config: runtimeConfig,
      alertLogs: serverAlertLogs,
    });
  });

  app.get('/api/alert-logs', (_req, res) => {
    res.json({
      ok: true,
      alertLogs: serverAlertLogs,
    });
  });

  app.post('/api/config', (req, res) => {
    const body = req.body || {};
    if (typeof body.journeyDate === 'string' && body.journeyDate.trim()) {
      runtimeConfig.journeyDate = normalizeGsrtcDate(body.journeyDate);
    }
    if (typeof body.cookie === 'string' && body.cookie.trim()) {
      runtimeConfig.cookie = body.cookie.trim();
    }
    if (typeof body.service1Url === 'string' && body.service1Url.trim()) {
      runtimeConfig.service1Url = body.service1Url.trim();
    }
    if (typeof body.service2Url === 'string' && body.service2Url.trim()) {
      runtimeConfig.service2Url = body.service2Url.trim();
    }
    if (typeof body.ntfyTopic === 'string' && body.ntfyTopic.trim()) {
      runtimeConfig.ntfyTopic = body.ntfyTopic.trim();
    }
    if (typeof body.callmebotUrl === 'string') {
      runtimeConfig.callmebotUrl = body.callmebotUrl.trim();
    }

    res.json({
      ok: true,
      config: runtimeConfig,
    });
  });

  app.all('/api/check-dual-seats', async (req, res) => {
    try {
      const isGet = req.method === 'GET';
      const body = isGet ? {} : req.body || {};
      const query = req.query || {};

      const {
        service1Url,
        service2Url,
        cookie,
        journeyDate,
        ntfyTopic,
        callmebotUrl,
      } = body;

      const activeDate = normalizeGsrtcDate(
        journeyDate ||
          (typeof query.date === 'string' ? query.date : '') ||
          runtimeConfig.journeyDate ||
          DEFAULT_JOURNEY_DATE
      );
      const activeCookie =
        (typeof cookie === 'string' && cookie.trim()) ||
        (typeof query.cookie === 'string' && query.cookie.trim()) ||
        runtimeConfig.cookie ||
        DEFAULT_GSRTC_COOKIE;
      const url1 =
        (typeof service1Url === 'string' && service1Url.trim()) ||
        runtimeConfig.service1Url ||
        SERVICE_1_SEATER_URL;
      const url2 =
        (typeof service2Url === 'string' && service2Url.trim()) ||
        runtimeConfig.service2Url ||
        SERVICE_2_SLEEPER_URL;

      if (typeof ntfyTopic === 'string' && ntfyTopic.trim()) {
        runtimeConfig.ntfyTopic = ntfyTopic.trim();
      } else if (typeof query.topic === 'string' && query.topic.trim()) {
        runtimeConfig.ntfyTopic = query.topic.trim();
      }
      if (typeof callmebotUrl === 'string') {
        runtimeConfig.callmebotUrl = callmebotUrl.trim();
      }

      runtimeConfig.journeyDate = activeDate;
      runtimeConfig.cookie = activeCookie;
      runtimeConfig.service1Url = url1;
      runtimeConfig.service2Url = url2;

      const explicitLoops = Number(query.loops || body.loops || 0);
      const loopsToRun = explicitLoops > 0 ? Math.min(explicitLoops, 6) : 1;
      const intervalSec = Math.min(
        Math.max(Number(query.intervalSec || body.intervalSec || 10), 2),
        20
      );

      let lastService1Probe: Awaited<ReturnType<typeof probeSingleGsrtcService>> | null =
        null;
      let lastService2Probe: Awaited<ReturnType<typeof probeSingleGsrtcService>> | null =
        null;
      const checksSummary: Array<{
        checkNumber: number;
        timestamp: string;
        s1Open: number;
        s2Open: number;
        totalOpen: number;
        latencyMs: number;
      }> = [];

      for (let i = 0; i < loopsToRun; i++) {
        const loopStartMs = Date.now();
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

        lastService1Probe = service1Probe;
        lastService2Probe = service2Probe;

        const s1Open = service1Probe.result.availableCount;
        const s2Open = service2Probe.result.availableCount;
        const totalOpen = s1Open + s2Open;

        console.log(
          `[GSRTC POLL #${i + 1}/${loopsToRun}] ${new Date().toLocaleTimeString('en-US', { hour12: false })} | Date: ${activeDate} | 52769 (Seater): ${s1Open}/${service1Probe.result.totalSeats} Open | 52767 (Sleeper): ${s2Open}/${service2Probe.result.totalSeats} Open`
        );

        checksSummary.push({
          checkNumber: i + 1,
          timestamp: new Date().toISOString(),
          s1Open,
          s2Open,
          totalOpen,
          latencyMs: Date.now() - loopStartMs,
        });

        if (i < loopsToRun - 1) {
          const elapsedMs = Date.now() - loopStartMs;
          const waitMs = Math.max(1000, intervalSec * 1000 - elapsedMs);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }

      const s1Open = lastService1Probe?.result.availableCount ?? 0;
      const s2Open = lastService2Probe?.result.availableCount ?? 0;
      const totalOpen = s1Open + s2Open;

      return res.json({
        ok: true,
        journeyDate: activeDate,
        ntfyTopic: runtimeConfig.ntfyTopic,
        checksCompletedInThisCall: checksSummary.length,
        checksSummary,
        totalOpen,
        service1: lastService1Probe,
        service2: lastService2Probe,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dual check error';
      return res.status(500).json({ ok: false, error: msg });
    }
  });

  // Helper to ensure HTTP header values are valid Latin-1 / ASCII ByteStrings (char codes <= 255)
  const toSafeByteStringHeader = (input: string): string =>
    String(input || '')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2192/g, '->')
      .replace(/\u20B9/g, 'INR ')
      .replace(/[^\x20-\x7E]/g, '');

  // Zero-Password Free Push Alarm (ntfy.sh) + Free Automated Voice Call / WhatsApp (CallMeBot)
  const handleNotifyAlert: express.RequestHandler = async (req, res) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    try {
      const {
        subject = 'GSRTC Seats Available Alert!',
        message = '',
        ntfyTopic = runtimeConfig.ntfyTopic || DEFAULT_NTFY_TOPIC,
        callmebotUrl = runtimeConfig.callmebotUrl,
      } = req.body || {};

      const targetTopic = String(ntfyTopic || DEFAULT_NTFY_TOPIC).trim();
      const targetCallUrl = String(callmebotUrl || '').trim();
      const safeTitleHeader =
        toSafeByteStringHeader(String(subject)) || 'GSRTC Seat Alert';

      runtimeConfig.ntfyTopic = targetTopic;
      runtimeConfig.callmebotUrl = targetCallUrl;

      const channelsDispatched: string[] = [];
      const errors: string[] = [];
      let ntfyStatus = 'Not attempted';
      let callStatus: string | null = null;

      // 1. Free ntfy.sh Instant Phone Push / Alarm (No password or signup required)
      try {
        const ntfyRes = await fetch(
          `https://ntfy.sh/${encodeURIComponent(targetTopic)}`,
          {
            method: 'POST',
            headers: {
              Title: safeTitleHeader,
              Priority: 'urgent',
              Tags: 'bus,rotating_light',
            },
            body: String(message),
          }
        );
        const ntfyText = await ntfyRes.text();
        if (ntfyRes.ok) {
          ntfyStatus = `HTTP 200 OK -> ntfy.sh/${targetTopic}`;
          channelsDispatched.push(`ntfy.sh/${targetTopic}`);
        } else {
          ntfyStatus = `HTTP ${ntfyRes.status}: ${ntfyText.slice(0, 100)}`;
          errors.push(`ntfy.sh: ${ntfyStatus}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'ntfy network error';
        ntfyStatus = `Error: ${msg}`;
        errors.push(`ntfy.sh: ${msg}`);
      }

      // 2. Optional Free CallMeBot (Free Automated Voice Phone Call / WhatsApp text)
      if (targetCallUrl && /^https?:\/\//i.test(targetCallUrl)) {
        try {
          const separator = targetCallUrl.includes('?') ? '&' : '?';
          const callRes = await fetch(
            `${targetCallUrl}${separator}text=${encodeURIComponent(String(message))}`
          );
          if (callRes.ok) {
            callStatus = 'CallMeBot Voice Call / WhatsApp Triggered (HTTP 200)';
            channelsDispatched.push('CallMeBot');
          } else {
            callStatus = `CallMeBot HTTP ${callRes.status}`;
            errors.push(callStatus);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'CallMeBot error';
          callStatus = `CallMeBot Error: ${msg}`;
          errors.push(callStatus);
        }
      }

      const logItem: ServerAlertLogItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp,
        subject: String(subject),
        ntfyStatus,
        callStatus,
        errorDetails: errors.length > 0 ? errors.join(' | ') : null,
      };
      serverAlertLogs.unshift(logItem);
      if (serverAlertLogs.length > 25) serverAlertLogs.pop();

      console.log('[ALERT DISPATCH]', JSON.stringify(logItem));

      return res.json({
        dispatched: channelsDispatched.length > 0,
        ntfyTopic: targetTopic,
        ntfyStatus,
        callStatus,
        channelsDispatched,
        errorDetails: logItem.errorDetails,
        logItem,
        note: callStatus ? `${ntfyStatus} · ${callStatus}` : ntfyStatus,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Alert dispatch error';
      return res.status(500).json({ dispatched: false, error: msg });
    }
  };

  app.post('/api/notify/alert', handleNotifyAlert);
  app.post('/api/notify/email', handleNotifyAlert);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GSRTC Seat Radar listening on http://localhost:${PORT}`);
  });
}

startServer();
