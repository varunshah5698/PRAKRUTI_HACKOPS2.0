import { query } from './pool.js';
import type { AuthorityInput } from '../services/authority.js';

/**
 * Official public landing pages checked on 2026-11-06. Contacts are empty and
 * every entry is PARTIALLY_VERIFIED: no phone, email, boundary polygon, API key
 * or delivery guarantee is claimed.
 */
export const AUTHORITY_SEED_ENTRIES: AuthorityInput[] = [
  {
    code: 'imd',
    name: 'India Meteorological Department',
    abbreviation: 'IMD',
    level: 'NATIONAL',
    officialUrl: 'https://mausam.imd.gov.in/',
    coverageCountry: 'India',
    verificationStatus: 'PARTIALLY_VERIFIED',
    sourceUrl: 'https://mausam.imd.gov.in/',
    notes: 'Official public website verified. Weather API at https://api.imd.gov.in/ requires a key; not integrated.',
  },
  {
    code: 'ndma',
    name: 'National Disaster Management Authority',
    abbreviation: 'NDMA',
    level: 'NATIONAL',
    officialUrl: 'https://ndma.gov.in/',
    coverageCountry: 'India',
    verificationStatus: 'PARTIALLY_VERIFIED',
    sourceUrl: 'https://ndma.gov.in/',
    notes: 'Official public website verified. SACHET (https://sachet.ndma.gov.in/) is the public alert portal; no API integration is claimed.',
  },
  {
    code: 'cwc',
    name: 'Central Water Commission',
    abbreviation: 'CWC',
    level: 'NATIONAL',
    officialUrl: 'https://cwc.gov.in/',
    coverageCountry: 'India',
    verificationStatus: 'PARTIALLY_VERIFIED',
    sourceUrl: 'https://cwc.gov.in/',
    notes: 'Official public website verified. Flood forecast portal https://ffs.india-water.gov.in/ is not integrated.',
  },
  {
    code: 'cpcb',
    name: 'Central Pollution Control Board',
    abbreviation: 'CPCB',
    level: 'NATIONAL',
    officialUrl: 'https://cpcb.nic.in/',
    coverageCountry: 'India',
    verificationStatus: 'PARTIALLY_VERIFIED',
    sourceUrl: 'https://cpcb.nic.in/',
    notes: 'Official public website verified. No CPCB reporting API is integrated.',
  },
  {
    code: 'maharashtra-sdma',
    name: 'Maharashtra State Disaster Management Authority',
    abbreviation: 'Maharashtra SDMA',
    level: 'STATE',
    officialUrl: 'https://sdma.maharashtra.gov.in/en/',
    coverageCountry: 'India',
    coverageState: 'Maharashtra',
    verificationStatus: 'PARTIALLY_VERIFIED',
    sourceUrl: 'https://sdma.maharashtra.gov.in/en/',
    notes: 'Official public website verified. State jurisdiction is textual, not a surveyed boundary.',
  },
  {
    code: 'bmc-dm',
    name: 'Brihanmumbai Municipal Corporation Disaster Management',
    abbreviation: 'BMC DM',
    level: 'MUNICIPAL',
    officialUrl: 'https://dm.mcgm.gov.in/',
    coverageCountry: 'India',
    coverageState: 'Maharashtra',
    coverageDistrict: 'Mumbai',
    coverageCity: 'Mumbai',
    verificationStatus: 'PARTIALLY_VERIFIED',
    sourceUrl: 'https://dm.mcgm.gov.in/',
    notes: 'Official public website verified. Coverage is textual; no boundary polygon or direct feed is configured.',
  },
];

/**
 * Production bootstrap helper. Inserts missing reference entries and never
 * updates an existing row, so administrator-verified edits are preserved.
 */
export async function seedAuthorityDirectory(): Promise<number> {
  let inserted = 0;
  for (const entry of AUTHORITY_SEED_ENTRIES) {
    const row = await query<{ id: string }>(
      `INSERT INTO authority_directory
         (code, name, abbreviation, level, official_url, official_contacts, reporting_channels, data_feeds,
          coverage_country, coverage_state, coverage_district, coverage_city, verification_status, source_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (code) DO NOTHING
       RETURNING id`,
      [
        entry.code.toLowerCase(),
        entry.name,
        entry.abbreviation ?? null,
        entry.level,
        entry.officialUrl ?? null,
        JSON.stringify(entry.officialContacts ?? {}),
        JSON.stringify(entry.reportingChannels ?? []),
        JSON.stringify(entry.dataFeeds ?? []),
        entry.coverageCountry ?? 'India',
        entry.coverageState ?? null,
        entry.coverageDistrict ?? null,
        entry.coverageCity ?? null,
        entry.verificationStatus ?? 'PARTIALLY_VERIFIED',
        entry.sourceUrl ?? null,
        entry.notes ?? null,
      ],
    );
    if (row[0]) inserted += 1;
  }
  return inserted;
}
