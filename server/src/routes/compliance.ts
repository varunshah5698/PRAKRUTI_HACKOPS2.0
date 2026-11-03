import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { requireAuth, requireAuthority } from '../middleware/auth.js';
import { badRequest, notFound } from '../middleware/errors.js';
import { compareObservation } from '../services/compliance.js';

export const complianceRouter = Router();
complianceRouter.use(requireAuth, requireAuthority);

complianceRouter.get('/standards', async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : null;
    const q = typeof req.query.q === 'string' ? req.query.q : null;
    const rows = await query<Record<string, unknown>>(
      `SELECT st.id, st.category, st.parameter, st.parameter_code, st.operator, st.threshold_value::float8,
              st.threshold_max::float8, st.unit, st.averaging_period, st.applicability, st.section_ref, st.notes,
              d.id AS document_id, d.title AS document_title, d.short_title, d.authority, d.url,
              d.verification_status, d.published_at, d.effective_from
       FROM regulatory_standards st JOIN regulatory_documents d ON d.id=st.document_id
       WHERE ($1::text IS NULL OR st.category=$1)
         AND ($2::text IS NULL OR st.parameter ILIKE '%'||$2||'%' OR d.title ILIKE '%'||$2||'%')
       ORDER BY st.category, st.parameter`,
      [category, q],
    );
    res.json({ standards: rows, note: 'REFERENCE_ONLY records. Verify current official documents and applicability before enforcement.' });
  } catch (error) {
    next(error);
  }
});

complianceRouter.get('/documents', async (_req, res, next) => {
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT d.*, (SELECT COUNT(*)::int FROM regulatory_standards st WHERE st.document_id=d.id) AS standard_count
       FROM regulatory_documents d ORDER BY d.category, d.short_title`,
    );
    res.json({ documents: rows });
  } catch (error) {
    next(error);
  }
});

complianceRouter.get('/documents/:id', async (req, res, next) => {
  try {
    const document = await one<Record<string, unknown>>('SELECT * FROM regulatory_documents WHERE id=$1', [req.params.id]);
    if (!document) throw notFound('Document not found.');
    const standards = await query<Record<string, unknown>>(
      'SELECT * FROM regulatory_standards WHERE document_id=$1 ORDER BY parameter',
      [req.params.id],
    );
    res.json({ document, standards });
  } catch (error) {
    next(error);
  }
});

complianceRouter.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) throw badRequest('Search query must be at least 2 characters.');
    const [documents, standards] = await Promise.all([
      query<Record<string, unknown>>(
        `SELECT id, title, short_title, authority, category, url, verification_status, summary
         FROM regulatory_documents WHERE title ILIKE '%'||$1||'%' OR summary ILIKE '%'||$1||'%' LIMIT 10`,
        [q],
      ),
      query<Record<string, unknown>>(
        `SELECT st.*, d.title AS document_title, d.authority, d.url
         FROM regulatory_standards st JOIN regulatory_documents d ON d.id=st.document_id
         WHERE st.parameter ILIKE '%'||$1||'%' OR st.section_ref ILIKE '%'||$1||'%' LIMIT 20`,
        [q],
      ),
    ]);
    res.json({ query: q, documents, standards });
  } catch (error) {
    next(error);
  }
});

complianceRouter.get('/compare', async (req, res, next) => {
  try {
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    const parameter = typeof req.query.parameter === 'string' ? req.query.parameter : null;
    if (!stationId || !parameter) throw badRequest('stationId and parameter are required.');
    const station = await one<{
      id: string;
      name: string;
      station_type: string;
      category: string;
      is_simulated: boolean;
    }>(
      `SELECT s.id, s.name, s.station_type,
              CASE s.station_type WHEN 'AIR_CAAQMS' THEN 'air' WHEN 'WATER_SAMPLING' THEN 'water' ELSE 'industrial' END AS category,
              s.is_simulated
       FROM monitoring_stations s WHERE s.id=$1`,
      [stationId],
    );
    if (!station) throw notFound('Station not found.');
    const observation = await one<{
      pollutant_code: string;
      value: number;
      unit: string;
      observed_at: string;
      quality_state: string;
      source_id: string;
      is_simulated: boolean;
    }>(
      `SELECT pollutant_code, value::float8 AS value, unit, observed_at, quality_state, source_id, is_simulated
       FROM environmental_observations
       WHERE station_id=$1 AND pollutant_code=$2 ORDER BY observed_at DESC LIMIT 1`,
      [stationId, parameter],
    );
    if (!observation) throw notFound('No observation found for this parameter at the selected station.');
    const standards = await query<Record<string, unknown>>(
      `SELECT st.id, st.parameter, st.parameter_code, st.operator, st.threshold_value::float8, st.threshold_max::float8,
              st.unit, st.averaging_period, st.applicability, st.section_ref, st.notes,
              d.title AS document_title, d.short_title, d.authority, d.url, d.verification_status
       FROM regulatory_standards st JOIN regulatory_documents d ON d.id=st.document_id
       WHERE st.category=$1 AND (st.parameter_code=$2 OR st.parameter ILIKE '%'||$2||'%')
       ORDER BY st.averaging_period`,
      [station.category, parameter],
    );

    const results = standards.map((standard) => {
      const comparison = compareObservation(
        station.station_type,
        {
          value: observation.value,
          unit: observation.unit,
          observed_at: observation.observed_at,
          quality_state: observation.quality_state,
          source_id: observation.source_id,
          is_simulated: observation.is_simulated,
        },
        {
          parameter: String(standard.parameter),
          parameter_code: standard.parameter_code ? String(standard.parameter_code) : null,
          operator: String(standard.operator),
          threshold_value: standard.threshold_value === null ? null : Number(standard.threshold_value),
          threshold_max: standard.threshold_max === null ? null : Number(standard.threshold_max),
          unit: String(standard.unit),
          averaging_period: String(standard.averaging_period),
          applicability: String(standard.applicability),
          section_ref: String(standard.section_ref),
          notes: standard.notes ? String(standard.notes) : null,
        },
      );
      return {
        standard,
        comparison: {
          observedValue: observation.value,
          observedUnit: observation.unit,
          observedAt: observation.observed_at,
          qualityState: observation.quality_state,
          sourceId: observation.source_id,
          isSimulated: observation.is_simulated,
          ...comparison,
        },
      };
    });

    res.json({
      station,
      observation,
      comparisons: results,
      caution:
        'This endpoint never declares a violation. It checks unit, averaging period and source type, then labels a potential concern only when a reference comparison is valid. Official determinations are recorded by an authorised officer in the incident workflow.',
    });
  } catch (error) {
    next(error);
  }
});
