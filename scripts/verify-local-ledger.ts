import {PostgresIncidentEventStore} from '../src/server/postgres-incident-store.ts';
const store=new PostgresIncidentEventStore(process.env.DATABASE_URL || 'postgresql://cloudzero:cloudzero-local-only@127.0.0.1:5432/cloudzero');
try { await store.initialize(); console.log('Ledger verified',store.all().length); } finally { await store.close(); }
