/**
 * CPCB sub-index breakpoints applied to an indicative PM2.5 value.
 * This is a screening aid, not a monitored CPCB AQI record.
 */
export function aqiFromPm25(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const points = [
    { concentration: 0, aqi: 0 },
    { concentration: 30, aqi: 50 },
    { concentration: 60, aqi: 100 },
    { concentration: 90, aqi: 200 },
    { concentration: 120, aqi: 300 },
    { concentration: 250, aqi: 400 },
    { concentration: 500, aqi: 500 },
  ];
  for (let i = 1; i < points.length; i += 1) {
    const low = points[i - 1];
    const high = points[i];
    if (value <= high.concentration) {
      return Math.round(((high.aqi - low.aqi) / (high.concentration - low.concentration)) * (value - low.concentration) + low.aqi);
    }
  }
  return 500;
}

export function aqiCategory(value: number): string {
  if (value <= 50) return 'Good';
  if (value <= 100) return 'Satisfactory';
  if (value <= 200) return 'Moderate';
  if (value <= 300) return 'Poor';
  if (value <= 400) return 'Very Poor';
  return 'Severe';
}
