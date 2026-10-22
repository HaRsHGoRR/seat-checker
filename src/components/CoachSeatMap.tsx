import React from 'react';
import { GsrtcServiceInfo, ParsedSeatCheckResult, SeatItem } from '../utils/seatParser';

interface DualCoachSeatMapProps {
  service1Info: GsrtcServiceInfo;
  service1Result: ParsedSeatCheckResult;
  service2Info: GsrtcServiceInfo;
  service2Result: ParsedSeatCheckResult;
  selectedSeatIds: string[];
  onToggleSeatId: (seatKey: string) => void;
  onClearSelection: () => void;
}

export const CoachSeatMap: React.FC<DualCoachSeatMapProps> = ({
  service1Info,
  service1Result,
  service2Info,
  service2Result,
  selectedSeatIds,
  onToggleSeatId,
  onClearSelection,
}) => {
  const [copiedSummary, setCopiedSummary] = React.useState(false);
  const selectedSet = new Set(selectedSeatIds);

  const allItemsWithDeck = [
    ...service1Result.seats.map(s => ({
      ...s,
      deckKey: `S1-${s.seatNumber}`,
      serviceId: service1Info.serviceId,
      deckName: 'Seater',
    })),
    ...service2Result.seats.map(s => ({
      ...s,
      deckKey: `S2-${s.seatNumber}`,
      serviceId: service2Info.serviceId,
      deckName: 'Sleeper',
    })),
  ];

  const selectedObjects = allItemsWithDeck.filter(item =>
    selectedSet.has(item.deckKey)
  );
  const totalFare = selectedObjects.reduce((sum, s) => sum + s.fareInr, 0);

  const handleCopyChecklist = () => {
    if (selectedObjects.length === 0) return;
    const text = `GSRTC Baroda -> Veraval (${service1Result.detectedJourneyDate || '06/11/2026'}) — Selected: ${selectedObjects
      .map(s => `[Svc ${s.serviceId} #${s.label} INR ${s.fareInr}]`)
      .join(', ')} — Total: INR ${totalFare}`;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const renderDeckGrid = (
    info: GsrtcServiceInfo,
    result: ParsedSeatCheckResult,
    prefix: 'S1' | 'S2',
    isSleeperBerth: boolean
  ) => {
    const rowsMap = new Map<number, SeatItem[]>();
    for (const seat of result.seats) {
      const list = rowsMap.get(seat.row) ?? [];
      list.push(seat);
      rowsMap.set(seat.row, list);
    }
    const rows = Array.from(rowsMap.entries()).sort((a, b) => a[0] - b[0]);

    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Service {info.serviceId} · {info.deckTitle}
              </h3>
              <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                Trip {info.tripCode} · slNo={info.slNo} · INR {info.fareInr} ·{' '}
                {result.availableCount + result.ladiesAvailableCount} /{' '}
                {result.totalSeats} Open
              </p>
            </div>
            <span
              className={`text-xs font-mono font-semibold px-2.5 py-1 rounded border ${
                result.status === 'AVAILABLE'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
            >
              {result.status}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              No layout cells returned for Service {info.serviceId}. Check
              JSESSIONID cookie or switch to Simulated Open mode.
            </div>
          ) : (
            <div
              className="space-y-2"
              role="group"
              aria-label={`Service ${info.serviceId} seat layout`}
            >
              {rows.map(([rowNumber, rowSeats]) => {
                const ordered = [...rowSeats].sort((a, b) => a.col - b.col);
                // GSRTC 2+1 layout: Left pair (col 0 Window + col 1 Aisle), Gangway, Right single (col 2 Window)
                const leftPair = ordered.slice(0, 2);
                const rightSeat = ordered[2];

                const renderSeatBtn = (seat: SeatItem) => {
                  const key = `${prefix}-${seat.seatNumber}`;
                  const isBooked = seat.state === 'booked';
                  const isLadies = seat.state === 'ladies';
                  const isSelected = selectedSet.has(key);

                  let btnStyles =
                    'border-emerald-600 bg-emerald-50 text-emerald-950 hover:bg-emerald-100';
                  let stateWord = 'Open';

                  if (isBooked) {
                    btnStyles =
                      'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed';
                    stateWord = 'Booked';
                  } else if (isSelected) {
                    btnStyles =
                      'border-slate-900 bg-slate-900 text-white hover:bg-slate-800';
                    stateWord = 'Selected';
                  } else if (isLadies) {
                    btnStyles =
                      'border-amber-600 bg-amber-50 text-amber-950 hover:bg-amber-100';
                    stateWord = 'Ladies';
                  }

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={isBooked}
                      onClick={() => onToggleSeatId(key)}
                      aria-label={`Service ${info.serviceId} ${seat.label}, ${stateWord}, INR ${seat.fareInr}`}
                      aria-pressed={isSelected}
                      className={`${
                        isSleeperBerth ? 'h-12' : 'h-9'
                      } w-full rounded-md border text-xs font-mono tabular-nums font-semibold transition-colors flex items-center justify-between px-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${btnStyles}`}
                    >
                      <span>{seat.label}</span>
                      <span className="text-[10px] font-sans font-semibold opacity-80">
                        {isBooked
                          ? 'X'
                          : isSelected
                            ? 'SEL'
                            : isLadies
                              ? 'L'
                              : 'OPEN'}
                      </span>
                    </button>
                  );
                };

                return (
                  <div
                    key={rowNumber}
                    className="grid grid-cols-9 gap-2 items-center"
                  >
                    <div className="col-span-2">
                      {leftPair[0] && renderSeatBtn(leftPair[0])}
                    </div>
                    <div className="col-span-2">
                      {leftPair[1] && renderSeatBtn(leftPair[1])}
                    </div>
                    <div
                      aria-hidden="true"
                      className="col-span-2 text-center text-[11px] font-mono tabular-nums text-slate-400"
                    >
                      R{String(rowNumber).padStart(2, '0')}
                    </div>
                    <div className="col-span-3">
                      {rightSeat && renderSeatBtn(rightSeat)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
          <span>{result.pickupInfo || info.boardingPoint}</span>
          <span>-&gt;</span>
          <span>{result.dropoffInfo || info.destinationCity}</span>
        </div>
      </div>
    );
  };

  return (
    <section
      id="seat-map"
      aria-labelledby="seat-map-heading"
      className="bg-white border border-slate-200 rounded-xl p-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h2
            id="seat-map-heading"
            className="text-lg font-semibold text-slate-900 tracking-tight"
          >
            Dual-Deck GSRTC Coach Layout (Seater 52769 + Sleeper 52767)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            <span>Baroda Central Bus Station to Veraval</span>
            <span aria-hidden="true" className="mx-1.5">
              ·
            </span>
            <span className="font-mono tabular-nums">
              30 Lower Seater (INR {service1Info.fareInr}) + 15 Upper Sleeper
              Berths (INR {service2Info.fareInr})
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="w-3.5 h-3.5 rounded border border-emerald-600 bg-emerald-50 inline-block"
            />
            <span>Available (OPEN)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="w-3.5 h-3.5 rounded border border-amber-600 bg-amber-50 inline-block"
            />
            <span>Ladies (L)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="w-3.5 h-3.5 rounded border border-slate-900 bg-slate-900 inline-block"
            />
            <span>Selected (SEL)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="w-3.5 h-3.5 rounded border border-slate-200 bg-slate-100 inline-block"
            />
            <span>Booked (X)</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-6 items-stretch">
        {/* Left 6 Cols: Service 52769 (30-Seat Lower Seater) */}
        <div className="lg:col-span-6 flex flex-col">
          {renderDeckGrid(service1Info, service1Result, 'S1', false)}
        </div>

        {/* Right 6 Cols: Service 52767 (15-Berth Upper Sleeper) + Selection Summary */}
        <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
          {renderDeckGrid(service2Info, service2Result, 'S2', true)}

          <div className="border border-slate-200 rounded-lg p-5 bg-white">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Selected Seats & Berths Fare Calculator
              </h3>
              <span className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                {selectedObjects.length} Selected · Total INR {totalFare}
              </span>
            </div>

            {selectedObjects.length > 0 ? (
              <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-mono tabular-nums text-slate-700">
                  {selectedObjects
                    .map(s => `Svc ${s.serviceId}: #${s.label} (INR ${s.fareInr})`)
                    .join(' · ')}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyChecklist}
                    className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    {copiedSummary ? 'Copied' : 'Copy Selection'}
                  </button>
                  <button
                    type="button"
                    onClick={onClearSelection}
                    className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 mt-2">
                Click any open seat on Service 52769 or open sleeper berth on
                Service 52767 above to calculate combined fare.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
