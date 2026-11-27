import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));
// Keep DNS offline in this spec: the IPv4 self-resolution must fail fast
// and fall back to the hostname instead of hitting the network.
jest.mock('dns', () => {
  const actual = jest.requireActual('dns');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      resolve4: jest.fn().mockRejectedValue(new Error('ENOTFOUND')),
    },
  };
});
import * as nodemailer from 'nodemailer';

/**
 * Regression test for the email hang: when Railway cannot reach SMTP,
 * sendMail must fail within seconds (transport timeouts) so sendOtp falls
 * back to the devCode path instead of spinning for ~2 minutes.
 */
describe('AuthService SMTP timeouts', () => {
  const env = process.env;
  let service: AuthService;

  const mockPrisma = {
    otpCode: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = {
      ...env,
      SMTP_HOST: 'smtp.unreachable.example',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    process.env = env;
  });

  it('creates the SMTP transport with 8s connection/greeting/socket timeouts', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

    await service.sendOtp({ identifier: 'user@example.com' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000,
      }),
    );
  });

  it('falls back to devCode immediately when SMTP dispatch fails', async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValue(new Error('Connection timeout'));
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const started = Date.now();
    const res = await service.sendOtp({ identifier: 'user@example.com' });

    expect(Date.now() - started).toBeLessThan(5000);
    expect(res.isRealSent).toBe(false);
    expect(res.devCode).toMatch(/^\d{6}$/);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
