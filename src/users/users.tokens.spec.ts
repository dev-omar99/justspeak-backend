/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

/** Token spending and the free daily AI turn limit: atomic, stored in Postgres, no client-side spending. */
describe('UsersService AI tokens', () => {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    userSubscription: { updateMany: jest.fn(), findUnique: jest.fn() },
    aiFreeTurnUsage: { upsert: jest.fn(), update: jest.fn() },
  };
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma, {
      getActiveRoomCount: jest.fn(),
    } as any);
  });

  const sub = (balance: number, planTier = 'PLUS') => ({
    userId: 'u1',
    planTier,
    aiTokensBalance: balance,
    updatedAt: new Date(),
  });

  it('deducts with one conditional UPDATE that requires enough balance', async () => {
    prisma.userSubscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.userSubscription.findUnique.mockResolvedValue(sub(90));
    const res = await service.consumeAiStudioTokens('u1', 10);
    expect(prisma.userSubscription.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', aiTokensBalance: { gte: 10 } },
      data: { aiTokensBalance: { decrement: 10 } },
    });
    expect(res.aiTokensBalance).toBe(90);
  });

  it('refuses when the balance is too low and deducts nothing', async () => {
    prisma.userSubscription.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.consumeAiStudioTokens('u1', 10)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.userSubscription.findUnique).not.toHaveBeenCalled();
  });

  it('two parallel spends of the last tokens: only one succeeds', async () => {
    let balance = 10;
    prisma.userSubscription.updateMany.mockImplementation(
      async ({ where, data }: any) => {
        if (balance >= where.aiTokensBalance.gte) {
          balance -= data.aiTokensBalance.decrement;
          return { count: 1 };
        }
        return { count: 0 };
      },
    );
    prisma.userSubscription.findUnique.mockImplementation(async () =>
      sub(balance),
    );
    const results = await Promise.allSettled([
      service.consumeAiStudioTokens('u1', 10),
      service.consumeAiStudioTokens('u1', 10),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(balance).toBe(0);
  });

  it('only the configured admin may call the public consume endpoint', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'someone@example.com',
      isAdmin: false,
    });
    await expect(service.assertCanCallConsumeEndpoint('u1')).rejects.toThrow(
      ForbiddenException,
    );
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.assertCanCallConsumeEndpoint('u1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('free daily limit is read from the database and blocks the 6th turn', async () => {
    prisma.userSubscription.findUnique.mockResolvedValue(sub(0, 'FREE'));
    prisma.aiFreeTurnUsage.upsert.mockResolvedValue({ count: 6 });
    prisma.aiFreeTurnUsage.update.mockResolvedValue({});
    await expect(
      service.generateAiCoachTurn('u1', {
        topicTitle: 't',
        userMessage: 'hello',
      } as any),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.aiFreeTurnUsage.update).toHaveBeenCalled();
  });

  it('free turns left are counted from the stored row', async () => {
    prisma.userSubscription.findUnique.mockResolvedValue(sub(0, 'FREE'));
    prisma.aiFreeTurnUsage.upsert.mockResolvedValue({ count: 2 });
    const res: any = await service.generateAiCoachTurn('u1', {
      topicTitle: 't',
      userMessage: 'hello',
    } as any);
    expect(res.remainingFreeTurns).toBe(3);
  });
});
