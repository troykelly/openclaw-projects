import { runMigrate } from '../helpers/migrate.ts';

async function globalSetup() {
  await runMigrate('up');
}

export default globalSetup;
