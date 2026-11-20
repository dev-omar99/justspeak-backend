import { Test, TestingModule } from '@nestjs/testing';
import { APP_GUARD, Reflector } from '@nestjs/core';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController & Rate Limiting (H2 / Section 5)', () => {
  let controller: AuthController;
  let guard: ThrottlerGuard;

  const mockAuthService = {
    signup: jest.fn().mockResolvedValue({ access_token: 'tok' }),
    login: jest.fn().mockResolvedValue({ access_token: 'tok' }),
    sendOtp: jest.fn().mockResolvedValue({ success: true }),
    verifyOtp: jest.fn().mockResolvedValue({ verified: true }),
    googleLogin: jest.fn().mockResolvedValue({ access_token: 'tok' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'default',
            ttl: 60000,
            limit: 120,
          },
        ]),
      ],
      controllers: [AuthController],
      providers: [
        Reflector,
        { provide: AuthService, useValue: mockAuthService },
        ThrottlerGuard,
        {
          provide: APP_GUARD,
          useExisting: ThrottlerGuard,
        },
      ],
    }).compile();

    await module.init();

    controller = module.get<AuthController>(AuthController);
    guard = module.get<ThrottlerGuard>(ThrottlerGuard);
  });

  function createExecutionContext(
    handlerName: keyof AuthController,
    ip = '127.0.0.1',
  ): ExecutionContext {
    const req = { ip, headers: {} };
    const res = { header: jest.fn() };
    return {
      getClass: () => AuthController,
      getHandler: () => controller[handlerName] as any,
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
        getNext: () => jest.fn(),
      }),
      getType: () => 'http',
      getArgs: () => [req, res],
      getArgByIndex: (index: number) => (index === 0 ? req : res),
      switchToRpc: () => ({} as any),
      switchToWs: () => ({} as any),
    } as unknown as ExecutionContext;
  }

  it('should enforce strict @Throttle limit (5 per 60s) on POST /auth/send-otp', async () => {
    const ctx = createExecutionContext('sendOtp', '10.0.0.50');

    // First 5 requests within 60s window succeed
    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }

    // 6th request within 60s window is rejected with ThrottlerException (HTTP 429)
    await expect(guard.canActivate(ctx)).rejects.toThrow(ThrottlerException);
  });

  it('should enforce @Throttle limit (10 per 60s) on POST /auth/verify-otp and POST /auth/login', async () => {
    const verifyCtx = createExecutionContext('verifyOtp', '10.0.0.51');
    for (let i = 0; i < 10; i++) {
      await expect(guard.canActivate(verifyCtx)).resolves.toBe(true);
    }
    await expect(guard.canActivate(verifyCtx)).rejects.toThrow(
      ThrottlerException,
    );

    const loginCtx = createExecutionContext('login', '10.0.0.52');
    for (let i = 0; i < 10; i++) {
      await expect(guard.canActivate(loginCtx)).resolves.toBe(true);
    }
    await expect(guard.canActivate(loginCtx)).rejects.toThrow(
      ThrottlerException,
    );
  });
});
