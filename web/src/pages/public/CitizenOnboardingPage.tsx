import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, LocateFixed, MapPin, Search } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { Button, Card, Input, Label, PublicBadge } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../store/auth';

interface Place {
  id: string;
  name: string;
  label: string;
  latitude: number;
  longitude: number;
}

interface DashboardPayload {
  profile: {
    name: string;
    email: string;
    onboardingCompleted: boolean;
    weatherNotifications: boolean;
    latitude: number | null;
    longitude: number | null;
    locationLabel: string | null;
  };
}

export function CitizenOnboardingPage() {
  const navigate = useNavigate();
  const loadMe = useAuth((state) => state.loadMe);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [name, setName] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [weatherNotifications, setWeatherNotifications] = useState(true);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<DashboardPayload>('/citizen/dashboard')
      .then((data) => {
        if (!active) return;
        setName(data.profile.name);
        setLocationLabel(data.profile.locationLabel ?? '');
        setLatitude(data.profile.latitude === null ? '' : String(data.profile.latitude));
        setLongitude(data.profile.longitude === null ? '' : String(data.profile.longitude));
        setWeatherNotifications(data.profile.weatherNotifications);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load your citizen profile.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setPlaces([]);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get<{ results: Place[] }>(`/citizen/places?q=${encodeURIComponent(query.trim())}`)
        .then((data) => {
          if (active) setPlaces(data.results);
        })
        .catch(() => {
          if (active) setPlaces([]);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const useBrowserLocation = () => {
    if (!navigator.geolocation) {
      setError('This browser does not support geolocation. Search for a city instead.');
      return;
    }
    setSearching(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude.toFixed(5));
        const lng = Number(position.coords.longitude.toFixed(5));
        setLatitude(String(lat));
        setLongitude(String(lng));
        setLocationLabel(`Current location (${lat}, ${lng})`);
        setSearching(false);
      },
      () => {
        setError('Location permission was denied. Search for your city or enter coordinates manually.');
        setSearching(false);
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 },
    );
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!locationLabel.trim()) {
      setError('Choose a city or use your current location.');
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError('Enter valid latitude and longitude.');
      return;
    }
    if (weatherNotifications && !consent) {
      setError('Tick the consent box to receive weather email alerts, or turn alerts off.');
      return;
    }
    setSaving(true);
    try {
      await api.put('/citizen/profile', {
        name: name.trim() || undefined,
        locationLabel: locationLabel.trim(),
        latitude: lat,
        longitude: lng,
        weatherNotifications,
        consent,
      });
      await loadMe();
      setStatus('Saved. Your location is now linked to the weather monitor.');
      navigate('/citizen/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#eef3ec] text-sm text-ink/50">Loading your profile…</div>;
  }

  return (
    <div className="min-h-screen bg-[#eef3ec] px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between">
          <Logo />
          <Link to="/citizen/dashboard" className="text-[11px] font-semibold text-ink/45 underline underline-offset-2">
            Skip for now
          </Link>
        </div>

        <Card className="mt-6 overflow-hidden">
          <div className="border-b border-dashed border-[#dbe5d6] px-6 py-5">
            <PublicBadge tone="soft">Weather monitoring setup</PublicBadge>
            <h1 className="display mt-3 text-3xl font-bold leading-tight">Where should we watch the weather for you?</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/50">
              Your saved coordinates drive a background monitor that runs on the server, even when this browser is
              closed. Alerts go only to your verified Google email.
            </p>
          </div>

          <form onSubmit={save} className="space-y-6 px-6 py-6">
            {error ? (
              <p className="rounded-xl border border-[#e8b7b1] bg-[#fff4f2] px-3.5 py-2.5 text-[12px] text-[#8a2f2a]">{error}</p>
            ) : null}
            {status ? (
              <p className="rounded-xl border border-[#bfe0ae] bg-[#f2faec] px-3.5 py-2.5 text-[12px] text-[#356b2a]">{status}</p>
            ) : null}

            <div>
              <Label htmlFor="citizen-name">Your name</Label>
              <Input id="citizen-name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5" maxLength={120} />
            </div>

            <div>
              <Label htmlFor="city-search">City or area</Label>
              <div className="relative mt-1.5">
                <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-ink/30" />
                <Input
                  id="city-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search Mumbai, Pune, Delhi…"
                  className="pl-10"
                  autoComplete="off"
                />
              </div>
              {places.length > 0 ? (
                <ul className="mt-2 overflow-hidden rounded-xl border border-[#d9e3d5] bg-white">
                  {places.map((place) => (
                    <li key={place.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setLocationLabel(`${place.name}${place.label ? `, ${place.label}` : ''}`);
                          setLatitude(String(place.latitude));
                          setLongitude(String(place.longitude));
                          setPlaces([]);
                          setQuery('');
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm text-ink/70 transition-colors hover:bg-[#f3f8ef]"
                      >
                        <span>
                          <span className="font-semibold text-ink">{place.name}</span>
                          <span className="ml-2 text-[11px] text-ink/40">{place.label}</span>
                        </span>
                        <MapPin className="h-4 w-4 shrink-0 text-ink/25" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {searching ? <p className="mt-2 text-[11px] text-ink/35">Searching…</p> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={useBrowserLocation}>
                <LocateFixed className="h-4 w-4" /> Use my current location
              </Button>
              {locationLabel ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#edf5e7] px-3 py-1 text-[11px] font-semibold text-[#356b2a]">
                  <Check className="h-3.5 w-3.5" /> {locationLabel}
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="latitude">Latitude</Label>
                <Input
                  id="latitude"
                  inputMode="decimal"
                  value={latitude}
                  onChange={(event) => setLatitude(event.target.value)}
                  placeholder="19.0760"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="longitude">Longitude</Label>
                <Input
                  id="longitude"
                  inputMode="decimal"
                  value={longitude}
                  onChange={(event) => setLongitude(event.target.value)}
                  placeholder="72.8777"
                  className="mt-1.5"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-[#dbe5d6] bg-white/60 p-4">
              <label className="flex items-start gap-3 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={weatherNotifications}
                  onChange={(event) => setWeatherNotifications(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#4e9b3f]"
                />
                <span>
                  <span className="font-semibold text-ink">Email me weather alerts for this location</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink/40">
                    The background worker checks every few minutes and emails you when a HIGH or CRITICAL condition is
                    detected. Duplicate alerts for the same event are suppressed.
                  </span>
                </span>
              </label>
              <label className="mt-3 flex items-start gap-3 border-t border-dashed border-[#e3ebe0] pt-3 text-[12px] text-ink/60">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#4e9b3f]"
                />
                <span>
                  I consent to receive automated weather alert emails at my verified address. I can disable this at any
                  time from the citizen dashboard.
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-sm text-[10px] leading-relaxed text-ink/35">
                Weather data: Open-Meteo. Alerts are threshold-based and labelled with their source; they are not
                official IMD warnings.
              </p>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save and open dashboard'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
