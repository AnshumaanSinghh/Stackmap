import Fastify from 'fastify';
import Stripe from 'stripe';
import Redis from 'ioredis';
import * as Sentry from '@sentry/node';
import { prisma } from '@acme/db';

Sentry.init({ dsn: process.env.SENTRY_DSN });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const redis = new Redis(process.env.REDIS_URL!);
const app = Fastify();

app.get('/health', async () => ({ ok: true, users: await prisma.user.count(), cached: await redis.get('x'), s: Boolean(stripe) }));
app.listen({ port: 4000 });
