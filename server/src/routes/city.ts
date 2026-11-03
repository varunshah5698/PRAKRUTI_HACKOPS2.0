import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { badRequest } from '../middleware/errors.js';
import {
  comparePoints,
  getArchiveDay,
  getCityOverview,
  getFlood,
  getMarine,
  getNearbyNature,
  getPlanetEvents,
  getWalkRoute,
  searchPlaces,
} from '../services/city.js';

export const cityRouter = Router();
cityRouter.use(requireAuth);

const pointSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

function parsePoints(value: string) {
  return value
    .split(';')
    .map((pair) => pair.split(',').map(Number))
    .filter((pair) => pair.length === 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
    .map(([lat, lng]) => ({ lat, lng }));
}

cityRouter.get('/overview', async (req, res, next) => {
  try {
    const point = pointSchema.parse(req.query);
    res.json(await getCityOverview(point.lat, point.lng));
  } catch (error) {
    next(error);
  }
});

cityRouter.get('/places', async (req, res, next) => {
  try {
    const query = z.string().trim().min(2).max(80).parse(req.query.q);
    res.json(await searchPlaces(query));
  } catch (error) {
    next(error);
  }
});

cityRouter.get('/compare', async (req, res, next) => {
  try {
    const raw = z.string().min(7).max(300).parse(req.query.points);
    const points = parsePoints(raw);
    if (points.length === 0) throw badRequest('Provide points as lat,lng;lat,lng.');
    res.json({ rows: await comparePoints(points) });
  } catch (error) {
    next(error);
  }
});

cityRouter.get('/marine', async (req, res, next) => {
  try {
    const point = pointSchema.parse(req.query);
    res.json(await getMarine(point.lat, point.lng));
  } catch (error) {
    next(error);
  }
});

cityRouter.get('/flood', async (req, res, next) => {
  try {
    const point = pointSchema.parse(req.query);
    res.json(await getFlood(point.lat, point.lng));
  } catch (error) {
    next(error);
  }
});

cityRouter.get('/nearby', async (req, res, next) => {
  try {
    const point = pointSchema.parse(req.query);
    res.json(await getNearbyNature(point.lat, point.lng));
  } catch (error) {
    next(error);
  }
});

cityRouter.get('/events', async (req, res, next) => {
  try {
    const point = pointSchema.parse(req.query);
    res.json(await getPlanetEvents(point.lat, point.lng));
  } catch (error) {
    next(error);
  }
});

cityRouter.get('/archive', async (req, res, next) => {
  try {
    const point = pointSchema.parse(req.query);
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);
    res.json(await getArchiveDay(point.lat, point.lng, date));
  } catch (error) {
    next(error);
  }
});

cityRouter.get('/route', async (req, res, next) => {
  try {
    const fromLat = z.coerce.number().min(-90).max(90).parse(req.query.fromLat);
    const fromLng = z.coerce.number().min(-180).max(180).parse(req.query.fromLng);
    const toLat = z.coerce.number().min(-90).max(90).parse(req.query.toLat);
    const toLng = z.coerce.number().min(-180).max(180).parse(req.query.toLng);
    res.json(await getWalkRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }));
  } catch (error) {
    next(error);
  }
});
