import { Activity, Radio, Timer } from 'lucide-react';
import { Badge, DataLabel } from './ui';
import { ageSeconds, interpolate, useNow, type LiveReading, type LiveStatus } from '../lib/liveFeed';
import { number } from '../lib/format';

interface SeriesPoint {
  observedAt: string;
  value: number;
}

/**
 * Live readout for one station. Values are the newest stored readings; the
 * per-second clock is the age of those readings plus an estimate between the
 * two most recent ones, never a value beyond them.
 */
export function LivePanel({
  reading,
  pollutant,
  series,
  transport,
  status,
}: {
  reading?: LiveReading;
  pollutant: string;
  series: SeriesPoint[];
  transport: 'stream' | 'poll' | 'idle';
  status: LiveStatus | null;
}) {
  const now = useNow(1000);
  const value = reading?.values[pollutant];
  const observedAge = ageSeconds(value?.observedAt ?? null, now);
  const fetchedAge = ageSeconds(value?.retrievedAt ?? null, now);
  const estimate = interpolate(series, now);
  const isLive = observedAge !== null && observedAge <= (status?.simulationIntervalSeconds ?? 60) * 3;

  return (
    <div className="rounded-xl border border-[#dfe6db] bg-[#f5f8f2] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <DataLabel>Live readings</DataLabel>
        <Badge tone={isLive ? 'green' : 'amber'} dot>
          {isLive ? 'LIVE' : 'WAITING FOR SOURCE'}
        </Badge>
        <Badge tone={transport === 'stream' ? 'green' : 'neutral'}>
          {transport === 'stream' ? (
            <>
              <Radio className="mr-1 inline h-3 w-3" />
              streaming
            </>
          ) : (
            <>
              <Timer className="mr-1 inline h-3 w-3" />
              polling
            </>
          )}
        </Badge>
        <span className="ml-auto text-[9px] text-[#74847a]">
          {fetchedAge !== null ? `fetched ${fetchedAge}s ago` : 'not fetched yet'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div>
          <p className="display text-3xl font-bold text-[#142016]">
            {value ? number(value.value) : '—'}
            <span className="ml-1 text-[11px] font-normal text-[#6f7f74]">{value?.unit ?? ''}</span>
          </p>
          <p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[#74847a]">{pollutant.toUpperCase()}</p>
        </div>
        <div className="text-[11px] text-[#5a6a5f]">
          <p>
            <Activity className="mr-1 inline h-3 w-3 text-[#3f7d2a]" />
            {observedAge === null ? 'no reading yet' : `reading is ${observedAge}s old`}
          </p>
          {estimate && value ? (
            <p className="mt-1 text-[10px] text-[#74847a]">
              estimate {number(estimate.value)} {value.unit} · between the last two readings, {estimate.capped ? 'held at the latest' : 'in between'}
            </p>
          ) : null}
        </div>
      </div>

      {reading?.weather ? (
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-[#e7ece3] pt-3 text-[11px] text-[#5a6a5f] sm:grid-cols-4">
          <p>Temp <span className="text-[#1b2a1f]">{number(reading.weather.temperatureC)}°C</span></p>
          <p>RH <span className="text-[#1b2a1f]">{number(reading.weather.relativeHumidity, 0)}%</span></p>
          <p>Wind <span className="text-[#1b2a1f]">{number(reading.weather.windSpeedKmh)} km/h</span></p>
          <p>Rain <span className="text-[#1b2a1f]">{number(reading.weather.precipitationMm, 1)} mm</span></p>
          <p className="col-span-2 text-[9px] text-[#74847a] sm:col-span-4">
            weather observed {ageSeconds(reading.weather.observedAt, now) ?? 0}s ago · upstream model updates every{' '}
            {status?.upstreamWeatherIntervalSeconds ?? 900}s
          </p>
        </div>
      ) : null}

      <p className="mt-3 text-[9px] leading-relaxed text-[#74847a]">
        Polling runs every {status?.weatherIntervalSeconds ?? 60}s. A new value appears only when the provider
        publishes one, so the number can hold steady between updates.
        {reading?.isSimulated ? ' This station is synthetic demo data.' : ''}
      </p>
    </div>
  );
}
