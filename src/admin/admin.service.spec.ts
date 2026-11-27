import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma.service';
import { isAdminEmail } from './admin-policy';

describe('AdminService & JwtAuthGuard Account Lifecycle (Stage 2 Batch 1)', () => {
  let adminService: AdminService;
  let jwtAuthGuard: JwtAuthGuard;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    otpCode: {
      deleteMany: jest.fn(),
    },
    session: { count: jest.fn() },
    sessionFeedback: { count: jest.fn() },
    userBlock: { count: jest.fn() },
  };

  const mockJwtService = {
    verify: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        JwtAuthGuard,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    adminService = module.get<AdminService>(AdminService);
    jwtAuthGuard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('should throw NotFoundException when deleting a non-existent user', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(null);

    await expect(adminService.deleteUser('missing-id')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockPrismaService.user.delete).not.toHaveBeenCalled();
  });

  it('should purge historical OtpCode records when deleting a user so stale verified OTPs cannot linger', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: 'user-del-1',
      email: 'ReuseMe@Example.com',
      phone: '+201012345678',
    });
    mockPrismaService.otpCode.deleteMany.mockResolvedValue({ count: 2 });
    mockPrismaService.user.delete.mockResolvedValue({ id: 'user-del-1' });

    const res = await adminService.deleteUser('user-del-1');

    expect(res).toEqual({ success: true });
    expect(mockPrismaService.otpCode.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { identifier: { equals: 'reuseme@example.com', mode: 'insensitive' } },
          { identifier: { equals: '+201012345678', mode: 'insensitive' } },
        ],
      },
    });
    expect(mockPrismaService.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-del-1' },
    });
  });

  it('should reject JWT in JwtAuthGuard when the user account has been deleted', async () => {
    mockJwtService.verify.mockReturnValue({
      sub: 'deleted-user-id',
      email: 'gone@example.com',
    });
    mockPrismaService.user.findUnique.mockResolvedValue(null);

    const ctx: any = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer valid.jwt.for.deleted.user' },
        }),
      }),
    };

    await expect(jwtAuthGuard.canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('Single-admin policy at boot (ADMIN_EMAIL)', () => {
  const original = process.env.ADMIN_EMAIL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = original;
    }
  });

  function buildService() {
    const prisma = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = new AdminService(prisma as any);
    return { prisma, service };
  }

  it('promotes the configured account and demotes every other admin', async () => {
    process.env.ADMIN_EMAIL = 'Owner@Example.com';
    const { prisma, service } = buildService();

    await service.onApplicationBootstrap();

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { email: 'owner@example.com', isAdmin: false },
      data: { isAdmin: true },
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { email: { not: 'owner@example.com' }, isAdmin: true },
      data: { isAdmin: false },
    });
  });

  it('does nothing when ADMIN_EMAIL is not configured', async () => {
    delete process.env.ADMIN_EMAIL;
    const { prisma, service } = buildService();

    await service.onApplicationBootstrap();

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('admin-policy helpers', () => {
  const original = process.env.ADMIN_EMAIL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = original;
    }
  });

  it('matches the admin email case-insensitively', () => {
    process.env.ADMIN_EMAIL = 'Owner@Example.com';
    expect(isAdminEmail('owner@example.com')).toBe(true);
    expect(isAdminEmail('OWNER@EXAMPLE.COM')).toBe(true);
    expect(isAdminEmail('other@example.com')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });

  it('fails closed when ADMIN_EMAIL is unset', () => {
    delete process.env.ADMIN_EMAIL;
    expect(isAdminEmail('owner@example.com')).toBe(false);
  });
});

