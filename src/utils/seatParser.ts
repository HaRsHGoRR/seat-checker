export type AvailabilityState =
  | 'IDLE'
  | 'CHECKING'
  | 'AVAILABLE'
  | 'SOLD_OUT'
  | 'SESSION_EXPIRED'
  | 'ERROR';

export type SeatCellState = 'available' | 'ladies' | 'booked';

export interface SeatItem {
  seatNumber: number;
  label: string; // e.g., "07 W", "08 A", "07 UB"
  code: string; // e.g., "W", "A", "UB", "LB"
  state: SeatCellState;
  row: number;
  col: number;
  position: 'Window' | 'Aisle' | 'Upper Berth' | 'Lower Berth';
  fareInr: number;
}

export interface GsrtcServiceInfo {
  baseUrl: string;
  hiddenAction: string;
  serviceId: string;
  classCode: string;
  coachType: string;
  routeParamCode: string;
  fareInr: number;
  concessionCode: string;
  duration: string;
  departureTime: string;
  arrivalTime: string;
  boardingPoint: string;
  originDepot: string;
  destinationCity: string;
  tripCode: string;
  activeFlag: string;
  slNo: string;
  deckTitle: string;
  hadLegacyCorsProxy: boolean;
}

export interface ParsedSeatCheckResult {
  status: AvailabilityState;
  statusHeadline: string;
  rawErrorMessage: string | null;
  bannerTitle: string | null;
  detectedJourneyDate: string | null;
  pickupInfo: string | null;
  dropoffInfo: string | null;
  availableCount: number;
  ladiesAvailableCount: number;
  bookedCount: number;
  totalSeats: number;
  openSeatLabels: string[];
  seats: SeatItem[];
  diagnosticNote: string;
}

export const DEFAULT_JOURNEY_DATE = '06/11/2026';

export const DEFAULT_GSRTC_COOKIE =
  'JSESSIONID=A9D723A37CF8FD9719E68B515BBF40A9; _ga=GA1.1.1052286367.1792697915; _ga_QL6TJ56FNH=GS2.1.s1792697914$o1$g1$t1792698827$j45$l0$h0';

export const DEFAULT_ALERT_EMAIL = 'harsh.s.gor@gmail.com';

export const DEFAULT_NTFY_TOPIC = 'gsrtc-seat-radar-harsh-52769';

export const SERVICE_1_SEATER_URL =
  'https://gsrtc.in/OPRSOnline/advanceBooking.do?hiddenAction=SubmitToGetAjaxSeatLayout&radOnwardServiceID=52769,22,SLEEPER,143,0,08:35,21:00,BARODA%20CENTRAL%20BUS%20STATION,BARODA%20CENTRAL%20BUS%20STATION,VERAVAL,2100BRDVRLSPL30,Y&slNo=15';

export const SERVICE_2_SLEEPER_URL =
  'https://gsrtc.in/OPRSOnline/advanceBooking.do?hiddenAction=SubmitToGetAjaxSeatLayout&radOnwardServiceID=52767,22,SLEEPER,64,0,08:35,21:00,BARODA%20CENTRAL%20BUS%20STATION,BARODA%20CENTRAL%20BUS%20STATION,VERAVAL,2100BRDVRLSPL15,Y&slNo=14';

export const DEFAULT_GSRTC_TARGET_URL = SERVICE_1_SEATER_URL;

/**
 * Normalizes a date string (YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY)
 * into GSRTC's required DD/MM/YYYY format (e.g., "06/11/2026").
 */
export function normalizeGsrtcDate(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return DEFAULT_JOURNEY_DATE;

  // Match YYYY-MM-DD (from HTML <input type="date">)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  // Match DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, '0');
    const mm = dmyMatch[2].padStart(2, '0');
    return `${dd}/${mm}/${dmyMatch[3]}`;
  }

  return trimmed;
}

