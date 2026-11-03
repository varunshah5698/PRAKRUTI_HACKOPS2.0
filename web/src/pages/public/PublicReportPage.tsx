import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, CheckCircle2, Crosshair, MapPin, ShieldAlert, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { PublicNav } from '../../components/PublicNav';
import { Footer } from '../../components/Footer';
import { MumbaiMap, type MapStation } from '../../components/MumbaiMap';
import { Button, PublicBadge, PublicInput, PublicLabel, PublicSelect, PublicTextarea, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { CATEGORY_LABELS } from '../../lib/format';

const INCIDENT_TYPES: Record<string, Array<{ value: string; label: string }>> = {
  air: [
    { value: 'INDUSTRIAL_SMOKE', label: 'Industrial smoke' },
    { value: 'VISIBLE_EMISSIONS', label: 'Visible emissions' },
    { value: 'OPEN_BURNING', label: 'Open burning' },
    { value: 'EXCESSIVE_DUST', label: 'Excessive dust' },
    { value: 'UNUSUAL_POLLUTION', label: 'Unusual pollution conditions' },
  ],
  water: [
    { value: 'SUSPECTED_DISCHARGE', label: 'Suspicious wastewater discharge' },
    { value: 'WATER_CONTAMINATION', label: 'River / water-body contamination concern' },
    { value: 'WATER_DISCOLOURATION', label: 'Unusual colour or odour' },
    { value: 'CHEMICAL_DISCHARGE', label: 'Suspected chemical discharge' },
  ],
  waste: [
    { value: 'ILLEGAL_DUMPING', label: 'Illegal garbage dumping' },
    { value: 'WASTE_ACCUMULATION', label: 'Waste accumulation' },
    { value: 'OPEN_WASTE_BURNING', label: 'Open waste burning' },
    { value: 'REPEAT_HOTSPOT', label: 'Repeated waste hotspot' },
  ],
  industrial: [
    { value: 'VISIBLE_STACK_SMOKE', label: 'Visible industrial smoke' },
    { value: 'SUSPECTED_EMISSION', label: 'Suspected emission incident' },
    { value: 'SUSPECTED_EFFLUENT', label: 'Suspected effluent discharge' },
    { value: 'CHEMICAL_ODOUR', label: 'Chemical odour' },
    { value: 'OTHER_INDUSTRIAL', label: 'Other industrial concern' },
  ],
};

interface Locality {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

function nearestLocality(localities: Locality[], lat: number, lng: number): Locality | null {
  if (!localities.length) return null;
  return localities.reduce((best, current) => {
    const d = (current.lat - lat) ** 2 + (current.lng - lng) ** 2;
    const bd = (best.lat - lat) ** 2 + (best.lng - lng) ** 2;
    return d < bd ? current : best;
  });
}

export function PublicReportPage() {
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [category, setCategory] = useState('air');
  const [incidentType, setIncidentType] = useState('OPEN_BURNING');
  const [description, setDescription] = useState('');
  const [localityId, setLocalityId] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [occurredAt, setOccurredAt] = useState(() => {
    const local = new Date(Date.now() - 30 * 60_000);
    return new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    report: { publicRef: string; status: string; aiVisionStatus: string };
    aiVision?: { message?: string };
    enrichment?: { stations?: unknown[]; nearbyReports?: unknown[] };
  } | null>(null);

  useEffect(() => {
    api.get<{ localities: Locality[] }>('/public/localities').then((result) => {
      setLocalities(result.localities);
      if (result.localities.length) {
        const bandra = result.localities.find((l) => l.name === 'Bandra') ?? result.localities[0];
        setLocalityId(bandra.id);
        setLat(bandra.lat);
        setLng(bandra.lng);
      }
    });
  }, []);

  useEffect(() => {
    const first = INCIDENT_TYPES[category]?.[0]?.value;
    if (first) setIncidentType(first);
  }, [category]);

  const marker: MapStation[] = useMemo(
    () =>
      lat !== null && lng !== null
        ? [
            {
              id: 'selected-report-location',
              name: 'Selected report location',
              locality: localities.find((l) => l.id === localityId)?.name,
              lat,
              lng,
              color: '#b5e36b',
              valueLabel: 'Report pin',
              markerKind: 'OBSERVED',
              isSimulated: false,
            },
          ]
        : [],
    [lat, lng, localityId, localities],
  );

  const handleMapClick = ({ lat: newLat, lng: newLng }: { lat: number; lng: number }) => {
    setLat(Number(newLat.toFixed(6)));
    setLng(Number(newLng.toFixed(6)));
    const nearest = nearestLocality(localities, newLat, newLng);
    if (nearest) setLocalityId(nearest.id);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!consent) {
      setError('Consent is required before submitting a report.');
      return;
    }
    if (lat === null || lng === null) {
      setError('Select a location on the Mumbai map.');
      return;
    }
    if (!localityId) {
      setError('Select a Mumbai locality.');
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('category', category);
      form.append('incidentType', incidentType);
      form.append('description', description);
      form.append('lat', String(lat));
      form.append('lng', String(lng));
      form.append('localityId', localityId);
      form.append('occurredAt', new Date(occurredAt).toISOString());
      form.append('contactName', contactName);
      form.append('contactEmail', contactEmail);
      form.append('contactPhone', contactPhone);
      form.append('consent', String(consent));
      if (file) form.append('photo', file);
      const result = await api.upload<{
        report: { publicRef: string; status: string; aiVisionStatus: string };
        aiVision?: { message?: string };
        enrichment?: { stations?: unknown[]; nearbyReports?: unknown[] };
      }>('/reports', form);
      setSuccess(result);
      toast.success('Report submitted.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Report submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-paper">
        <PublicNav />
        <main className="mx-auto max-w-[820px] px-5 py-16 lg:px-10">
          <div className="rounded-[28px] border border-ink/12 bg-white p-8 shadow-card">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <PublicBadge tone="soft" className="mt-5">Report received</PublicBadge>
            <h1 className="display mt-3 text-[38px] font-bold leading-[1]">Thank you. The evidence is now trackable.</h1>
            <p className="mt-4 text-sm leading-relaxed text-ink/60">
              Reference <strong className="text-ink">{success.report.publicRef}</strong>. The report is
              <strong className="text-ink"> {success.report.status.replace(/_/g, ' ').toLowerCase()}</strong> and its verification
              state is UNVERIFIED. An authorised reviewer must verify it. A report is not an official violation.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-ink/10 bg-[#f5f6f0] p-4">
                <p className="text-[9px] uppercase tracking-[0.1em] text-ink/40">AI image assessment</p>
                <p className="mt-1 text-sm font-semibold">{success.report.aiVisionStatus.replace(/_/g, ' ')}</p>
              </div>
              <div className="rounded-xl border border-ink/10 bg-[#f5f6f0] p-4">
                <p className="text-[9px] uppercase tracking-[0.1em] text-ink/40">Nearby stations</p>
                <p className="mt-1 text-sm font-semibold">{success.enrichment?.stations?.length ?? 0}</p>
              </div>
              <div className="rounded-xl border border-ink/10 bg-[#f5f6f0] p-4">
                <p className="text-[9px] uppercase tracking-[0.1em] text-ink/40">Nearby reports</p>
                <p className="mt-1 text-sm font-semibold">{success.enrichment?.nearbyReports?.length ?? 0}</p>
              </div>
            </div>
            {success.aiVision?.message ? (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
                {success.aiVision.message}
              </p>
            ) : null}
            <div className="mt-7 flex flex-wrap gap-2">
              <Link to="/login"><Button variant="dark">Sign in to track this report</Button></Link>
              <Link to="/report"><Button variant="outline">Submit another report</Button></Link>
              <Link to="/"><Button variant="ghost">Back to home</Button></Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <PublicNav />
      <main className="mx-auto max-w-[1200px] px-5 py-10 lg:px-10 lg:py-14">
        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <div>
            <PublicBadge tone="lime">Citizen reporting</PublicBadge>
            <h1 className="display mt-4 text-[42px] font-bold leading-[0.98] sm:text-[56px]">
              Report what you see. Keep the uncertainty attached.
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-ink/55">
              Submit a Mumbai environmental concern with a photograph and a precise location. The platform will enrich it with
              nearby stations, weather and existing reports. It will not turn your photograph into a chemical measurement.
            </p>
            <div className="mt-6 space-y-2.5 text-[12px] text-ink/55">
              {[
                'Locations must fall inside the Greater Mumbai boundary.',
                'Photos are private by default and served only through authorised access.',
                'AI vision is NOT CONFIGURED in this deployment. The River text model is not assumed to inspect images.',
                'A report is not an official violation. Verification requires an authorised reviewer.',
              ].map((line) => (
                <p key={line} className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {line}</p>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-ink/12 bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/40">Location pin</p>
              <div className="mt-2 overflow-hidden rounded-xl border border-ink/10">
                <MumbaiMap
                  stations={marker}
                  className="landing-map h-[300px] w-full"
                  compact
                  theme="light"
                  initialZoom={11.6}
                  initialPitch={20}
                  onMapClick={handleMapClick}
                  overlayLabel="Report pin"
                  interactive
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink/50">
                <span className="inline-flex items-center gap-1"><Crosshair className="h-3 w-3" /> Click the map to move the pin</span>
                <span>{lat !== null ? `${lat.toFixed(5)}, ${lng?.toFixed(5)}` : 'No location selected'}</span>
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="rounded-[28px] border border-ink/12 bg-white p-5 shadow-card sm:p-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <PublicLabel htmlFor="category">Environmental category</PublicLabel>
                <PublicSelect id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </PublicSelect>
              </div>
              <div>
                <PublicLabel htmlFor="incidentType">Incident type</PublicLabel>
                <PublicSelect id="incidentType" value={incidentType} onChange={(e) => setIncidentType(e.target.value)}>
                  {(INCIDENT_TYPES[category] ?? []).map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </PublicSelect>
              </div>
              <div>
                <PublicLabel htmlFor="locality">Mumbai locality</PublicLabel>
                <PublicSelect id="locality" value={localityId} onChange={(e) => setLocalityId(e.target.value)} required>
                  <option value="">Select a locality</option>
                  {localities.map((locality) => (
                    <option key={locality.id} value={locality.id}>{locality.name}</option>
                  ))}
                </PublicSelect>
              </div>
              <div>
                <PublicLabel htmlFor="occurredAt">Incident time</PublicLabel>
                <PublicInput id="occurredAt" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
              </div>
            </div>

            <div className="mt-4">
              <PublicLabel htmlFor="description">What did you observe?</PublicLabel>
              <PublicTextarea
                id="description"
                rows={5}
                minLength={15}
                maxLength={4000}
                placeholder="Describe visible evidence, duration, odour, colour, direction of smoke or discharge. Do not speculate about chemical composition or responsibility."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
              <p className="mt-1 text-[10px] text-ink/40">{description.length}/4000 · minimum 15 characters</p>
            </div>

            <div className="mt-4">
              <PublicLabel htmlFor="photo">Photograph evidence (optional)</PublicLabel>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-ink/20 bg-[#f6f7f1] px-4 py-3 text-xs text-ink/55 hover:border-ink/40">
                <UploadCloud className="h-4 w-4" />
                <span className="flex-1">{file ? file.name : 'JPEG, PNG or WebP · max 8 MB'}</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/35">Browse</span>
                <input
                  id="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <p className="mt-1 text-[10px] text-ink/40">
                <Camera className="mr-1 inline h-3 w-3" /> EXIF GPS is compared with the claimed location. Metadata is not trusted without validation.
              </p>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div>
                <PublicLabel htmlFor="contactName">Name (optional)</PublicLabel>
                <PublicInput id="contactName" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={120} />
              </div>
              <div>
                <PublicLabel htmlFor="contactEmail">Email (optional)</PublicLabel>
                <PublicInput id="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={200} />
              </div>
              <div>
                <PublicLabel htmlFor="contactPhone">Phone (optional)</PublicLabel>
                <PublicInput id="contactPhone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={40} />
              </div>
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-xl border border-ink/10 bg-[#f7f8f2] p-3 text-[11px] leading-relaxed text-ink/60">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#111310]" required />
              <span>
                I consent to this report being reviewed by authorised environmental staff. I understand that a report is not an
                official violation and that I should not include unnecessary personal information about other people.
              </span>
            </label>

            {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}

            <Button type="submit" variant="lime" size="lg" className="mt-5 w-full border border-ink/10" disabled={submitting}>
              {submitting ? <Spinner /> : <MapPin className="h-4 w-4" />}
              {submitting ? 'Submitting report…' : 'Submit environmental report'}
            </Button>
            <p className="mt-2 text-center text-[10px] text-ink/40">
              Rate limited. Evidence is private. No report is automatically verified.
            </p>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}