describe('Admin full control (sessions, quotas, audit)', () => {
  const original = process.env.ADMIN_EMAIL;

  function buildService() {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
      otpCode: { deleteMany: jest.fn() },
      userSubscription: { findUnique: jest.fn(), upsert: jest.fn() },
      aiPartnerQuotaOffset: { findUnique: jest.fn(), upsert: jest.fn() },
      aiPartnerSession: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      aiPartnerRecording: { count: jest.fn(), findMany: jest.fn() },
      session: { count: jest.fn(), findMany: jest.fn() },
      sessionFeedback: { count: jest.fn(), findMany: jest.fn() },
      userBlock: { count: jest.fn() },
      adminAuditLog: { create: jest.fn(), findMany: jest.fn() },
    };
    const service = new AdminService(prisma as any);
    return { prisma, service };
  }

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = original;
    }
  });

  it('getStats returns the extended platform counters', async () => {
    const { prisma, service } = buildService();
    prisma.user.count.mockResolvedValue(10);
    prisma.session.count.mockResolvedValue(4);
    prisma.sessionFeedback.count.mockResolvedValue(6);
    prisma.userBlock.count.mockResolvedValue(1);
    prisma.aiPartnerSession.count
      .mockResolvedValueOnce(9) // total
      .mockResolvedValueOnce(2); // active
    prisma.aiPartnerRecording.count.mockResolvedValue(3);
    // second user.count call (newUsersLast7d)
    prisma.user.count.mockResolvedValueOnce(10).mockResolvedValueOnce(5);

    const stats = await service.getStats();

    expect(stats).toEqual({
      totalUsers: 10,
      totalSessions: 4,
      totalFeedbacks: 6,
      totalBlocks: 1,
      totalAiSessions: 9,
      activeAiSessions: 2,
      totalRecordings: 3,
      newUsersLast7d: 5,
    });
  });

  it('getUserDetail combines profile, subscription and AI quota', async () => {
    const { prisma, service } = buildService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      phone: null,
      name: 'User One',
      country: 'Egypt',
      englishLevel: 'B1',
      isAdmin: false,
      ticketsLeft: 5,
      createdAt: new Date('2026-01-01'),
      _count: {
        buddies: 2,
        blockedUsers: 1,
        givenFeedbacks: 3,
        receivedFeedbacks: 4,
        aiPartnerSessions: 7,
      },
    });
    prisma.userSubscription.findUnique.mockResolvedValue({
      planTier: 'PLUS',
      aiTokensBalance: 250,
    });
    prisma.aiPartnerQuotaOffset.findUnique.mockResolvedValue({ offset: 4 });

    const detail = await service.getUserDetail('u1');

    expect(detail.planTier).toBe('PLUS');
    expect(detail.aiSessionsUsed).toBe(7);
    expect(detail.aiQuotaOffset).toBe(4);
    expect(detail.buddiesCount).toBe(2);
  });

  it('getUserDetail throws NotFoundException for unknown users', async () => {
    const { prisma, service } = buildService();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getUserDetail('nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('setAiQuotaOffset upserts the offset and writes an audit entry (no history deletion)', async () => {
    const { prisma, service } = buildService();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.aiPartnerQuotaOffset.upsert.mockResolvedValue({ offset: 6 });
    prisma.adminAuditLog.create.mockResolvedValue({});

    const res = await service.setAiQuotaOffset('owner@example.com', 'u1', 6.9);

    expect(res).toEqual({ success: true, userId: 'u1', offset: 6 });
    expect(prisma.aiPartnerQuotaOffset.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', offset: 6 },
      update: { offset: 6 },
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminEmail: 'owner@example.com',
        action: 'user.ai-quota-offset.set',
        targetType: 'user',
        targetId: 'u1',
      }),
    });
  });

  it('deleteUser refuses to delete the configured admin account', async () => {
    process.env.ADMIN_EMAIL = 'owner@example.com';
    const { prisma, service } = buildService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'Owner@Example.com',
      phone: null,
    });

    await expect(
      service.deleteUser('admin-1', 'owner@example.com'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('forceEndAiSession closes an active session and audits it', async () => {
    const { prisma, service } = buildService();
    prisma.aiPartnerSession.findUnique.mockResolvedValue({
      id: 's1',
      status: 'active',
      startedAt: new Date(Date.now() - 65_000),
    });
    prisma.aiPartnerSession.update.mockResolvedValue({ id: 's1', status: 'finished' });
    prisma.adminAuditLog.create.mockResolvedValue({});

    const res = await service.forceEndAiSession('owner@example.com', 's1');

    expect(res.changed).toBe(true);
    expect(prisma.aiPartnerSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: expect.objectContaining({ status: 'finished' }),
      select: { id: true, status: true },
    });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'ai-session.force-end' }),
    });
  });

  it('forceEndAiSession leaves finished sessions untouched', async () => {
    const { prisma, service } = buildService();
    prisma.aiPartnerSession.findUnique.mockResolvedValue({
      id: 's2',
      status: 'finished',
      startedAt: new Date(),
    });

    const res = await service.forceEndAiSession('owner@example.com', 's2');

    expect(res).toEqual({ success: true, id: 's2', status: 'finished', changed: false });
    expect(prisma.aiPartnerSession.update).not.toHaveBeenCalled();
  });

  it('getAiSessionDetail throws NotFoundException for unknown sessions', async () => {
    const { prisma, service } = buildService();
    prisma.aiPartnerSession.findUnique.mockResolvedValue(null);
    await expect(service.getAiSessionDetail('nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getAuditLog clamps the page size and newest-first order', async () => {
    const { prisma, service } = buildService();
    prisma.adminAuditLog.findMany.mockResolvedValue([]);

    await service.getAuditLog(5000, -3);

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      take: 200,
      skip: 0,
    });
  });
});
