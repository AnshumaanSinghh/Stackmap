import { Worker } from 'bullmq';
import { prisma } from '@acme/db';

new Worker('emails', async () => prisma.user.findMany(), { connection: { url: process.env.REDIS_URL } });
