import { describe, expect, it } from 'vitest';
import { parseDataGovInRecord } from './ingest.js';

// Fields as returned by the CPCB real-time AQI resource on data.gov.in.
const base = {
  station: 'Worli, Mumbai - MPCB',
  latitude: '18.9936162',
  longitude: '72.8128113',
  last_update: '03-11-2026 13:00:00',
};

describe('data.gov.in CPCB record parsing', () => {
  it('parses the current avg_value shape and IST timestamp', () => {
    const parsed = parseDataGovInRecord({ ...base, pollutant_id: 'PM2.5', avg_value: '92' });
    expect(parsed).toMatchObject({
      stationName: 'Worli, Mumbai - MPCB',
      pollutant: 'pm25',
      value: 92,
      unit: 'µg/m³',
    });
    expect(parsed?.observedAt.toISOString()).toBe('2026-11-03T07:30:00.000Z');
  });

  it('maps OZONE and infers the CPCB CO unit', () => {
    expect(parseDataGovInRecord({ ...base, pollutant_id: 'OZONE', avg_value: '19' })?.pollutant).toBe('o3');
    expect(parseDataGovInRecord({ ...base, pollutant_id: 'CO', avg_value: '2' })).toMatchObject({
      pollutant: 'co',
      value: 2,
      unit: 'mg/m³',
    });
  });

  it('skips missing readings and stations outside Greater Mumbai', () => {
    expect(parseDataGovInRecord({ ...base, pollutant_id: 'NO2', avg_value: 'NA' })).toBeNull();
    expect(
      parseDataGovInRecord({
        ...base,
        latitude: '28.6139',
        longitude: '77.2090',
        pollutant_id: 'PM2.5',
        avg_value: '92',
      }),
    ).toBeNull();
  });

  it('still reads the older pollutant_avg and pollutant_unit shape', () => {
    expect(
      parseDataGovInRecord({
        ...base,
        pollutant_id: 'PM10',
        pollutant_avg: '64',
        pollutant_unit: 'µg/m3',
      }),
    ).toMatchObject({ pollutant: 'pm10', value: 64, unit: 'µg/m³' });
  });
});
