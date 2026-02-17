import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: 'config/sources.env' });
dotenv.config();

export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required. Set it in config/sources.env.');
  }
  return new Pool({ connectionString });
}
