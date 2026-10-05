import { PrismaClient } from "@prisma/client";

// One client per server process. In dev, hot reload would otherwise open a new connection pool each time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
