import test from 'node:test';
import assert from 'node:assert/strict';
import { computedHash, validStoredEventHash } from '../../postgres-incident-store.ts';
test('legacy demo Date compatibility verifies original fields without rewriting chain hashes', () => {
  const original:any={id:'test',incidentId:'DEMO-test',type:'DemoSessionCreated',occurredAt:'2026-09-07T11:39:25.998Z',actorId:'operator',correlationId:'demo',schemaVersion:2,previousHash:'GENESIS',payload:{dataOrigin:'SIMULATION',operatingMode:'SIMULATION',revision:1,sourceOccurredAt:new Date('2026-09-07T11:39:25.998Z')}};
  const stored=JSON.parse(JSON.stringify({...original,eventHash:computedHash(original)}));
  assert.equal(validStoredEventHash(stored),true);
  assert.equal(validStoredEventHash({...stored,payload:{...stored.payload,revision:2}}),false);
  assert.equal(validStoredEventHash({...stored,type:'AgentValidationReplied'}),false);
  const future={...original,occurredAt:'2026-09-08T00:00:00.000Z'};
  assert.equal(validStoredEventHash(JSON.parse(JSON.stringify({...future,eventHash:computedHash(future)}))),false);
  const normalized=JSON.parse(JSON.stringify(original));
  assert.equal(validStoredEventHash({...normalized,eventHash:computedHash(normalized)}),true);
});
