import { closePool } from '../db/pool.js';
import { createAuthority, type AuthorityInput } from '../services/authority.js';

/**
 * Seeds only official public landing pages that were reachable when checked on
 * 2026-11-06. Contacts are intentionally empty and every entry is marked
 * PARTIALLY_VERIFIED: no phone number, email, API key, boundary polygon or
 * delivery channel has been independently confirmed.
 */
const AUTHORITIES: AuthorityInput[] = [
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

async function main() {
  for (const authority of AUTHORITIES) {
    const row = await createAuthority(authority);
    console.log(`Seeded ${row.code}: ${row.name}`);
  }
  console.log(`Authority directory seeded: ${AUTHORITIES.length} entries, contacts empty, all PARTIALLY_VERIFIED.`);
}

main()
  .catch((error) => {
    console.error('Authority seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
