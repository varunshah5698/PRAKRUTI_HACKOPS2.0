import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BrainCircuit,
  CloudSun,
  Command,
  Database,
  FileWarning,
  LayoutDashboard,
  Map,
  MapPin,
  Newspaper,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useLiveFeed } from '../lib/liveFeed';
import { useAuth } from '../store/auth';
import { api } from '../lib/api';
import type { CityPlace } from '../lib/city';

interface CommandItem {
  id: string;
  label: string;
  detail: string;
  group: 'Pages' | 'Stations' | 'Localities' | 'Actions';
  icon: typeof Map;
  run: () => void;
}

const AUTHORITY_ROLES = ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { user, isAuthority } = useAuth();
  const { readings } = useLiveFeed();
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<CityPlace[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setPlaces([]);
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setPlaces([]);
      return;
    }
    setPlacesLoading(true);
    const timer = window.setTimeout(() => {
      api.get<{ results: CityPlace[] }>(`/city/places?q=${encodeURIComponent(query.trim())}`)
        .then((result) => setPlaces(result.results))
        .catch(() => setPlaces([]))
        .finally(() => setPlacesLoading(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  const items = useMemo<CommandItem[]>(() => {
    const pages: Array<{ label: string; to: string; detail: string; icon: typeof Map; roles?: string[]; keywords?: string }> = [
      { label: 'Command centre', to: '/dashboard', detail: 'The daily overview', icon: LayoutDashboard, keywords: 'home dashboard' },
      { label: 'Live city pulse', to: '/city', detail: 'Weather, CAMS air, coast and open data', icon: CloudSun, keywords: 'weather air uv coast marine flood' },
      { label: 'Environmental newsroom', to: '/news', detail: 'Live headlines from publisher RSS', icon: Newspaper, keywords: 'news media headlines rss environment' },
      { label: 'Mumbai map', to: '/map', detail: 'Stations, reports and incidents', icon: Map, keywords: 'stations geography' },
      { label: 'Atmosphere lab', to: '/atmosphere', detail: '3D air intelligence', icon: CloudSun, roles: AUTHORITY_ROLES, keywords: 'air 3d' },
      { label: 'Predictive intelligence', to: '/intelligence/predictions', detail: 'Forecasts and risk', icon: BrainCircuit, roles: AUTHORITY_ROLES, keywords: 'forecast prediction' },
      { label: 'AI analyst', to: '/ai-analyst', detail: 'Ask the evidence assistant', icon: Sparkles, roles: AUTHORITY_ROLES, keywords: 'ai explain' },
      { label: 'Authority desk', to: '/authority', detail: 'Assigned events, acknowledgements and actions', icon: ShieldCheck, roles: ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN'], keywords: 'authority acknowledge verify respond event' },
      { label: 'Authority administration', to: '/authority/admin', detail: 'Directory, memberships, routing and dispatch', icon: ShieldCheck, roles: ['SYSTEM_ADMIN'], keywords: 'authority directory membership assign notify email' },
      { label: 'Alerts', to: '/alerts', detail: 'Open environmental alerts', icon: ShieldAlert, keywords: 'risk warning' },
      { label: 'Reports', to: isAuthority() ? '/reports' : '/my-reports', detail: isAuthority() ? 'Citizen evidence queue' : 'Your submitted reports', icon: FileWarning, keywords: 'citizen report complaint' },
      { label: 'Data sources', to: '/data-sources', detail: 'Connectors, licences and health', icon: Database, keywords: 'api open data attribution' },
      { label: 'Settings', to: '/settings', detail: 'Account and preferences', icon: Settings, keywords: 'profile preferences' },
    ];

    const pageItems: CommandItem[] = pages
      .filter((page) => !page.roles || (user && page.roles.includes(user.role)))
      .map((page) => ({
        id: `page-${page.to}`,
        label: page.label,
        detail: page.detail,
        group: 'Pages',
        icon: page.icon,
        run: () => go(page.to),
      }));

    const stationItems: CommandItem[] = Object.values(readings)
      .slice(0, 60)
      .map((station) => ({
        id: `station-${station.stationId}`,
        label: station.name,
        detail: `${station.aqi?.aqi !== null && station.aqi?.aqi !== undefined ? `AQI ${station.aqi.aqi} · ` : ''}${station.localityName ?? 'Mumbai'}${station.isSimulated ? ' · demo' : ''}`,
        group: 'Stations' as const,
        icon: MapPin,
        run: () => go(`/map?station=${station.stationId}`),
      }));

    const placeItems: CommandItem[] = places.map((place) => ({
      id: `place-${place.id}`,
      label: place.name,
      detail: `${place.label} · ${place.provider}`,
      group: 'Localities' as const,
      icon: MapPin,
      run: () => go(`/city?lat=${place.lat}&lng=${place.lng}&name=${encodeURIComponent(place.name)}`),
    }));

    const actionItems: CommandItem[] = [
      {
        id: 'action-report',
        label: 'Report an environmental concern',
        detail: 'Open the public report form',
        group: 'Actions',
        icon: FileWarning,
        run: () => go('/report'),
      },
      {
        id: 'action-location',
        label: 'My location on the live city',
        detail: 'Ask the browser for your current position',
        group: 'Actions',
        icon: MapPin,
        run: () => {
          if (!('geolocation' in navigator)) return;
          navigator.geolocation.getCurrentPosition(
            (position) => go(`/city?lat=${position.coords.latitude}&lng=${position.coords.longitude}&name=My location`),
            () => go('/city'),
          );
        },
      },
    ];

    return [...pageItems, ...stationItems, ...placeItems, ...actionItems];
  }, [user, readings, places, isAuthority]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.filter((item) => item.group !== 'Stations').slice(0, 12);
    return items
      .filter((item) => `${item.label} ${item.detail} ${item.group}`.toLowerCase().includes(needle))
      .slice(0, 18);
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((value) => Math.min(filtered.length - 1, value + 1));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((value) => Math.max(0, value - 1));
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        filtered[active]?.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, active, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-[#15251a]/30 px-3 pt-[10vh] backdrop-blur-sm" onClick={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search Prakriti"
        className="w-full max-w-xl overflow-hidden rounded-[24px] border border-white/85 bg-[#fbfdf9]/97 shadow-2xl backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-dashed border-[#dbe5d6] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-[#5f7065]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, stations, localities…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[#142016] placeholder:text-[#8a9b8e] focus:outline-none"
            aria-label="Search pages, stations and localities"
          />
          {placesLoading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#4e9b3f] border-r-transparent" /> : null}
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Close search" className="flex h-7 w-7 items-center justify-center rounded-full text-[#66766b] hover:bg-[#edf2e9]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="scrollbar-thin max-h-[58vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-[11px] text-[#66766b]">No page, station or locality matches “{query}”.</p>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={item.run}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active === index ? 'bg-[#e9f7da]' : 'hover:bg-white/70'}`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${active === index ? 'bg-[#4e9b3f] text-white' : 'bg-[#edf2e9] text-[#4d7d40]'}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[11.5px] font-semibold text-[#223328]">{item.label}</span>
                      <span className="shrink-0 rounded-full border border-[#e2e9de] bg-white/60 px-1.5 py-0.5 text-[7.5px] font-semibold uppercase tracking-[0.1em] text-[#7a8b7e]">{item.group}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-[#66766b]">{item.detail}</span>
                  </span>
                  {active === index ? <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#4e9b3f]" /> : null}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-dashed border-[#dbe5d6] px-4 py-2 text-[8.5px] text-[#7a8b7e]">
          <span className="inline-flex items-center gap-1"><Command className="h-3 w-3" /> Search anything</span>
          <span>↑↓ navigate · ↵ open · esc close</span>
        </div>
      </div>
    </div>
  );
}
