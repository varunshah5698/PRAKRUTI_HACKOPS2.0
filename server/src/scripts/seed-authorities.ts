import { closePool } from '../db/pool.js';
import { seedAuthorityDirectory } from '../db/authority-seed.js';

async function main() {
  const inserted = await seedAuthorityDirectory();
  console.log(
    `Authority directory seed: ${inserted} new reference entries added; existing entries were not overwritten. Contacts remain empty unless a system administrator adds verified details.`,
  );
}

main()
  .catch((error) => {
    console.error('Authority seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
