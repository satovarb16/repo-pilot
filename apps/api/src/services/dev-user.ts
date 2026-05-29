import type { PrismaClient } from '@prisma/client';

export const DEV_USER_ID = 'dev-user-seed';

export async function ensureDevUser(prisma: PrismaClient): Promise<string> {
  await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    update: {},
    create: { id: DEV_USER_ID },
  });
  return DEV_USER_ID;
}
