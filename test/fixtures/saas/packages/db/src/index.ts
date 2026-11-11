import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export const getUser = () => prisma.user.findFirst();