/**
 * Converts GSRTC DD/MM/YYYY to ISO YYYY-MM-DD for <input type="date">
 */
export function gsrtcDateToIso(gsrtcDate: string): string {
  const normalized = normalizeGsrtcDate(gsrtcDate);
  const m = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return '2026-11-06';
}

/**
 * Parses a GSRTC advanceBooking.do URL into structured route and service parameters.
 */
export function parseGsrtcUrl(rawInputUrl: string): GsrtcServiceInfo {
  const trimmed = (rawInputUrl || '').trim();
  const corsPrefixRegex = /^https?:\/\/cors-anywhere\.herokuapp\.com\//i;
  const hadLegacyCorsProxy = corsPrefixRegex.test(trimmed);
  const cleanUrl = trimmed.replace(corsPrefixRegex, '');

  const fallback: GsrtcServiceInfo = {
    baseUrl: 'https://gsrtc.in/OPRSOnline/advanceBooking.do',
    hiddenAction: 'SubmitToGetAjaxSeatLayout',
    serviceId: '52769',
    classCode: '22',
    coachType: 'SLEEPER',
    routeParamCode: '143',
    fareInr: 328,
    concessionCode: '0',
    duration: '08:35',
    departureTime: '21:00',
    arrivalTime: '05:35',
    boardingPoint: 'BARODA CENTRAL BUS STATION',
    originDepot: 'BARODA CENTRAL BUS STATION',
    destinationCity: 'VERAVAL',
    tripCode: '2100BRDVRLSPL30',
    activeFlag: 'Y',
    slNo: '15',
    deckTitle: 'Lower Deck Seater (30 Seats)',
    hadLegacyCorsProxy,
  };

  try {
    const parsed = new URL(cleanUrl);
    const baseUrl = `${parsed.origin}${parsed.pathname}`;
    const hiddenAction =
      parsed.searchParams.get('hiddenAction') || fallback.hiddenAction;
    const slNo = parsed.searchParams.get('slNo') || fallback.slNo;
    const radOnward = parsed.searchParams.get('radOnwardServiceID');

    if (!radOnward) {
      return { ...fallback, baseUrl, hiddenAction, slNo };
    }

    const parts = decodeURIComponent(radOnward).split(',');
    const routeParamCode = parts[3]?.trim() || fallback.routeParamCode;
    const tripCode = parts[10]?.trim() || fallback.tripCode;
    const serviceId = parts[0]?.trim() || fallback.serviceId;

    const isUpperSleeper =
      tripCode.endsWith('15') || serviceId === '52767' || slNo === '14';
    const deckTitle = isUpperSleeper
      ? 'Upper Deck Sleeper (15 Berths)'
      : 'Lower Deck Seater (30 Seats)';
    const fareInr = isUpperSleeper ? 423 : 328;

    return {
      baseUrl,
      hiddenAction,
      serviceId,
      classCode: parts[1]?.trim() || fallback.classCode,
      coachType: parts[2]?.trim() || fallback.coachType,
      routeParamCode,
      fareInr,
      concessionCode: parts[4]?.trim() || fallback.concessionCode,
      duration: parts[5]?.trim() || fallback.duration,
      departureTime: parts[6]?.trim() || fallback.departureTime,
      arrivalTime: '05:35',
      boardingPoint: parts[7]?.trim() || fallback.boardingPoint,
      originDepot: parts[8]?.trim() || fallback.originDepot,
      destinationCity: parts[9]?.trim() || fallback.destinationCity,
      tripCode,
      activeFlag: parts[11]?.trim() || fallback.activeFlag,
      slNo,
      deckTitle,
      hadLegacyCorsProxy,
    };
  } catch {
    return fallback;
  }
}

/**
 * Reconstructs the GSRTC URL with optional journeyDate query parameters
 * (&txtJourneyDate=DD/MM/YYYY&onwardJourneyDate=DD/MM/YYYY) which GSRTC OPRS
 * reads to switch the target onward journey date dynamically.
 */
