import { DEFAULT_NTFY_TOPIC } from '../../src/utils/seatParser.js';

const toSafeByteStringHeader = (input: string): string =>
  String(input || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/\u20B9/g, 'INR ')
    .replace(/[^\x20-\x7E]/g, '');

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ dispatched: false, error: 'Method Not Allowed' });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const {
      subject = 'GSRTC Seats Available Alert!',
      message = '',
      ntfyTopic = DEFAULT_NTFY_TOPIC,
      callmebotUrl = '',
    } = body;

    const targetTopic = String(ntfyTopic || DEFAULT_NTFY_TOPIC).trim();
    const targetCallUrl = String(callmebotUrl || '').trim();
    const safeTitleHeader =
      toSafeByteStringHeader(String(subject)) || 'GSRTC Seat Alert';

    const channelsDispatched: string[] = [];
    const errors: string[] = [];
    let ntfyStatus = 'Not attempted';
    let callStatus: string | null = null;

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

    return res.status(200).json({
      dispatched: channelsDispatched.length > 0,
      ntfyTopic: targetTopic,
      ntfyStatus,
      callStatus,
      channelsDispatched,
      errorDetails: errors.length > 0 ? errors.join(' | ') : null,
      note: callStatus ? `${ntfyStatus} · ${callStatus}` : ntfyStatus,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Alert dispatch error';
    return res.status(500).json({ dispatched: false, error: msg });
  }
}
