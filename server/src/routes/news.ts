import { Router } from 'express';
import { getEnvironmentalNews } from '../services/news.js';

export const newsRouter = Router();

newsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getEnvironmentalNews());
  } catch (error) {
    next(error);
  }
});