export function buildGsrtcUrl(
  info: GsrtcServiceInfo,
  journeyDate?: string
): string {
  const radParts = [
    info.serviceId,
    info.classCode,
    info.coachType,
    info.routeParamCode,
    info.concessionCode,
    info.duration,
    info.departureTime,
    encodeURIComponent(info.boardingPoint),
    encodeURIComponent(info.originDepot),
    encodeURIComponent(info.destinationCity),
    info.tripCode,
    info.activeFlag,
  ].join(',');

  let url = `${info.baseUrl}?hiddenAction=${encodeURIComponent(info.hiddenAction)}&radOnwardServiceID=${radParts}&slNo=${encodeURIComponent(info.slNo)}`;

  if (journeyDate && journeyDate.trim()) {
    const normDate = normalizeGsrtcDate(journeyDate);
    url += `&txtJourneyDate=${encodeURIComponent(normDate)}&onwardJourneyDate=${encodeURIComponent(normDate)}`;
  }

  return url;
}

/**
 * Pure HTML parser for GSRTC `SubmitToGetAjaxSeatLayout` responses.
 */
export function parseGsrtcHtmlResponse(
  html: string,
  fareInr = 328
): ParsedSeatCheckResult {
  const raw = (html || '').trim();

  if (!raw) {
    return {
      status: 'ERROR',
      statusHeadline: 'Empty Response Received',
      rawErrorMessage: 'The GSRTC server returned an empty payload.',
      bannerTitle: null,
      detectedJourneyDate: null,
      pickupInfo: null,
      dropoffInfo: null,
      availableCount: 0,
      ladiesAvailableCount: 0,
      bookedCount: 0,
      totalSeats: 0,
      openSeatLabels: [],
      seats: [],
      diagnosticNote:
        'Prevented false-positive: Empty response is flagged as ERROR rather than AVAILABLE.',
    };
  }

  if (
    /cors-anywhere/i.test(raw) ||
    /See \/corsdemo for more info/i.test(raw) ||
    /Missing required request header/i.test(raw)
  ) {
    return {
      status: 'ERROR',
      statusHeadline: 'Legacy CORS Proxy Rejected Request',
      rawErrorMessage:
        'cors-anywhere.herokuapp.com blocked the request. Using built-in backend proxy.',
      bannerTitle: null,
      detectedJourneyDate: null,
      pickupInfo: null,
      dropoffInfo: null,
      availableCount: 0,
      ladiesAvailableCount: 0,
      bookedCount: 0,
      totalSeats: 0,
      openSeatLabels: [],
      seats: [],
      diagnosticNote: 'Use direct GSRTC URLs via the server-side proxy.',
    };
  }

  // Extract banner title e.g. "BARODA CENTRAL BUS STATION to JUNAGADH - Onward Journey date 06/11/2026"
  const titleMatch = raw.match(
    /<span[^>]*class=["'][^"']*tableTitleSeatLayoyt3[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
  );
  const bannerTitle = titleMatch
    ? titleMatch[1]
        .replace(/&nbsp;/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : null;

  const dateInBannerMatch = bannerTitle?.match(/(\d{2}\/\d{2}\/\d{4})/);
  const detectedJourneyDate = dateInBannerMatch ? dateInBannerMatch[1] : null;

  // Extract pickup and dropoff option labels if present
  const pickupMatch = raw.match(
    /<select[^>]*name=["']selectPickupPoint\d*["'][^>]*>[\s\S]*?<option[^>]*>([\s\S]*?)<\/option>/i
  );
  const dropoffMatch = raw.match(
    /<select[^>]*name=["']selectDropOffPoint\d*["'][^>]*>[\s\S]*?<option[^>]*>([\s\S]*?)<\/option>/i
  );
  const pickupInfo = pickupMatch
    ? pickupMatch[1].replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
    : null;
  const dropoffInfo = dropoffMatch
    ? dropoffMatch[1].replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
    : null;

  // Check for explicit td.errorMessageTxt
  const errorTdMatch = raw.match(
    /<td[^>]*class=["'][^"']*errorMessageTxt[^"']*["'][^>]*>([\s\S]*?)<\/td>/i
  );
  if (errorTdMatch) {
    const strippedError = errorTdMatch[1]
      .replace(/&nbsp;/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (
      /session\s+expired|invalid\s+session|time\s*out|can't\s+process\s+your\s+request|cannot\s+process\s+your\s+request/i.test(
        strippedError
      )
    ) {
      return {
        status: 'SESSION_EXPIRED',
        statusHeadline:
          'JSESSIONID Session Expired or Invalid Request (Refresh Cookie)',
        rawErrorMessage: strippedError,
        bannerTitle,
        detectedJourneyDate,
        pickupInfo,
        dropoffInfo,
        availableCount: 0,
        ladiesAvailableCount: 0,
        bookedCount: 0,
        totalSeats: 0,
        openSeatLabels: [],
        seats: [],
        diagnosticNote:
          'GSRTC returned "reservation system can\'t process your request" with 0 seat icons — your JSESSIONID cookie has expired or the session is uninitialized.',
      };
    }

    return {
      status: 'SOLD_OUT',
      statusHeadline: strippedError || 'No Seats Available',
      rawErrorMessage: strippedError || 'Seats are not available',
      bannerTitle,
      detectedJourneyDate,
      pickupInfo,
      dropoffInfo,
      availableCount: 0,
      ladiesAvailableCount: 0,
      bookedCount: 0,
      totalSeats: 0,
      openSeatLabels: [],
      seats: [],
      diagnosticNote:
        'Matched td.errorMessageTxt from GSRTC OPRS response confirming no seats are open.',
    };
  }

  // Detect session expiry or login page
  if (
    /session\s+has\s+expired|session\s+expired|please\s+login\s+again|userLoginAction/i.test(
      raw
    )
  ) {
    return {
      status: 'SESSION_EXPIRED',
      statusHeadline: 'JSESSIONID Cookie Expired',
      rawErrorMessage:
        'GSRTC returned a session timeout page. Update your JSESSIONID cookie in the live bar above.',
      bannerTitle,
      detectedJourneyDate,
      pickupInfo,
      dropoffInfo,
      availableCount: 0,
      ladiesAvailableCount: 0,
      bookedCount: 0,
      totalSeats: 0,
      openSeatLabels: [],
      seats: [],
      diagnosticNote:
        'Prevented false-positive: Session timeout detected instead of reporting SEATS AVAILABLE.',
    };
  }

  // 1. Parse real GSRTC OPRS <img id="..." src="images2/..." title="..."><div class="seatLayoutNoTxt">...</div>
  const realImgRegex =
    /<img[^>]*id=["']([^"']+)["'][^>]*src=["']images2\/([^"']+)["'][^>]*title=["']\s*(\d+)\s*["'][^>]*>[\s\S]{0,450}?<div[^>]*class=["']seatLayoutNoTxt["'][^>]*>([\s\S]*?)<\/div>/gi;

  const parsedSeatsByNumber = new Map<number, SeatItem>();
  let imgMatch: RegExpExecArray | null;

  while ((imgMatch = realImgRegex.exec(raw)) !== null) {
    const imgFile = imgMatch[2];
    const seatNumber = Number.parseInt(imgMatch[3], 10);
    const rawTxt = imgMatch[4]
      .replace(/&nbsp;/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!Number.isFinite(seatNumber) || seatNumber < 1 || seatNumber > 70) {
      continue;
    }

    let state: SeatCellState = 'booked';
    if (/LadiesSeat|Sleeper-Seat_Ladies|Sleeper-Ladies/i.test(imgFile)) {
      state = 'ladies';
    } else if (/availableSeat|Sleeper-Seat_Available/i.test(imgFile)) {
      state = 'available';
    } else {
      state = 'booked';
    }

    const suffixMatch = rawTxt.match(/\b(UB|LB|W|A)\b/i);
    const code = suffixMatch ? suffixMatch[1].toUpperCase() : 'W';
    const position: SeatItem['position'] =
      code === 'UB'
        ? 'Upper Berth'
        : code === 'LB'
          ? 'Lower Berth'
          : code === 'A'
            ? 'Aisle'
            : 'Window';

    const label = `${String(seatNumber).padStart(2, '0')} ${code}`;

    parsedSeatsByNumber.set(seatNumber, {
      seatNumber,
      label,
      code,
      state,
      row: 1,
      col: 0,
      position,
      fareInr,
    });
  }

  // 2. Fallback: Check class-based or checkbox-based fixtures (availSeatClass / ladiesSeatClass / bookedSeatClass)
  if (parsedSeatsByNumber.size === 0) {
    const seatCellRegex =
      /<td[^>]*class=["']([^"']*(?:availSeatClass|ladiesSeatClass|bookedSeatClass)[^"']*)["'][^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = seatCellRegex.exec(raw)) !== null) {
      const classNames = cellMatch[1];
      const innerHtml = cellMatch[2];
      const numMatch =
        innerHtml.match(/value=["']?(\d{1,2})["']?/i) ||
        innerHtml.replace(/<[^>]+>/g, ' ').match(/\b(\d{1,2})\b/);
      if (numMatch) {
        const seatNo = Number.parseInt(numMatch[1], 10);
        if (seatNo >= 1 && seatNo <= 60) {
          const state: SeatCellState = /ladiesSeatClass/i.test(classNames)
            ? 'ladies'
            : /availSeatClass/i.test(classNames)
              ? 'available'
              : 'booked';
          const isWindow = seatNo % 2 === 1;
          const code = isWindow ? 'W' : 'A';
          parsedSeatsByNumber.set(seatNo, {
            seatNumber: seatNo,
            label: `${String(seatNo).padStart(2, '0')} ${code}`,
            code,
            state,
            row: Math.ceil(seatNo / 3),
            col: (seatNo - 1) % 3,
            position: isWindow ? 'Window' : 'Aisle',
            fareInr,
          });
        }
      }
    }
  }

  if (parsedSeatsByNumber.size === 0) {
    return {
      status: 'SESSION_EXPIRED',
      statusHeadline: 'Session Expired or Invalid Seat Layout HTML',
      rawErrorMessage:
        'Response contained no GSRTC seat layout images (images2/*Seat*.gif) and no errorMessageTxt. Your JSESSIONID cookie has likely expired.',
      bannerTitle,
      detectedJourneyDate,
      pickupInfo,
      dropoffInfo,
      availableCount: 0,
      ladiesAvailableCount: 0,
      bookedCount: 0,
      totalSeats: 0,
      openSeatLabels: [],
      seats: [],
      diagnosticNote:
        'Prevented false-positive: Unrecognized or expired session response is never marked AVAILABLE.',
    };
  }

  // Sort seats by seatNumber and assign physical GSRTC row/col:
  // - For 30-seat Seater (52769): GSRTC uses boustrophedon/snake numbering (Odd rows: 1W, 2A | 3W; Even rows: 6W, 5A | 4W)
  // - For 15-berth Sleeper (52767): GSRTC uses linear 3-across numbering (Row 1: 1UB, 2UB | 3UB; Row 2: 4UB, 5UB | 6UB)
  const sortedSeats = Array.from(parsedSeatsByNumber.values()).sort(
    (a, b) => a.seatNumber - b.seatNumber
  );
  const totalSeats = sortedSeats.length;
  const seatsPerRow = totalSeats <= 18 ? 3 : totalSeats <= 32 ? 3 : 4;
  const isSnakeSeater30 =
    totalSeats === 30 && sortedSeats.some(s => s.code === 'A');

  const finalSeats: SeatItem[] = sortedSeats.map((s, idx) => {
    const row = Math.floor(idx / seatsPerRow) + 1;
    const baseCol = idx % seatsPerRow;
    const col =
      isSnakeSeater30 && row % 2 === 0 ? seatsPerRow - 1 - baseCol : baseCol;
    return {
      ...s,
      row,
      col,
    };
  });

  const availableCount = finalSeats.filter(s => s.state === 'available').length;
  const ladiesAvailableCount = finalSeats.filter(
    s => s.state === 'ladies'
  ).length;
  const bookedCount = finalSeats.filter(s => s.state === 'booked').length;
  const openSeats = finalSeats.filter(s => s.state !== 'booked');
  const openSeatLabels = openSeats.map(s => s.label);
  const totalOpen = openSeats.length;

  if (totalOpen > 0) {
    return {
      status: 'AVAILABLE',
      statusHeadline: `${totalOpen} Seat${totalOpen === 1 ? '' : 's'} Open (${openSeatLabels.slice(0, 6).join(', ')}${openSeatLabels.length > 6 ? '...' : ''})`,
      rawErrorMessage: null,
      bannerTitle,
      detectedJourneyDate,
      pickupInfo,
      dropoffInfo,
      availableCount,
      ladiesAvailableCount,
      bookedCount,
      totalSeats,
      openSeatLabels,
      seats: finalSeats,
      diagnosticNote: `Verified ${totalOpen} available seat/berth image(s) out of ${totalSeats} in GSRTC layout${detectedJourneyDate ? ` for ${detectedJourneyDate}` : ''}.`,
    };
  }

  return {
    status: 'SOLD_OUT',
    statusHeadline: `Sold Out (0 / ${totalSeats} Open)`,
    rawErrorMessage: `All ${totalSeats} seats/berths are marked booked (${bookedCount}/${totalSeats}).`,
    bannerTitle,
    detectedJourneyDate,
    pickupInfo,
    dropoffInfo,
    availableCount: 0,
    ladiesAvailableCount: 0,
    bookedCount,
    totalSeats,
    openSeatLabels: [],
    seats: finalSeats,
    diagnosticNote: `Fixed false-positive: GSRTC returned ${totalSeats} seats with 0 available and no td.errorMessageTxt${detectedJourneyDate ? ` for ${detectedJourneyDate}` : ''}. Correctly marked SOLD_OUT.`,
  };
}

/**
 * Pure alert deduplication logic.
 */
export function shouldTriggerAlert(params: {
  previousStatus: AvailabilityState;
  currentStatus: AvailabilityState;
  totalAvailableSeats: number;
  lastAlertTimestampMs: number | null;
  nowTimestampMs: number;
  cooldownMs: number;
}): { shouldAlert: boolean; reason: string } {
  const {
    previousStatus,
    currentStatus,
    totalAvailableSeats,
    lastAlertTimestampMs,
    nowTimestampMs,
    cooldownMs,
  } = params;

  if (currentStatus !== 'AVAILABLE' || totalAvailableSeats <= 0) {
    return {
      shouldAlert: false,
      reason: '0 open seats across monitored services',
    };
  }

  if (cooldownMs <= 0) {
    return {
      shouldAlert: true,
      reason: `Seats open (${totalAvailableSeats} available) - alerting on every poll`,
    };
  }

  if (previousStatus !== 'AVAILABLE') {
    if (
      lastAlertTimestampMs !== null &&
      nowTimestampMs - lastAlertTimestampMs < cooldownMs
    ) {
      const remainingSec = Math.ceil(
        (cooldownMs - (nowTimestampMs - lastAlertTimestampMs)) / 1000
      );
      return {
        shouldAlert: false,
        reason: `Suppressed duplicate email (${remainingSec}s cooldown left)`,
      };
    }
    return {
      shouldAlert: true,
      reason: `Seats opened! Transitioned ${previousStatus} -> AVAILABLE (${totalAvailableSeats} open)`,
    };
  }

  if (lastAlertTimestampMs === null) {
    return {
      shouldAlert: true,
      reason: `Initial availability alert (${totalAvailableSeats} open)`,
    };
  }

  const elapsed = nowTimestampMs - lastAlertTimestampMs;
  if (elapsed >= cooldownMs) {
    return {
      shouldAlert: true,
      reason: `Cooldown elapsed (${Math.round(cooldownMs / 1000)}s); sending reminder email (${totalAvailableSeats} open)`,
    };
  }

  const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
  return {
    shouldAlert: false,
    reason: `Deduplicated: Email/Push already sent (${remainingSec}s until reminder)`,
  };
}

/**
 * Generates authentic GSRTC OPRS HTML matching the exact `images2/*Seat*.gif`
 * and `seatLayoutNoTxt` structure of Services 52769 (30-seat Seater) & 52767 (15-berth Sleeper).
 */
export function generateMockGsrtcHtml(
  scenario: 'available' | 'scarce' | 'sold_out' | 'session_expired',
  serviceInfo?: GsrtcServiceInfo,
  journeyDate = DEFAULT_JOURNEY_DATE
): string {
  if (scenario === 'session_expired') {
    return `
      <html>
        <body>
          <div class="sessionTimeoutBox">
            Your session has expired due to inactivity. Please login again to search GSRTC services.
          </div>
        </body>
      </html>
    `;
  }

  const isSleeper15 =
    serviceInfo?.serviceId === '52767' ||
    serviceInfo?.tripCode?.endsWith('15') ||
    serviceInfo?.slNo === '14';

  const total = isSleeper15 ? 15 : 30;
  const openSet =
    scenario === 'sold_out'
      ? new Set<number>()
      : scenario === 'scarce'
        ? isSleeper15
          ? new Set([7])
          : new Set([13, 18])
        : isSleeper15
          ? new Set([7, 8, 10, 11, 15])
          : new Set([7, 8, 9, 13, 14, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30]);

  const cells: string[] = [];
  for (let n = 1; n <= total; n++) {
    const isOpen = openSet.has(n);
    const imgName = isSleeper15
      ? isOpen
        ? 'Sleeper-Seat_Available.gif'
        : 'Sleeper-Seat_Booked.gif'
      : isOpen
        ? 'availableSeatnew.gif'
        : 'bookedSeatnew.gif';
    const suffix = isSleeper15 ? 'UB' : n % 3 === 2 ? 'A' : 'W';
    const idAttr = isOpen ? `${serviceInfo?.serviceId || '52769'}-O${n}` : `O ${n}`;
    cells.push(`
      <td width="50" align="center">
        <table>
          <tr><td><img id="${idAttr}" src="images2/${imgName}" title=" ${n} " /></td></tr>
          <tr><td><div align="center" class="seatLayoutNoTxt">${n}&nbsp;${suffix}</div></td></tr>
        </table>
      </td>
    `);
  }

  return `
    <html>
      <body>
        <span class="tableTitleSeatLayoyt3">${serviceInfo?.boardingPoint || 'BARODA CENTRAL BUS STATION'}&nbsp;to&nbsp;JUNAGADH&nbsp;-&nbsp;Onward&nbsp;Journey&nbsp;date&nbsp;${normalizeGsrtcDate(journeyDate)}</span>
        <select name="selectPickupPoint15"><option value="2641,21:00,null">${serviceInfo?.boardingPoint || 'BARODA CENTRAL BUS STATION'}--21:00</option></select>
        <select name="selectDropOffPoint15"><option value="91,05:35,null">${serviceInfo?.destinationCity || 'VERAVAL'}--05:35</option></select>
        <table id="Table_5"><tr>${cells.join('')}</tr></table>
      </body>
    </html>
  `;
}
