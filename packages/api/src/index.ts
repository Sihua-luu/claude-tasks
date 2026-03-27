import express from 'express';
import { jobsRouter } from './routes/jobs.js';
import { errorHandler } from './middleware/error-handler.js';
import { ensureTables } from './db/tables.js';

const app = express();
app.use(express.json());

app.use('/v1/jobs', jobsRouter);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  await ensureTables();
  app.listen(PORT, () => {
    console.log(`Job Scheduling API listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
