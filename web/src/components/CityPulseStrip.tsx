import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Cloud, CloudLightning, CloudRain, CloudSun, RefreshCw, Sun, Wind } from 'lucide-react';
import { Badge, Card } from './ui';
import { FreshnessPill } from './FreshnessPill';
import { api } from '../lib/api';
import { aqiColor, weatherLabel, weatherMood, type CityOverview } from '../lib/city';
import { number, windDirection } from '../lib/format';

/**
 * A compact live strip on the dashboard. It deliberately uses the same
 * open-data overview as the Live City page rather than inventing a second
 * weather contract.
 */
export function CityPulseStrip() {
  const [data, setData] = useState<CityOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get<CityOverview>('/city/overview?lat=19.076&lng=72.8777')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 5 * 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!data) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="flex items-center gap-2 text-[10px] text-[#66766b]">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#edf4e9] text-[#4d7d40]"><Sun className="h-3.5 w-3.5" /></span>
          <span>{loading ? 'Loading the live city layer…' : 'Live city layer is temporarily unavailable.'}</span>
        </div>
        <Link to="/city" className="inline-flex items-center gap-1 text-[9px] font-semibold text-[#3f7d2a]">Open live city <ArrowUpRight className="h-3 w-3" /></Link>
      </Card>
    );
  }

  const current = data.current;
  const aqi = data.air.aqi;
  const color = aqiColor(aqi.category);
  const mood = weatherMood(current.weatherCode);
  const WeatherIcon = mood === 'rain' ? CloudRain : mood === 'storm' ? CloudLightning : mood === 'partly' ? CloudSun : mood === 'cloud' || mood === 'fog' ? Cloud : Sun;
  const observedAt = current.time
    ? /[zZ]|[+-]\d{2}:?\d{2}$/.test(current.time)
      ? current.time
      : `${current.time}+05:30`
    : null;
  const freshness = !observedAt || Date.now() - Date.parse(observedAt) > 90 * 60_000 ? 'STALE' : 'LIVE';
  const provider = data.weatherProvider === 'met-no' ? 'MET Norway' : 'Open-Meteo';

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-3.5">
        <Link to="/city" className="flex items-center gap-2.5">
          <span className={`flex h-10 w-10 items-center justify-center rounded-full ${mood === 'rain' ? 'bg-[#e9f3f6] text-[#4f7f94]' : mood === 'clear' ? 'bg-[#fff5cc] text-[#c49a1c]' : 'bg-[#edf4e9] text-[#4d7d40]'}`}>
            <WeatherIcon className="h-5 w-5" />
          </span>
          <span>
            <span className="flex items-center gap-1.5">
              <span className="text-[12px] font-semibold text-[#142016]">Mumbai right now</span>
            </span>
            <span className="mt-0.5 block text-[9px] text-[#66766b]">
              {number(current.temperatureC, 0)}°C · {weatherLabel(current.weatherCode)}
            </span>
            <span className="mt-0.5 block">
              <FreshnessPill status={freshness} observedAt={observedAt} provider={provider} />
            </span>
          </span>
        </Link>

        <div className="ml-auto grid grid-cols-2 gap-2 sm:grid-cols-4">
          <span className="flex items-center gap-1.5 rounded-full border border-white/80 bg-white/50 px-2.5 py-1.5 text-[9px] text-[#5f7065]">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            AQI <strong className="text-[#223328]">{aqi.aqi ?? '—'}</strong>
            <span className="hidden text-[8px] text-[#7a8b7e] sm:inline">{aqi.category}</span>
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-white/80 bg-white/50 px-2.5 py-1.5 text-[9px] text-[#5f7065]">
            <Sun className="h-3 w-3 text-[#c49a1c]" /> UV <strong className="text-[#223328]">{number(current.uvIndex)}</strong>
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-white/80 bg-white/50 px-2.5 py-1.5 text-[9px] text-[#5f7065]">
            <Wind className="h-3 w-3 text-[#5f8f79]" /> <strong className="text-[#223328]">{number(current.windSpeedKmh)}</strong> km/h
            <span className="hidden text-[8px] text-[#7a8b7e] sm:inline">{windDirection(current.windDirectionDeg).split(' · ')[0]}</span>
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-white/80 bg-white/50 px-2.5 py-1.5 text-[9px] text-[#5f7065]">
            <CloudRain className="h-3 w-3 text-[#4f7f94]" /> <strong className="text-[#223328]">{number(current.precipitationMm, 1)}</strong> mm
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge tone="neutral" className="hidden lg:inline-flex">Open data</Badge>
          <button type="button" onClick={load} aria-label="Refresh live city layer" className="flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white/60 text-[#5f7065] hover:text-[#142016]">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link to="/city" className="inline-flex items-center gap-1 rounded-full border border-[#b3df7c] bg-[#e9fbd3] px-3 py-1.5 text-[9px] font-semibold text-[#2f5f20]">
            Live city <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
