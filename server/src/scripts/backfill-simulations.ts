import { closePool } from '../db/pool.js';
import { ensureSimulationSchema } from '../db/simulation-migrations.js';
import { backfillSimulationRecommendations } from '../services/simulation-backfill.js';

async function main() {
  await ensureSimulationSchema();
  const result = await backfillSimulationRecommendations();
  console.log(
    `Simulation recommendations backfilled: ${result.sessions} session(s), ${result.events} event(s).`,
  );
}

main()
  .catch((error) => {
    console.error('Simulation backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
