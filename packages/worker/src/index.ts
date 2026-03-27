import { startWatcher } from './watcher.js';
import { startWorker } from './worker.js';
import { startRecurringWatcher } from './recurring-watcher.js';

const mode = process.env.MODE ?? 'all';

async function main() {
  if (mode === 'watcher' || mode === 'all') {
    await startWatcher();
  }
  if (mode === 'worker' || mode === 'all') {
    await startWorker();
  }
  if (mode === 'recurring' || mode === 'all') {
    await startRecurringWatcher();
  }
}

main().catch((err) => {
  console.error('Failed to start worker process:', err);
  process.exit(1);
});
