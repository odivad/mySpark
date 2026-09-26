import { SparkBtClient, createDemoTransport } from './spark/client.js';

const client = new SparkBtClient(createDemoTransport());

await client.requestState();
await client.setParameter('amp', 'gain', 0.75);
await client.setEffectState('amp', true);
await client.loadPreset(0);

console.log('Current state:', JSON.stringify(client.currentState.livePreset, null, 2));
