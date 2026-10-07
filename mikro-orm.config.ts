import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

export default defineConfig({
  clientUrl: databaseUrl,
  extensions: [Migrator],

  migrations: {
    path: './dist/infrastructure/persistence/migrations',
    pathTs: './src/infrastructure/persistence/migrations',
    emit: 'ts',
  },
});
