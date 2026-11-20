import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma.service';

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
