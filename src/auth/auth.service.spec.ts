import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    otpCode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockJwt = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendOtp', () => {
    it('should generate and return 6-digit OTP when cooldown has passed', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);
      mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp-1' });

      const res = await service.sendOtp({
        identifier: 'test@example.com',
        type: 'email',
      });

      expect(res.success).toBe(true);
      expect(mockPrisma.otpCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identifier: 'test@example.com',
          }),
        })
      );
    });

    it('should throw BadRequestException if requested within 60 seconds', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-recent',
        createdAt: new Date(),
      });

      await expect(
        service.sendOtp({
          identifier: 'test@example.com',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyOtp', () => {
    it('should verify OTP and create new user when password provided', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-valid',
        code: '123456',
      });
      mockPrisma.otpCode.update.mockResolvedValue({ id: 'otp-valid', verified: true });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'test@example.com',
        phone: null,
        countryCode: null,
        name: 'Ahmed',
        country: 'Egypt',
        englishLevel: 'Intermediate',
        isAdmin: false,
        avatarUrl: null,
        bio: null,
        ticketsLeft: 5,
        tribeId: null,
        createdAt: new Date(),
      });

      const res = await service.verifyOtp({
        identifier: 'test@example.com',
        code: '123456',
        password: 'password123',
        name: 'Ahmed',
        country: 'Egypt',
      });

      expect(res.success).toBe(true);
      expect(res.accessToken).toBe('mock-jwt-token');
      expect(res.user.name).toBe('Ahmed');
      expect(mockPrisma.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-valid' },
        data: { verified: true },
      });
    });

    it('should throw BadRequestException if OTP code is invalid or expired', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyOtp({
          identifier: 'test@example.com',
          code: '999999',
        })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('googleLogin', () => {
    it('should create new user and return accessToken if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-google-1',
        email: 'googleuser@gmail.com',
        phone: null,
        countryCode: null,
        name: 'Google User',
        country: null,
        englishLevel: 'Intermediate',
        isAdmin: false,
        avatarUrl: 'https://example.com/avatar.jpg',
        bio: null,
        ticketsLeft: 5,
        tribeId: null,
        createdAt: new Date(),
      });

      const res = await service.googleLogin({
        email: 'googleuser@gmail.com',
        name: 'Google User',
        avatarUrl: 'https://example.com/avatar.jpg',
      });

      expect(res.success).toBe(true);
      expect(res.accessToken).toBe('mock-jwt-token');
      expect(res.user.email).toBe('googleuser@gmail.com');
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'googleuser@gmail.com',
            name: 'Google User',
            avatarUrl: 'https://example.com/avatar.jpg',
          }),
        })
      );
    });

    it('should login existing user without creating a new record', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-google-existing',
        email: 'existing@gmail.com',
        phone: null,
        countryCode: null,
        name: 'Existing User',
        country: null,
        englishLevel: 'Advanced',
        isAdmin: false,
        avatarUrl: 'https://example.com/old.jpg',
        bio: null,
        ticketsLeft: 4,
        tribeId: null,
        createdAt: new Date(),
      });

      const res = await service.googleLogin({
        email: 'existing@gmail.com',
      });

      expect(res.success).toBe(true);
      expect(res.accessToken).toBe('mock-jwt-token');
      expect(res.user.id).toBe('user-google-existing');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });
});

