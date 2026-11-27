import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { GoogleAuthDto } from './dto';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    otpCode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwt = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // clearAllMocks keeps custom implementations; reset the user.update mock so
    // one test's update result cannot leak into the next test's syncAdminFlag.
    mockPrisma.user.update.mockReset();
    mockPrisma.otpCode.updateMany.mockResolvedValue({ count: 1 });
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
    it('should generate and return 6-digit OTP when cooldown has passed without logging the OTP value', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);
      mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp-1' });
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      try {
        const res = await service.sendOtp({
          identifier: 'test@example.com',
          type: 'email',
        });

        expect(res.success).toBe(true);
        expect(mockPrisma.otpCode.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              identifier: 'test@example.com',
              code: expect.stringMatching(/^\d{6}$/),
            }),
          }),
        );

        const createdCode =
          mockPrisma.otpCode.create.mock.calls[0][0].data.code;
        const allLogs = logSpy.mock.calls.flat().join(' ');
        expect(allLogs).not.toContain(createdCode);
        expect(allLogs).not.toContain('test@example.com');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('never echoes the dev code for an existing account (blocks OTP-leak password reset)', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);
      mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp-x' });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      jest
        .spyOn(service as any, 'dispatchRealEmail')
        .mockResolvedValue(false);

      const res = await service.sendOtp({
        identifier: 'victim@example.com',
        type: 'email',
      });

      expect(res.isRealSent).toBe(false);
      expect(res.devCode).toBeUndefined();
    });

    it('still returns the dev code for a brand-new identifier when delivery fails', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);
      mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp-y' });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      jest
        .spyOn(service as any, 'dispatchRealEmail')
        .mockResolvedValue(false);

      const res = await service.sendOtp({
        identifier: 'newcomer@example.com',
        type: 'email',
      });

      expect(res.devCode).toMatch(/^\d{6}$/);
    });

    it('returns no dev code for anyone when ALLOW_DEV_OTP=false', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);
      mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp-z' });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      jest
        .spyOn(service as any, 'dispatchRealEmail')
        .mockResolvedValue(false);
      process.env.ALLOW_DEV_OTP = 'false';
      try {
        const res = await service.sendOtp({
          identifier: 'newcomer2@example.com',
          type: 'email',
        });
        expect(res.devCode).toBeUndefined();
      } finally {
        delete process.env.ALLOW_DEV_OTP;
      }
    });

    it('should throw BadRequestException if requested within 60 seconds', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-recent',
        createdAt: new Date(),
      });

      await expect(
        service.sendOtp({
          identifier: 'test@example.com',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should enforce sliding-window rate limit when excessive OTP requests are made', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);
      mockPrisma.otpCode.create.mockResolvedValue({ id: 'otp-rate' });

      for (let i = 0; i < AuthService.MAX_OTP_REQUESTS_PER_WINDOW; i++) {
        await service.sendOtp({ identifier: 'burst@example.com' });
      }

      await expect(
        service.sendOtp({ identifier: 'burst@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyOtp', () => {
    it('should verify OTP and create new user when password provided', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-valid',
        code: '123456',
        verified: false,
        attempts: 0,
        expiresAt: new Date(Date.now() + 60000),
      });
      mockPrisma.otpCode.update.mockResolvedValue({
        id: 'otp-valid',
        verified: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'test@example.com',
        emailVerified: true,
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
      expect(res.user).toBeDefined();
      expect(res.user?.name).toBe('Ahmed');
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
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject incorrect OTP code and increment attempt count in DB', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-wrong-test',
        code: '654321',
        verified: false,
        attempts: 1,
        expiresAt: new Date(Date.now() + 60000),
      });
      mockPrisma.otpCode.update.mockResolvedValue({});

      await expect(
        service.verifyOtp({
          identifier: 'wrongcode@example.com',
          code: '111111',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp-wrong-test' },
        data: { attempts: 2 },
      });
    });

    it('should reject expired OTP code even if returned by query', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-expired',
        code: '123456',
        verified: false,
        attempts: 0,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.verifyOtp({
          identifier: 'expired@example.com',
          code: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should enforce single-use semantics and reject repeated verification of the same OTP', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-single-use',
        code: '123456',
        verified: false,
        attempts: 0,
        expiresAt: new Date(Date.now() + 60000),
      });
      mockPrisma.otpCode.update.mockResolvedValue({
        id: 'otp-single-use',
        verified: true,
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const first = await service.verifyOtp({
        identifier: 'single@example.com',
        code: '123456',
      });
      expect(first.success).toBe(true);

      await expect(
        service.verifyOtp({
          identifier: 'single@example.com',
          code: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should prevent concurrent verification requests from using the same OTP twice', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-concurrent-1',
        code: '777888',
        verified: false,
        attempts: 0,
        expiresAt: new Date(Date.now() + 60000),
      });
      let claimedOnce = false;
      mockPrisma.otpCode.updateMany.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 15));
        if (claimedOnce) {
          return { count: 0 };
        }
        claimedOnce = true;
        return { count: 1 };
      });
      mockPrisma.otpCode.update.mockResolvedValue({
        id: 'otp-concurrent-1',
        verified: true,
      });
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const results = await Promise.allSettled([
        service.verifyOtp({
          identifier: 'concurrent@example.com',
          code: '777888',
        }),
        service.verifyOtp({
          identifier: 'concurrent@example.com',
          code: '777888',
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });

    it('should lock out and expire OTP after 5 failed verification attempts', async () => {
      let currentAttempts = 0;
      mockPrisma.otpCode.findFirst.mockImplementation(async () => ({
        id: 'otp-bruteforce',
        code: '555666',
        verified: false,
        attempts: currentAttempts,
        expiresAt: new Date(Date.now() + 60000),
      }));
      mockPrisma.otpCode.update.mockImplementation(async ({ data }) => {
        if (typeof data.attempts === 'number') {
          currentAttempts = data.attempts;
        }
        return {};
      });

      for (let i = 0; i < AuthService.MAX_OTP_ATTEMPTS; i++) {
        await expect(
          service.verifyOtp({
            identifier: 'victim@example.com',
            code: `00000${i}`,
          }),
        ).rejects.toThrow(BadRequestException);
      }

      // Even providing the correct code afterwards must be rejected because the OTP is locked out
      await expect(
        service.verifyOtp({
          identifier: 'victim@example.com',
          code: '555666',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('googleLogin', () => {
    const originalEnv = process.env.GOOGLE_CLIENT_ID;

    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.GOOGLE_CLIENT_ID = originalEnv;
      } else {
        delete process.env.GOOGLE_CLIENT_ID;
      }
    });

    describe('Server configuration validation (fail-closed)', () => {
      it('should throw InternalServerErrorException and NOT call verifyIdToken when GOOGLE_CLIENT_ID is missing', async () => {
        delete process.env.GOOGLE_CLIENT_ID;
        const mockOAuthClient = {
          verifyIdToken: jest.fn(),
        } as unknown as OAuth2Client;
        service.setGoogleClient(mockOAuthClient);

        await expect(
          service.googleLogin({
            credential: 'any-token',
          }),
        ).rejects.toThrow(InternalServerErrorException);

        expect(mockOAuthClient.verifyIdToken).not.toHaveBeenCalled();
      });

      it('should throw InternalServerErrorException and NOT call verifyIdToken when GOOGLE_CLIENT_ID is empty string', async () => {
        process.env.GOOGLE_CLIENT_ID = '';
        const mockOAuthClient = {
          verifyIdToken: jest.fn(),
        } as unknown as OAuth2Client;
        service.setGoogleClient(mockOAuthClient);

        await expect(
          service.googleLogin({
            credential: 'any-token',
          }),
        ).rejects.toThrow(InternalServerErrorException);

        expect(mockOAuthClient.verifyIdToken).not.toHaveBeenCalled();
      });

      it('should throw InternalServerErrorException and NOT call verifyIdToken when GOOGLE_CLIENT_ID is whitespace-only', async () => {
        process.env.GOOGLE_CLIENT_ID = '   ';
        const mockOAuthClient = {
          verifyIdToken: jest.fn(),
        } as unknown as OAuth2Client;
        service.setGoogleClient(mockOAuthClient);

        await expect(
          service.googleLogin({
            credential: 'any-token',
          }),
        ).rejects.toThrow(InternalServerErrorException);

        expect(mockOAuthClient.verifyIdToken).not.toHaveBeenCalled();
      });
    });

    describe('Audience and verification enforcement', () => {
      it('should pass configured client ID to verifyIdToken as audience', async () => {
        process.env.GOOGLE_CLIENT_ID = 'strictly-expected-client-id';
        const mockOAuthClient = {
          verifyIdToken: jest.fn().mockResolvedValue({
            getPayload: () => ({
              email: 'valid@example.com',
              email_verified: true,
              name: 'Valid User',
            }),
          }),
        } as unknown as OAuth2Client;
        service.setGoogleClient(mockOAuthClient);
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'valid@example.com' });

        await service.googleLogin({
          credential: 'my-test-token',
        });

        expect(mockOAuthClient.verifyIdToken).toHaveBeenCalledWith({
          idToken: 'my-test-token',
          audience: 'strictly-expected-client-id',
        });
      });

      it('should throw UnauthorizedException and NOT expose raw library error details when audience does not match', async () => {
        const rawLibraryError = 'Wrong recipient, audience mismatch, expected: secret-client-id, got: attacker-client-id';
        const mockOAuthClient = {
          verifyIdToken: jest
            .fn()
            .mockRejectedValue(new Error(rawLibraryError)),
        } as unknown as OAuth2Client;
        service.setGoogleClient(mockOAuthClient);

        try {
          await service.googleLogin({
            credential: 'mismatched-aud-token',
          });
          fail('Expected googleLogin to throw UnauthorizedException');
        } catch (err: any) {
          expect(err).toBeInstanceOf(UnauthorizedException);
          expect(err.message).toBe('Google authentication token verification failed.');
          expect(err.message).not.toContain('secret-client-id');
          expect(err.message).not.toContain('attacker-client-id');
          expect(err.message).not.toContain('Wrong recipient');
        }
      });

      it('should throw UnauthorizedException and NOT expose raw library error details on signature or expiry failure', async () => {
        const rawLibraryError = 'Token used too late, expired: 1234567890';
        const mockOAuthClient = {
          verifyIdToken: jest
            .fn()
            .mockRejectedValue(new Error(rawLibraryError)),
        } as unknown as OAuth2Client;
        service.setGoogleClient(mockOAuthClient);

        try {
          await service.googleLogin({
            credential: 'expired-token',
          });
          fail('Expected googleLogin to throw UnauthorizedException');
        } catch (err: any) {
          expect(err).toBeInstanceOf(UnauthorizedException);
          expect(err.message).toBe('Google authentication token verification failed.');
          expect(err.message).not.toContain('Token used too late');
          expect(err.message).not.toContain('1234567890');
        }
      });
    });

    it('should create new user and return accessToken if valid Google token is provided for a new user', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            email: 'googleuser@gmail.com',
            email_verified: true,
            name: 'Google User',
            picture: 'https://example.com/avatar.jpg',
          }),
        }),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

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
        credential: 'valid-google-id-token',
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
        }),
      );
    });

    it('should login existing user without creating a new record when valid Google token provided', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            email: 'existing@gmail.com',
            email_verified: true,
            name: 'Existing User',
            picture: 'https://example.com/old.jpg',
          }),
        }),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

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
        credential: 'valid-google-id-token',
      });

      expect(res.success).toBe(true);
      expect(res.accessToken).toBe('mock-jwt-token');
      expect(res.user.id).toBe('user-google-existing');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if Google token signature is invalid or tampered', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest
          .fn()
          .mockRejectedValue(new Error('Invalid token signature')),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

      await expect(
        service.googleLogin({
          credential: 'tampered-signature-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if Google token is expired', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest
          .fn()
          .mockRejectedValue(new Error('Token used too late, expired')),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

      await expect(
        service.googleLogin({
          credential: 'expired-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if Google token audience does not match', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest
          .fn()
          .mockRejectedValue(new Error('Wrong recipient, audience mismatch')),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

      await expect(
        service.googleLogin({
          credential: 'mismatched-aud-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if Google email is not verified', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            email: 'unverified@gmail.com',
            email_verified: false,
            name: 'Unverified User',
          }),
        }),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

      await expect(
        service.googleLogin({
          credential: 'unverified-email-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if Google payload is missing email', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            email: undefined,
            email_verified: true,
          }),
        }),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

      await expect(
        service.googleLogin({
          credential: 'missing-email-token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException if credential is missing, empty, or whitespace', async () => {
      await expect(
        service.googleLogin({
          credential: '',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.googleLogin({
          credential: '   ',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.googleLogin({} as unknown as GoogleAuthDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject Google login matching an unverified email account (prevent automatic linking)', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            email: 'victim@gmail.com',
            email_verified: true,
            name: 'Real Victim',
          }),
        }),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'pre-registered-attacker-account',
        email: 'victim@gmail.com',
        emailVerified: false,
        password: 'attacker-bcrypt-hash',
      });

      await expect(
        service.googleLogin({
          credential: 'valid-google-token-for-victim',
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('Account Ownership & Duplicate Identity Protection (H5)', () => {
    it('should create email signup accounts with emailVerified = false and reject duplicate email signup', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValueOnce({
        id: 'u-signup-1',
        email: 'owner@example.com',
        emailVerified: false,
        password: 'hashed-password',
      });

      const created = await service.signup({
        email: 'Owner@Example.com',
        password: 'password123',
        name: 'Owner',
      });
      expect(created.user.email).toBe('owner@example.com');
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'owner@example.com',
            emailVerified: false,
          }),
        }),
      );

      // Duplicate signup attempt using another person's email
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'u-signup-1',
        email: 'owner@example.com',
      });

      await expect(
        service.signup({
          email: 'owner@example.com',
          password: 'attackerPassword123',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should rotate password and mark emailVerified = true when real owner verifies unverified email via OTP', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-reclaim-1',
        code: '888999',
        verified: false,
        attempts: 0,
        expiresAt: new Date(Date.now() + 60000),
      });
      mockPrisma.otpCode.update.mockResolvedValue({
        id: 'otp-reclaim-1',
        verified: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-unverified',
        email: 'reclaim@example.com',
        emailVerified: false,
        password: 'old-attacker-password-hash',
      });
      mockPrisma.user.update.mockImplementation(async ({ data }) => ({
        id: 'u-unverified',
        email: 'reclaim@example.com',
        emailVerified: data.emailVerified,
        password: data.password,
        name: 'True Owner',
      }));

      const res = await service.verifyOtp({
        identifier: 'reclaim@example.com',
        code: '888999',
        password: 'newOwnerPassword123',
        name: 'True Owner',
      });

      expect(res.success).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-unverified' },
          data: expect.objectContaining({
            emailVerified: true,
            password: expect.not.stringMatching('old-attacker-password-hash'),
          }),
        }),
      );
    });

    it('should reject duplicate OTP signup when account is already emailVerified', async () => {
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-dup-verified',
        code: '222333',
        verified: false,
        attempts: 0,
        expiresAt: new Date(Date.now() + 60000),
      });
      mockPrisma.otpCode.update.mockResolvedValue({
        id: 'otp-dup-verified',
        verified: true,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-already-verified',
        email: 'verified@example.com',
        emailVerified: true,
      });

      await expect(
        service.verifyOtp({
          identifier: 'verified@example.com',
          code: '222333',
          password: 'someNewPassword123',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should refuse ambiguous phone suffix match when multiple users share the same trailing digits', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u-eg', phone: '+201012345678', password: 'h1' },
        { id: 'u-sa', phone: '+9661012345678', password: 'h2' },
      ]);

      await expect(
        service.login({
          identifier: '01012345678',
          password: 'anypassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('welcome email on account creation', () => {
    const originalClientId = process.env.GOOGLE_CLIENT_ID;

    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    });

    afterEach(() => {
      if (originalClientId === undefined) {
        delete process.env.GOOGLE_CLIENT_ID;
      } else {
        process.env.GOOGLE_CLIENT_ID = originalClientId;
      }
    });

    it('sends a welcome email after email/password signup', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'newuser@example.com',
        phone: null,
        name: 'New User',
      });
      const welcomeSpy = jest
        .spyOn(service as any, 'sendWelcomeEmail')
        .mockResolvedValue(true);

      const res = await service.signup({
        email: 'newuser@example.com',
        password: 'super-secret-1',
        name: 'New User',
      } as any);

      expect(res.accessToken).toBe('mock-jwt-token');
      expect(welcomeSpy).toHaveBeenCalledWith('newuser@example.com', 'New User');
    });

    it('still completes signup when the welcome email cannot be sent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-new-2',
        email: 'nosmtp@example.com',
        phone: null,
        name: null,
      });
      const welcomeSpy = jest
        .spyOn(service as any, 'sendWelcomeEmail')
        .mockResolvedValue(false);

      const res = await service.signup({
        email: 'nosmtp@example.com',
        password: 'super-secret-1',
      } as any);

      expect(res.accessToken).toBe('mock-jwt-token');
      expect(welcomeSpy).toHaveBeenCalled();
    });

    it('sends a welcome email when a Google sign-in creates a new account', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            email: 'fresh@gmail.com',
            email_verified: true,
            name: 'Fresh User',
            picture: null,
          }),
        }),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-google-new',
        email: 'fresh@gmail.com',
        name: 'Fresh User',
        avatarUrl: null,
      });
      const welcomeSpy = jest
        .spyOn(service as any, 'sendWelcomeEmail')
        .mockResolvedValue(true);

      const res = await service.googleLogin({
        credential: 'valid-google-id-token',
      });

      expect(res.success).toBe(true);
      expect(welcomeSpy).toHaveBeenCalledWith('fresh@gmail.com', 'Fresh User');
    });

    it('does NOT send a welcome email when a Google sign-in matches an existing account', async () => {
      const mockOAuthClient = {
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            email: 'returning@gmail.com',
            email_verified: true,
            name: 'Returning User',
            picture: null,
          }),
        }),
      } as unknown as OAuth2Client;
      service.setGoogleClient(mockOAuthClient);

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-google-existing',
        email: 'returning@gmail.com',
        emailVerified: true,
        name: 'Returning User',
        avatarUrl: null,
      });
      const welcomeSpy = jest
        .spyOn(service as any, 'sendWelcomeEmail')
        .mockResolvedValue(true);

      const res = await service.googleLogin({
        credential: 'valid-google-id-token',
      });

      expect(res.success).toBe(true);
      expect(welcomeSpy).not.toHaveBeenCalled();
    });

    it('resolves the SMTP host to IPv4 itself (nodemailer 10 picks a random family and Railway cannot route IPv6)', async () => {
      const original = {
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
      };
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_USER = 'sender@example.com';
      process.env.SMTP_PASS = 'app-password';

      const nodemailer = require('nodemailer');
      const transportSpy = jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) });
      const dns = require('dns').promises;
      const resolveSpy = jest
        .spyOn(dns, 'resolve4')
        .mockResolvedValue(['142.250.1.1']);

      try {
        const sent = await (service as any).sendSmtpEmail(
          'user@example.com',
          'Subject',
          'text',
          '<p>html</p>',
          'Test email',
        );

        expect(sent).toBe(true);
        expect(resolveSpy).toHaveBeenCalledWith('smtp.gmail.com');
        // Connects to the IPv4 address directly, with the real hostname as
        // the TLS servername so certificate validation still matches.
        expect(transportSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            host: '142.250.1.1',
            servername: 'smtp.gmail.com',
          }),
        );
      } finally {
        transportSpy.mockRestore();
        resolveSpy.mockRestore();
        for (const [key, value] of Object.entries(original)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    });

    it('falls back to the hostname when the IPv4 lookup fails', async () => {
      const original = {
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
      };
      process.env.SMTP_HOST = 'smtp.offline.example';
      process.env.SMTP_USER = 'sender@example.com';
      process.env.SMTP_PASS = 'app-password';

      const nodemailer = require('nodemailer');
      const transportSpy = jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) });
      const dns = require('dns').promises;
      const resolveSpy = jest
        .spyOn(dns, 'resolve4')
        .mockRejectedValue(new Error('ENOTFOUND'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const sent = await (service as any).sendSmtpEmail(
          'user@example.com',
          'Subject',
          'text',
          '<p>html</p>',
          'Test email',
        );

        expect(sent).toBe(true);
        expect(transportSpy).toHaveBeenCalledWith(
          expect.objectContaining({ host: 'smtp.offline.example' }),
        );
      } finally {
        transportSpy.mockRestore();
        resolveSpy.mockRestore();
        warnSpy.mockRestore();
        for (const [key, value] of Object.entries(original)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    });
  });


  describe('single-admin flag sync on login', () => {
    const original = process.env.ADMIN_EMAIL;

    afterEach(() => {
      if (original === undefined) {
        delete process.env.ADMIN_EMAIL;
      } else {
        process.env.ADMIN_EMAIL = original;
      }
    });

    it('promotes the configured admin account on login', async () => {
      process.env.ADMIN_EMAIL = 'owner@example.com';
      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-owner',
        email: 'owner@example.com',
        isAdmin: false,
        password: 'hashed',
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-owner',
        email: 'owner@example.com',
        isAdmin: true,
        password: 'hashed',
      });

      const res = await service.login({
        identifier: 'owner@example.com',
        password: 'whatever-123',
      } as any);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-owner' },
        data: { isAdmin: true },
      });
      expect(res.user.isAdmin).toBe(true);
    });

    it('demotes an account whose email is not the configured admin', async () => {
      process.env.ADMIN_EMAIL = 'owner@example.com';
      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-stale-admin',
        email: 'someone-else@example.com',
        isAdmin: true,
        password: 'hashed',
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-stale-admin',
        email: 'someone-else@example.com',
        isAdmin: false,
        password: 'hashed',
      });

      const res = await service.login({
        identifier: 'someone-else@example.com',
        password: 'whatever-123',
      } as any);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-stale-admin' },
        data: { isAdmin: false },
      });
      expect(res.user.isAdmin).toBe(false);
    });

    it('never promotes anyone when ADMIN_EMAIL is unset', async () => {
      delete process.env.ADMIN_EMAIL;
      const bcrypt = require('bcrypt');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-plain',
        email: 'owner@example.com',
        isAdmin: false,
        password: 'hashed',
      });

      await service.login({
        identifier: 'owner@example.com',
        password: 'whatever-123',
      } as any);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('Resend email provider', () => {
    const ENV_KEYS = ['RESEND_API_KEY', 'RESEND_FROM'];
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = {};
      for (const key of ENV_KEYS) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }
    });

    it('sends through the Resend HTTPS API when RESEND_API_KEY is set', async () => {
      process.env.RESEND_API_KEY = 're_test_key';
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('{"id":"email-1"}', { status: 200 }));

      const sent = await (service as any).sendSmtpEmail(
        'user@example.com',
        'Subject',
        'text body',
        '<p>html</p>',
        'Test email',
      );

      expect(sent).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, any];
      expect(url).toBe('https://api.resend.com/emails');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer re_test_key');
      const payload = JSON.parse(init.body as string);
      expect(payload.to).toEqual(['user@example.com']);
      expect(payload.subject).toBe('Subject');
      expect(payload.from).toContain('onboarding@resend.dev');
    });

    it('uses RESEND_FROM as the sender when configured', async () => {
      process.env.RESEND_API_KEY = 're_test_key';
      process.env.RESEND_FROM = 'JustSpeak <verify@justspeak.app>';
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));

      await (service as any).sendSmtpEmail(
        'user@example.com',
        'S',
        't',
        '<p>h</p>',
        'Test email',
      );

      const resendInit = fetchSpy.mock.calls[0][1] as any;
      expect(JSON.parse(resendInit.body as string).from).toBe(
        'JustSpeak <verify@justspeak.app>',
      );
    });

    it('falls back to SMTP when the Resend API rejects the send', async () => {
      process.env.RESEND_API_KEY = 're_test_key';
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_USER = 'sender@example.com';
      process.env.SMTP_PASS = 'app-password';
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('{"message":"invalid"}', { status: 422 }));
      const nodemailer = require('nodemailer');
      const transportSpy = jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) });
      jest
        .spyOn(require('dns').promises, 'resolve4')
        .mockResolvedValue(['142.250.1.1']);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const sent = await (service as any).sendSmtpEmail(
        'user@example.com',
        'S',
        't',
        '<p>h</p>',
        'Test email',
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(transportSpy).toHaveBeenCalled();
      expect(sent).toBe(true);
      warnSpy.mockRestore();
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });

    it('skips Resend and uses SMTP when no API key is configured', async () => {
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_USER = 'sender@example.com';
      process.env.SMTP_PASS = 'app-password';
      const fetchSpy = jest.spyOn(global, 'fetch');
      const nodemailer = require('nodemailer');
      const transportSpy = jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) });
      jest
        .spyOn(require('dns').promises, 'resolve4')
        .mockResolvedValue(['142.250.1.1']);

      const sent = await (service as any).sendSmtpEmail(
        'user@example.com',
        'S',
        't',
        '<p>h</p>',
        'Test email',
      );

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(sent).toBe(true);
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
    });
  });
});
