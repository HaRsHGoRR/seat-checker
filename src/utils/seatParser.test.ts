import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVICE_1_SEATER_URL,
  SERVICE_2_SLEEPER_URL,
  DEFAULT_JOURNEY_DATE,
  parseGsrtcUrl,
  buildGsrtcUrl,
  normalizeGsrtcDate,
  parseGsrtcHtmlResponse,
  shouldTriggerAlert,
  generateMockGsrtcHtml,
} from './seatParser';

test('parseGsrtcUrl parses both 52769 (Lower Seater 30) and 52767 (Upper Sleeper 15) URLs and injects journeyDate', () => {
  const s1 = parseGsrtcUrl(SERVICE_1_SEATER_URL);
  assert.equal(s1.serviceId, '52769');
  assert.equal(s1.classCode, '22');
  assert.equal(s1.coachType, 'SLEEPER');
  assert.equal(s1.routeParamCode, '143');
  assert.equal(s1.fareInr, 328);
  assert.equal(s1.duration, '08:35');
  assert.equal(s1.departureTime, '21:00');
  assert.equal(s1.boardingPoint, 'BARODA CENTRAL BUS STATION');
  assert.equal(s1.destinationCity, 'VERAVAL');
  assert.equal(s1.tripCode, '2100BRDVRLSPL30');
  assert.equal(s1.slNo, '15');

  const s2 = parseGsrtcUrl(SERVICE_2_SLEEPER_URL);
  assert.equal(s2.serviceId, '52767');
  assert.equal(s2.routeParamCode, '64');
  assert.equal(s2.fareInr, 423);
  assert.equal(s2.tripCode, '2100BRDVRLSPL15');
  assert.equal(s2.slNo, '14');

  const builtWithDate = buildGsrtcUrl(s1, '2026-11-06');
  assert.equal(builtWithDate.includes('52769,22,SLEEPER,143,0,08:35,21:00'), true);
  assert.equal(builtWithDate.includes('txtJourneyDate=06%2F11%2F2026'), true);
  assert.equal(builtWithDate.includes('onwardJourneyDate=06%2F11%2F2026'), true);
});

test('normalizeGsrtcDate converts ISO and hyphenated dates to DD/MM/YYYY', () => {
  assert.equal(normalizeGsrtcDate('2026-11-06'), '06/11/2026');
  assert.equal(normalizeGsrtcDate('6-11-2026'), '06/11/2026');
  assert.equal(normalizeGsrtcDate('06/11/2026'), '06/11/2026');
  assert.equal(normalizeGsrtcDate(''), DEFAULT_JOURNEY_DATE);
});

test('parseGsrtcHtmlResponse accurately parses real GSRTC images2/*Seat*.gif markup for Sold Out vs Available', () => {
  const s1 = parseGsrtcUrl(SERVICE_1_SEATER_URL);
  const s2 = parseGsrtcUrl(SERVICE_2_SLEEPER_URL);

  // When all 30 seats are bookedSeatnew.gif (and no td.errorMessageTxt is present, just like live 06/11/2026!)
  const soldOutHtml = generateMockGsrtcHtml('sold_out', s1, '06/11/2026');
  const soldOutRes = parseGsrtcHtmlResponse(soldOutHtml, s1.fareInr);
  assert.equal(soldOutRes.status, 'SOLD_OUT');
  assert.equal(soldOutRes.totalSeats, 30);
  assert.equal(soldOutRes.availableCount, 0);
  assert.equal(soldOutRes.bookedCount, 30);
  assert.equal(soldOutRes.detectedJourneyDate, '06/11/2026');

  // When 5 sleeper berths are open on 52767
  const availSleeperHtml = generateMockGsrtcHtml('available', s2, '06/11/2026');
  const availSleeperRes = parseGsrtcHtmlResponse(availSleeperHtml, s2.fareInr);
  assert.equal(availSleeperRes.status, 'AVAILABLE');
  assert.equal(availSleeperRes.totalSeats, 15);
  assert.equal(availSleeperRes.availableCount, 5);
  assert.equal(availSleeperRes.bookedCount, 10);
  assert.equal(availSleeperRes.openSeatLabels.includes('07 UB'), true);
});

test('parseGsrtcHtmlResponse prevents false-positive SEATS AVAILABLE on session expiry or empty HTML', () => {
  const expiredHtml = generateMockGsrtcHtml('session_expired');
  const expiredResult = parseGsrtcHtmlResponse(expiredHtml, 143);
  assert.equal(expiredResult.status, 'SESSION_EXPIRED');
  assert.equal(expiredResult.availableCount, 0);

  const gsrtcExpiredCookieHtml = `
    <html><body>
      <table><tr>
        <td class="errorMessageTxt"><span><strong><b>Sorry..&nbsp;Your&nbsp;Transaction&nbsp;is&nbsp;not&nbsp;completed&nbsp;as&nbsp;reservation&nbsp;system&nbsp;can't&nbsp;process&nbsp;your&nbsp;request.Please&nbsp;select&nbsp;another&nbsp;bus.</b></strong></span></td>
      </tr></table>
    </body></html>
  `;
  const gsrtcExpiredRes = parseGsrtcHtmlResponse(gsrtcExpiredCookieHtml, 143);
  assert.equal(gsrtcExpiredRes.status, 'SESSION_EXPIRED');
  assert.equal(gsrtcExpiredRes.availableCount, 0);

  const emptyResult = parseGsrtcHtmlResponse('   ', 143);
  assert.equal(emptyResult.status, 'ERROR');
  assert.equal(emptyResult.availableCount, 0);
});

test('shouldTriggerAlert deduplicates repeated 10-second polling alerts within cooldown window', () => {
  const t0 = 1_700_000_000_000;
  const cooldownMs = 300_000;

  const firstCheck = shouldTriggerAlert({
    previousStatus: 'SOLD_OUT',
    currentStatus: 'AVAILABLE',
    totalAvailableSeats: 3,
    lastAlertTimestampMs: null,
    nowTimestampMs: t0,
    cooldownMs,
  });
  assert.equal(firstCheck.shouldAlert, true);

  const secondCheck = shouldTriggerAlert({
    previousStatus: 'AVAILABLE',
    currentStatus: 'AVAILABLE',
    totalAvailableSeats: 3,
    lastAlertTimestampMs: t0,
    nowTimestampMs: t0 + 10_000,
    cooldownMs,
  });
  assert.equal(secondCheck.shouldAlert, false);
});
