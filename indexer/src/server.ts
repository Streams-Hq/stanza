import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import {
  getAllPlans,
  getAllSubscriptions,
  getChargesBySubId,
  getDueSubscriptions,
  getEventsBySubId,
  getLastLedger,
  getPlanById,
  getPlansByMerchant,
  getStats,
  getSubscriptionById,
  getSubscriptionsByPlan,
  getSubscriptionsBySubscriber,
  initDatabase,
} from './db.js';
import { StanzaIndexer } from './indexer.js';

dotenv.config();

const app = express();
const port = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json());

initDatabase();

const indexer = new StanzaIndexer();
indexer.start().catch((err) => {
  console.error('[Server] Failed to start indexer:', err);
});

const parseId = (raw: string | string[] | undefined): number | null => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(value ?? '', 10);
  return Number.isNaN(id) || id < 0 ? null : id;
};

const paging = (req: Request): { limit: number; offset: number } => ({
  limit: Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50)),
  offset: Math.max(0, parseInt(req.query.offset as string, 10) || 0),
});

app.get('/', (_req, res) => {
  res.json({
    service: 'stanza-indexer',
    docs: 'https://github.com/stanza-labs/stanza#readme',
    endpoints: [
      '/health',
      '/api/stats',
      '/api/plans',
      '/api/plans/:id',
      '/api/plans/merchant/:address',
      '/api/plans/:id/subscriptions',
      '/api/subscriptions',
      '/api/subscriptions/:id',
      '/api/subscriptions/subscriber/:address',
      '/api/subscriptions/due',
      '/api/subscriptions/:id/charges',
      '/api/events/:subId',
    ],
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'stanza-indexer',
    lastLedger: getLastLedger(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/stats', (_req, res) => {
  try {
    return res.json(getStats());
  } catch (err) {
    console.error('stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/plans', (req, res) => {
  const { limit, offset } = paging(req);
  return res.json({ plans: getAllPlans(limit, offset), limit, offset });
});

// NOTE: keep the specific routes above the `:id` route.
app.get('/api/plans/merchant/:address', (req, res) => {
  const address = Array.isArray(req.params.address)
    ? req.params.address[0]
    : req.params.address;
  if (!address) return res.status(400).json({ error: 'Merchant address required' });
  return res.json({ plans: getPlansByMerchant(address) });
});

app.get('/api/plans/:id/subscriptions', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid plan id' });
  if (!getPlanById(id)) return res.status(404).json({ error: 'Plan not found' });
  return res.json({ subscriptions: getSubscriptionsByPlan(id) });
});

app.get('/api/plans/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid plan id' });
  const plan = getPlanById(id);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  return res.json({ plan });
});

app.get('/api/subscriptions', (req, res) => {
  const { limit, offset } = paging(req);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  return res.json({
    subscriptions: getAllSubscriptions(limit, offset, status),
    limit,
    offset,
  });
});

app.get('/api/subscriptions/due', (req, res) => {
  const { limit } = paging(req);
  return res.json({
    dueAt: Math.floor(Date.now() / 1000),
    subscriptions: getDueSubscriptions(Math.floor(Date.now() / 1000), limit),
  });
});

app.get('/api/subscriptions/subscriber/:address', (req, res) => {
  const address = Array.isArray(req.params.address)
    ? req.params.address[0]
    : req.params.address;
  if (!address) return res.status(400).json({ error: 'Subscriber address required' });
  return res.json({ subscriptions: getSubscriptionsBySubscriber(address) });
});

app.get('/api/subscriptions/:id/charges', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid subscription id' });
  return res.json({ charges: getChargesBySubId(id) });
});

app.get('/api/subscriptions/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid subscription id' });
  const subscription = getSubscriptionById(id);
  if (!subscription) {
    return res.status(404).json({ error: 'Subscription not found' });
  }
  return res.json({ subscription });
});

app.get('/api/events/:subId', (req, res) => {
  const id = parseId(req.params.subId);
  if (id === null) return res.status(400).json({ error: 'Invalid subscription id' });
  return res.json({ events: getEventsBySubId(id) });
});

export const server = app.listen(port, () => {
  console.log(`[Server] Stanza indexer API on http://localhost:${port}`);
});

const shutdown = () => {
  indexer.stop();
  server.close();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
