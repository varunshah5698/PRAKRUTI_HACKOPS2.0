import { describe, expect, it } from 'vitest';
import { beachBand, bestWindow, burnMinutes, exposureEstimate, pm25Category, sunProgress, weatherLabel, weatherMood, type CityHour } from './city';

function hour(overrides: Partial<CityHour>): CityHour {
  return {
    time: '2026-11-03T12:00',
    temperatureC: 32,
    apparentTemperatureC: 35,
    relativeHumidity: 50,
    precipitationProbability: 10,
    precipitationMm: 0,
    weatherCode: 0,
    cloudCover: 10,
    windSpeedKmh: 8,
    windDirectionDeg: 270,
    windGustsKmh: 20,
    uvIndex: 5,
    isDay: true,
    pm25: 60,
    pm10: 80,
    no2: 20,
    so2: 10,
    co: 400,
    o3: 80,
    usAqi: 150,
    aqi: 120,
    aqiCategory: 'Moderate',
    dominantPollutant: 'pm25',
    ...overrides,
  };
}

describe('live city helpers', () => {
  it('maps PM2.5 concentrations to CPCB bands', () => {
    expect(pm25Category(20)).toBe('Good');
    expect(pm25Category(45)).toBe('Satisfactory');
    expect(pm25Category(75)).toBe('Moderate');
    expect(pm25Category(110)).toBe('Poor');
    expect(pm25Category(200)).toBe('Very Poor');
    expect(pm25Category(null)).toBe('INSUFFICIENT DATA');
  });

  it('maps WMO codes to readable labels and moods', () => {
    expect(weatherLabel(0)).toBe('Clear sky');
    expect(weatherLabel(63)).toBe('Rain');
    expect(weatherLabel(null)).toBe('Weather unavailable');
    expect(weatherMood(0)).toBe('clear');
    expect(weatherMood(65)).toBe('rain');
    expect(weatherMood(95)).toBe('storm');
  });

  it('positions the sun between sunrise and sunset', () => {
    expect(sunProgress('2026-11-03T12:00', '2026-11-03T06:00', '2026-11-03T18:00')).toBeCloseTo(0.5);
    expect(sunProgress('2026-11-03T05:00', '2026-11-03T06:00', '2026-11-03T18:00')).toBe(0);
    expect(sunProgress('2026-11-03T20:00', '2026-11-03T06:00', '2026-11-03T18:00')).toBe(1);
  });

  it('estimates burn time without turning it into medical advice', () => {
    expect(burnMinutes(10, 2)).toBe(30);
    expect(burnMinutes(0, 2)).toBeNull();
  });

  it('bands beach conditions from model wave height', () => {
    expect(beachBand(0.4, 12).label).toBe('Calm');
    expect(beachBand(1.2, 15).label).toBe('Choppy');
    expect(beachBand(2.4, 15).label).toBe('Rough');
    expect(beachBand(null, 15).label).toBe('No data');
  });

  it('picks the cleaner 2-hour window instead of the first hour', () => {
    const hours = [
      hour({ time: '2026-11-03T10:00', aqi: 200, precipitationProbability: 0 }),
      hour({ time: '2026-11-03T11:00', aqi: 210, precipitationProbability: 0 }),
      hour({ time: '2026-11-03T18:00', aqi: 60, precipitationProbability: 5 }),
      hour({ time: '2026-11-03T19:00', aqi: 62, precipitationProbability: 5 }),
    ];
    expect(bestWindow(hours)?.start).toBe('2026-11-03T18:00');
  });

  it('scales inhaled dose with activity, mask and duration', () => {
    const walk = exposureEstimate(60, 'walk', 60, 'none', false);
    const run = exposureEstimate(60, 'run', 60, 'none', false);
    const masked = exposureEstimate(60, 'walk', 60, 'n95', false);
    expect(walk?.inhaledMicrograms).toBe(90);
    expect(run?.inhaledMicrograms).toBe(240);
    expect(masked?.inhaledMicrograms).toBeLessThan(walk?.inhaledMicrograms ?? 0);
    expect(exposureEstimate(null, 'walk', 60, 'none', false)).toBeNull();
  });
});
