import {
  Logger,
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomInt, timingSafeEqual } from 'crypto';
import twilio from 'twilio';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma.service';
import { SignupDto, LoginDto, GoogleAuthDto, ResetPasswordDto } from './dto';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

export interface SafeUser {
  id: string;
  email: string | null;
  emailVerified?: boolean;
  phone: string | null;
  countryCode: string | null;
  name: string | null;
  country: string | null;
  englishLevel: string | null;
  isAdmin: boolean;
  avatarUrl: string | null;
  bio: string | null;
  ticketsLeft: number;
  tribeId: number | null;
  createdAt: Date;
}

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  public static readonly MAX_OTP_ATTEMPTS = 5;
  public static readonly MAX_OTP_REQUESTS_PER_WINDOW = 5;
  public static readonly OTP_RATE_WINDOW_MS = 15 * 60 * 1000;

  private googleClient = new OAuth2Client();
  private otpAttemptState = new Map<
    string,
    { count: number; expiresAt: number }
  >();
  private otpRequestHistory = new Map<string, number[]>();
  private inFlightOtps = new Set<string>();
  private consumedOtps = new Set<string>();

  setGoogleClient(client: OAuth2Client) {
    this.googleClient = client;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private maskIdentifier(identifier: string): string {
    if (identifier.includes('@')) {
      const [local, domain] = identifier.split('@');
      const maskedLocal =
        local.length <= 2 ? `${local[0] || '*'}*` : `${local.slice(0, 2)}***`;
      return `${maskedLocal}@${domain}`;
    }
    if (identifier.length <= 4) return '****';
    return `${identifier.slice(0, 3)}***${identifier.slice(-2)}`;
  }

  private safeCompareCodes(expected: string, actual: string): boolean {
    const a = Buffer.from(String(expected));
    const b = Buffer.from(String(actual));
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  private recordFailedOtpAttempt(identifier: string): number {
    const now = Date.now();
    const existing = this.otpAttemptState.get(identifier);
    if (!existing || now > existing.expiresAt) {
      const next = { count: 1, expiresAt: now + 10 * 60 * 1000 };
      this.otpAttemptState.set(identifier, next);
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  private normalizePhone(phone: string, countryCode?: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '').trim();
    if (cleaned.startsWith('+')) {
      return cleaned;
    }
    if (cleaned.startsWith('00')) {
      return '+' + cleaned.slice(2);
    }
    const prefix = (countryCode || '').trim();
    if (prefix) {
      const formattedPrefix = prefix.startsWith('+') ? prefix : `+${prefix}`;
      if (cleaned.startsWith('0')) {
        cleaned = cleaned.slice(1);
      }
      return `${formattedPrefix}${cleaned}`;
    }
    return cleaned;
  }

  private generateToken(userId: string, identifier: string): string {
    const payload = { sub: userId, email: identifier };
    return this.jwtService.sign(payload);
  }

  private sanitizeUser(user: any): SafeUser {
    const { password, ...safeUser } = user;
    return safeUser as SafeUser;
  }

  async signup(dto: SignupDto): Promise<AuthResult> {
    const email = dto.email ? dto.email.toLowerCase().trim() : null;
    const phone = dto.phone
      ? this.normalizePhone(dto.phone, dto.countryCode)
      : null;

    if (!email && !phone) {
      throw new BadRequestException(
        'Please provide either an email address or a phone number to register.',
      );
    }

    if (email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingEmail) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
    }

    if (phone) {
      const existingPhone = await this.prisma.user.findUnique({
        where: { phone },
      });
      if (existingPhone) {
        throw new ConflictException(
          'An account with this phone number already exists.',
        );
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: email || null,
        emailVerified: false,
        phone: phone || null,
        countryCode: dto.countryCode || null,
        name: dto.name?.trim() || null,
        country: dto.country?.trim() || null,
        password: hashedPassword,
      },
    });

    const accessToken = this.generateToken(
      user.id,
      user.email || user.phone || user.id,
    );

    // Best-effort welcome email; never blocks or fails the signup.
    if (user.email) {
      await this.sendWelcomeEmail(user.email, user.name);
    }

    return {
      user: this.sanitizeUser(user),
      accessToken,
    };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const input = (dto.identifier || dto.email || dto.phone || '').trim();
    if (!input) {
      throw new BadRequestException('Please enter your email or phone number.');
    }

    let user: any = null;

    if (input.includes('@')) {
      user = await this.prisma.user.findUnique({
        where: { email: input.toLowerCase() },
      });
    } else {
      const normalizedPhone = this.normalizePhone(input, dto.countryCode);
      const digitsOnly = input.replace(/\D/g, '');
      const withoutLeadingZero = digitsOnly.replace(/^0+/, '');

      // Prefer exact phone match first
      user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { phone: input },
            { phone: normalizedPhone },
            { email: input.toLowerCase() },
          ],
        },
      });

      // Only fall back to suffix match when unambiguous
      if (!user && withoutLeadingZero.length >= 8) {
        if (typeof (this.prisma.user as any).findMany === 'function') {
          const candidates = await this.prisma.user.findMany({
            where: { phone: { endsWith: withoutLeadingZero } },
            take: 2,
          });
          if (candidates.length === 1) {
            user = candidates[0];
          }
        } else {
          user = await this.prisma.user.findFirst({
            where: { phone: { endsWith: withoutLeadingZero } },
          });
        }
      }
    }

    if (!user) {
      throw new UnauthorizedException(
        'Invalid credentials. Please check your email or phone number and password.',
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException(
        'Invalid credentials. Please check your email or phone number and password.',
      );
    }

    const accessToken = this.generateToken(
      user.id,
      user.email || user.phone || user.id,
    );

    return {
      user: this.sanitizeUser(user),
      accessToken,
    };
  }

  private async dispatchRealSms(phone: string, code: string): Promise<boolean> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim();

    if (!accountSid || !authToken || !fromNumber) {
      this.logger.log(
        `[SMS INFO] Twilio credentials not configured in .env. Real SMS skipped for ${this.maskIdentifier(phone)}.`,
      );
      return false;
    }

    try {
      const client = twilio(accountSid, authToken);
      const message = await client.messages.create({
        body: `رمز التحقق الخاص بك في JustSpeak هو: ${code}\nصالح لمدة 10 دقائق.`,
        from: fromNumber,
        to: phone,
      });
      this.logger.log(
        `[REAL SMS SENT] SID: ${message.sid} to ${this.maskIdentifier(phone)}`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(
        `[REAL SMS ERROR] Failed to send SMS to ${this.maskIdentifier(phone)}: ${err?.message || 'SMS dispatch error'}`,
      );
      return false;
    }
  }

  /**
   * Build an SMTP transporter from environment configuration.
   * Returns null when SMTP is not configured so callers can skip quietly.
   */
  private createSmtpTransport(): {
    transporter: nodemailer.Transporter;
    fromEmail: string;
  } | null {
    const smtpHost = process.env.SMTP_HOST?.trim();
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER?.trim();
    const smtpPass = process.env.SMTP_PASS?.trim();
    const fromEmail =
      process.env.SMTP_FROM?.trim() || smtpUser || 'no-reply@justspeak.app';

    if (!smtpHost || !smtpUser || !smtpPass) {
      return null;
    }

    // Railway containers cannot route IPv6, and smtp.gmail.com resolves
    // to IPv6 first, so without `family: 4` the connect dies with
    // ENETUNREACH. The option is passed through to the socket but is not
    // declared in nodemailer's transport types.
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      family: 4,
      // Fail fast when SMTP is unreachable so callers fall back
      // in seconds instead of minutes.
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    } as Parameters<typeof nodemailer.createTransport>[0] & {
      family?: number;
    });

    return { transporter, fromEmail };
  }

  /**
   * Send a single transactional email over SMTP.
   * Never throws: returns false when SMTP is missing or the send fails,
   * so account flows (signup, OTP) are never blocked by email delivery.
   */
  private async sendSmtpEmail(
    to: string,
    subject: string,
    text: string,
    html: string,
    logLabel: string,
  ): Promise<boolean> {
    const transport = this.createSmtpTransport();
    if (!transport) {
      this.logger.log(
        `[EMAIL INFO] SMTP credentials not configured in .env. Real email skipped for ${this.maskIdentifier(to)}.`,
      );
      return false;
    }

    try {
      await transport.transporter.sendMail({
        from: `"JustSpeak" <${transport.fromEmail}>`,
        to,
        subject,
        text,
        html,
      });
      this.logger.log(
        `[REAL EMAIL SENT] ${logLabel} sent to ${this.maskIdentifier(to)}`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(
        `[REAL EMAIL ERROR] Failed to send ${logLabel} to ${this.maskIdentifier(to)}: ${err?.message || 'Email dispatch error'}`,
      );
      return false;
    }
  }

  private async dispatchRealEmail(
    email: string,
    code: string,
  ): Promise<boolean> {
    return this.sendSmtpEmail(
      email,
      `JustSpeak - رمز التحقق الخاص بك`,
      `رمز التحقق الخاص بك في JustSpeak هو: ${code} (صالح لمدة 10 دقائق)`,
      `
        <div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #2563EB; font-size: 24px; margin: 0; font-weight: 800;">JustSpeak</h2>
            <p style="color: #64748B; font-size: 14px; margin-top: 4px;">تأكيد الدخول / التسجيل</p>
          </div>
          <p style="font-size: 15px; color: #334155;">مرحباً بك،</p>
          <p style="font-size: 14px; color: #475569;">رمز التحقق الخاص بك لإتمام عملية التسجيل أو الدخول في تطبيق JustSpeak هو:</p>
          <div style="background-color: #F8FAFC; border: 2px dashed #2563EB; border-radius: 12px; padding: 18px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #0F172A; font-family: monospace;">${code}</span>
          </div>
          <p style="font-size: 13px; color: #64748B;">صالح لمدة 10 دقائق. يُرجى عدم مشاركة هذا الرمز مع أي شخص.</p>
        </div>
      `,
      'Verification email',
    );
  }

  /**
   * Welcome email sent once when a new account is created, through any
   * registration path (email/password signup or first Google sign-in).
   * Delivery is best-effort and never blocks account creation.
   */
  private async sendWelcomeEmail(
    email: string,
    name: string | null,
  ): Promise<boolean> {
    const displayName = (name || '').trim() || email.split('@')[0];
    return this.sendSmtpEmail(
      email,
      'مرحباً بك في JustSpeak',
      `أهلاً ${displayName}، تم إنشاء حسابك في JustSpeak بنجاح. يمكنك الآن بدء ممارسة الإنجليزية في أي وقت. Welcome to JustSpeak - your account is ready.`,
      `
        <div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #2563EB; font-size: 24px; margin: 0; font-weight: 800;">JustSpeak</h2>
            <p style="color: #64748B; font-size: 14px; margin-top: 4px;">ممارسة الإنجليزية بالمحادثة</p>
          </div>
          <p style="font-size: 15px; color: #334155;">أهلاً ${displayName}،</p>
          <p style="font-size: 14px; color: #475569;">تم إنشاء حسابك في JustSpeak بنجاح. يمكنك الآن بدء مكالمات المحادثة، والتدرّب مع المدرّب الصوتي، وحفظ كلماتك الجديدة - كل ذلك من حساب واحد.</p>
          <p style="font-size: 13px; color: #64748B;">إذا لم تنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة.</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p dir="ltr" style="font-size: 13px; color: #94A3B8; text-align: center;">Welcome to JustSpeak - your account is ready.</p>
        </div>
      `,
      'Welcome email',
    );
  }

  async sendOtp(dto: {
    identifier: string;
    type?: 'email' | 'phone';
    countryCode?: string;
  }) {
    let identifier = (dto.identifier || '').trim();
    if (!identifier) {
      throw new BadRequestException('Please provide an email or phone number.');
    }

    if (identifier.includes('@')) {
      identifier = identifier.toLowerCase();
    } else {
      identifier = this.normalizePhone(identifier, dto.countryCode);
    }

    const now = Date.now();

    // Sliding window rate-limit per identifier (max 5 OTP requests per 15 minutes)
    const history = (this.otpRequestHistory.get(identifier) || []).filter(
      (ts) => now - ts < AuthService.OTP_RATE_WINDOW_MS,
    );
    if (history.length >= AuthService.MAX_OTP_REQUESTS_PER_WINDOW) {
      throw new BadRequestException(
        'Too many verification code requests. Please wait a few minutes before trying again.',
      );
    }

    // Rate-limit: Check if an OTP was generated within the last 60 seconds
    const oneMinuteAgo = new Date(now - 60 * 1000);
    const recentOtp = await this.prisma.otpCode.findFirst({
      where: {
        identifier,
        createdAt: { gte: oneMinuteAgo },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      const secondsLeft = Math.ceil(
        (recentOtp.createdAt.getTime() + 60000 - now) / 1000,
      );
      throw new BadRequestException(
        `Please wait ${secondsLeft > 0 ? secondsLeft : 60} seconds before requesting a new code.`,
      );
    }

    // Invalidate any previous unverified OTPs for this identifier
    if (typeof (this.prisma.otpCode as any).updateMany === 'function') {
      await this.prisma.otpCode.updateMany({
        where: { identifier, verified: false },
        data: { expiresAt: new Date(0) },
      });
    }
    this.otpAttemptState.delete(identifier);

    // Cryptographically secure 6-digit PIN code using Node.js crypto.randomInt
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(now + 10 * 60 * 1000); // 10 minutes expiry

    await this.prisma.otpCode.create({
      data: {
        identifier,
        code,
        expiresAt,
      },
    });

    history.push(now);
    this.otpRequestHistory.set(identifier, history);

    // Dispatch real SMS or Email
    let isRealSent = false;
    if (identifier.includes('@')) {
      isRealSent = await this.dispatchRealEmail(identifier, code);
    } else {
      isRealSent = await this.dispatchRealSms(identifier, code);
    }

    // Never log OTP values, verification codes, passwords, or tokens
    this.logger.log(
      `[JUSTSPEAK OTP] Verification code generated for ${this.maskIdentifier(identifier)} (Real Dispatch: ${isRealSent ? 'SUCCESS' : 'DEV/SIMULATED'})`,
    );

    return {
      success: true,
      message: identifier.includes('@')
        ? `تم إرسال رمز التحقق إلى بريدك الإلكتروني (${identifier})`
        : `تم إرسال رمز التحقق إلى هاتفك (${identifier}) عبر رسالة نصية SMS`,
      identifier,
      isRealSent,
      devCode: !isRealSent ? code : undefined,
      cooldownSeconds: 60,
    };
  }

  async verifyOtp(dto: {
    identifier: string;
    code: string;
    password?: string;
    name?: string;
    country?: string;
    countryCode?: string;
  }) {
    let identifier = (dto.identifier || '').trim();
    if (!identifier) {
      throw new BadRequestException('Identifier is required.');
    }

    if (identifier.includes('@')) {
      identifier = identifier.toLowerCase();
    } else {
      identifier = this.normalizePhone(identifier, dto.countryCode);
    }

    const code = (dto.code || '').trim();
    const now = new Date();

    // Check in-memory attempt lockout for identifier
    const memState = this.otpAttemptState.get(identifier);
    if (
      memState &&
      now.getTime() <= memState.expiresAt &&
      memState.count >= AuthService.MAX_OTP_ATTEMPTS
    ) {
      if (typeof (this.prisma.otpCode as any).updateMany === 'function') {
        await this.prisma.otpCode.updateMany({
          where: { identifier, verified: false },
          data: { expiresAt: new Date(0) },
        });
      }
      throw new BadRequestException(
        'Too many failed verification attempts. Please request a new code.',
      );
    }

    if (!/^\d{6}$/.test(code)) {
      const attempts = this.recordFailedOtpAttempt(identifier);
      if (attempts >= AuthService.MAX_OTP_ATTEMPTS) {
        throw new BadRequestException(
          'Too many failed verification attempts. Please request a new code.',
        );
      }
      throw new BadRequestException(
        'Invalid or expired verification code. Please check and try again.',
      );
    }

    // Fetch latest active unverified OTP for identifier
    const activeOtp: any = await this.prisma.otpCode.findFirst({
      where: {
        identifier,
        verified: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (
      !activeOtp ||
      (activeOtp.expiresAt instanceof Date &&
        activeOtp.expiresAt.getTime() <= now.getTime()) ||
      activeOtp.verified === true
    ) {
      const attempts = this.recordFailedOtpAttempt(identifier);
      if (attempts >= AuthService.MAX_OTP_ATTEMPTS) {
        throw new BadRequestException(
          'Too many failed verification attempts. Please request a new code.',
        );
      }
      throw new BadRequestException(
        'Invalid or expired verification code. Please check and try again.',
      );
    }

    const currentDbAttempts =
      typeof activeOtp.attempts === 'number' ? activeOtp.attempts : 0;
    if (currentDbAttempts >= AuthService.MAX_OTP_ATTEMPTS) {
      if (typeof (this.prisma.otpCode as any).updateMany === 'function') {
        await this.prisma.otpCode.updateMany({
          where: { id: activeOtp.id },
          data: { expiresAt: new Date(0) },
        });
      }
      throw new BadRequestException(
        'Too many failed verification attempts. Please request a new code.',
      );
    }

    if (
      typeof activeOtp.code === 'string' &&
      !this.safeCompareCodes(activeOtp.code, code)
    ) {
      const memAttempts = this.recordFailedOtpAttempt(identifier);
      const nextAttempts = Math.max( currentDbAttempts + 1, memAttempts );
      const isExhausted = nextAttempts >= AuthService.MAX_OTP_ATTEMPTS;

      await this.prisma.otpCode.update({
        where: { id: activeOtp.id },
        data: isExhausted
          ? { attempts: nextAttempts, expiresAt: new Date(0) }
          : { attempts: nextAttempts },
      });

      if (isExhausted) {
        throw new BadRequestException(
          'Too many failed verification attempts. Please request a new code.',
        );
      }

      throw new BadRequestException(
        'Invalid or expired verification code. Please check and try again.',
      );
    }

    // Atomic single-use claim: guard against concurrent and repeated verification
    if (
      this.inFlightOtps.has(activeOtp.id) ||
      this.consumedOtps.has(activeOtp.id)
    ) {
      throw new BadRequestException(
        'Invalid or expired verification code. Please check and try again.',
      );
    }

    this.inFlightOtps.add(activeOtp.id);
    try {
      if (typeof (this.prisma.otpCode as any).updateMany === 'function') {
        const claimed = await this.prisma.otpCode.updateMany({
          where: {
            id: activeOtp.id,
            verified: false,
            expiresAt: { gt: now },
            attempts: { lt: AuthService.MAX_OTP_ATTEMPTS },
          },
          data: { verified: true },
        });
        if (
          claimed &&
          typeof claimed.count === 'number' &&
          claimed.count !== 1
        ) {
          throw new BadRequestException(
            'Invalid or expired verification code. Please check and try again.',
          );
        }
      }

      await this.prisma.otpCode.update({
        where: { id: activeOtp.id },
        data: { verified: true },
      });

      this.consumedOtps.add(activeOtp.id);
      this.otpAttemptState.delete(identifier);
    } finally {
      this.inFlightOtps.delete(activeOtp.id);
    }

    const isEmail = identifier.includes('@');

    // If password provided, complete signup or claim unverified email account
    if (dto.password) {
      const email = isEmail ? identifier : null;
      const phone = !isEmail ? identifier : null;

      if (email) {
        const existing: any = await this.prisma.user.findUnique({
          where: { email },
        });
        if (existing) {
          if (existing.emailVerified !== false) {
            throw new ConflictException(
              'An account with this email already exists. Please log in.',
            );
          }
          // Existing account had unverified email: real email owner verified via OTP,
          // so rotate password to the verified owner's password and mark emailVerified = true
          const hashedPassword = await bcrypt.hash(dto.password, 10);
          const reclaimedUser = await this.prisma.user.update({
            where: { id: existing.id },
            data: {
              password: hashedPassword,
              emailVerified: true,
              ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
              ...(dto.country?.trim() ? { country: dto.country.trim() } : {}),
            },
          });
          const accessToken = this.generateToken(reclaimedUser.id, identifier);
          return {
            success: true,
            user: this.sanitizeUser(reclaimedUser),
            accessToken,
            message: 'Account verified and activated successfully!',
          };
        }
      }

      if (phone) {
        const existing = await this.prisma.user.findUnique({
          where: { phone },
        });
        if (existing) {
          throw new ConflictException(
            'An account with this phone number already exists. Please log in.',
          );
        }
      }

      const hashedPassword = await bcrypt.hash(dto.password, 10);
      const user = await this.prisma.user.create({
        data: {
          email,
          emailVerified: isEmail,
          phone,
          countryCode: dto.countryCode || null,
          name: dto.name?.trim() || null,
          country: dto.country?.trim() || null,
          password: hashedPassword,
        },
      });

      const accessToken = this.generateToken(user.id, identifier);
      return {
        success: true,
        user: this.sanitizeUser(user),
        accessToken,
        message: 'Account verified and created successfully!',
      };
    }

    // If no password provided, check if user exists to log them in or confirm verification
    let existingUser: any = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { phone: identifier }],
      },
    });

    if (existingUser) {
      if (isEmail && existingUser.emailVerified === false) {
        // Prevent a pre-registration attacker from retaining password access
        const rotatedPassword = await bcrypt.hash(
          randomBytes(24).toString('hex'),
          10,
        );
        existingUser = await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            emailVerified: true,
            password: rotatedPassword,
          },
        });
      }
      const accessToken = this.generateToken(existingUser.id, identifier);
      return {
        success: true,
        user: this.sanitizeUser(existingUser),
        accessToken,
        message: 'Verified and logged in successfully!',
      };
    }

    return {
      success: true,
      verified: true,
      identifier,
      message: 'Code verified successfully.',
    };
  }

  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<AuthResult & { success: boolean; message: string }> {
    const rawInput = (dto.identifier || '').trim();
    if (!rawInput) {
      throw new BadRequestException('Please provide your email or phone number.');
    }

    const isEmail = rawInput.includes('@');
    const identifier = isEmail
      ? rawInput.toLowerCase()
      : this.normalizePhone(rawInput, dto.countryCode);

    const existingAttempts = this.otpAttemptState.get(identifier);
    const nowMs = Date.now();
    if (
      existingAttempts &&
      nowMs <= existingAttempts.expiresAt &&
      existingAttempts.count >= AuthService.MAX_OTP_ATTEMPTS
    ) {
      throw new BadRequestException(
        'Too many failed verification attempts. Please request a new code.',
      );
    }

    const activeOtp = await this.prisma.otpCode.findFirst({
      where: {
        identifier,
        verified: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!activeOtp) {
      this.recordFailedOtpAttempt(identifier);
      throw new BadRequestException(
        'Invalid or expired verification code. Please request a new code.',
      );
    }

    const now = new Date();
    const currentDbAttempts = Number((activeOtp as any).attempts || 0);

    if (
      now > activeOtp.expiresAt ||
      currentDbAttempts >= AuthService.MAX_OTP_ATTEMPTS
    ) {
      throw new BadRequestException(
        'Verification code has expired. Please request a new code.',
      );
    }

    if (!this.safeCompareCodes(activeOtp.code, dto.code.trim())) {
      const memAttempts = this.recordFailedOtpAttempt(identifier);
      const nextAttempts = Math.max(currentDbAttempts + 1, memAttempts);
      const isExhausted = nextAttempts >= AuthService.MAX_OTP_ATTEMPTS;

      await this.prisma.otpCode.update({
        where: { id: activeOtp.id },
        data: isExhausted
          ? { attempts: nextAttempts, expiresAt: new Date(0) }
          : { attempts: nextAttempts },
      });

      throw new BadRequestException(
        'Invalid verification code. Please check and try again.',
      );
    }

    const user: any = isEmail
      ? await this.prisma.user.findUnique({ where: { email: identifier } })
      : await this.prisma.user.findFirst({
          where: {
            OR: [{ phone: identifier }, { phone: rawInput }],
          },
        });

    if (!user) {
      throw new BadRequestException(
        'No account found with this email or phone number.',
      );
    }

    await this.prisma.otpCode.update({
      where: { id: activeOtp.id },
      data: { verified: true },
    });
    this.consumedOtps.add(activeOtp.id);
    this.otpAttemptState.delete(identifier);

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        ...(isEmail ? { emailVerified: true } : {}),
      },
    });

    const accessToken = this.generateToken(updatedUser.id, identifier);
    return {
      success: true,
      user: this.sanitizeUser(updatedUser),
      accessToken,
      message: 'Password reset successfully! You are now logged in.',
    };
  }

  async googleLogin(
    dto: GoogleAuthDto,
  ): Promise<AuthResult & { success: boolean; message: string }> {
    if (
      !dto.credential ||
      typeof dto.credential !== 'string' ||
      !dto.credential.trim()
    ) {
      throw new BadRequestException(
        'A valid Google credential (ID token) is required.',
      );
    }

    const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!googleClientId) {
      throw new InternalServerErrorException(
        'Google authentication is not properly configured on the server.',
      );
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.credential.trim(),
        audience: googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException(
        'Google authentication token verification failed.',
      );
    }

    if (!payload || !payload.email) {
      throw new UnauthorizedException(
        'Google ID token does not contain a valid email address.',
      );
    }

    if (!payload.email_verified) {
      throw new UnauthorizedException('Google email address is not verified.');
    }

    const email = payload.email.toLowerCase().trim();
    const name = payload.name ? payload.name.trim() : email.split('@')[0];
    const avatarUrl = payload.picture || null;

    // Check if user already exists
    let user: any = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // First time Google user: create user account with emailVerified = true and a secure random hash
      const randomPassword = randomBytes(24).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await this.prisma.user.create({
        data: {
          email,
          emailVerified: true,
          name: name || email.split('@')[0],
          avatarUrl: avatarUrl,
          country: dto.country?.trim() || null,
          password: hashedPassword,
        },
      });

      // First Google sign-in creates the account: send the same welcome
      // email a password signup receives. Best-effort, never blocking.
      await this.sendWelcomeEmail(email, user.name);
    } else {
      // Prevent an unverified email account from being automatically linked to a Google identity
      // solely because the email strings match.
      if (user.emailVerified === false) {
        throw new ConflictException(
          'An unverified account with this email already exists. Please verify your email via OTP before linking Google Sign-In.',
        );
      }

      if (avatarUrl && !user.avatarUrl) {
        // Update avatar if not set yet
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { avatarUrl },
        });
      }
    }

    const accessToken = this.generateToken(user.id, user.email || user.id);

    return {
      success: true,
      user: this.sanitizeUser(user),
      accessToken,
      message: 'Google authentication successful!',
    };
  }
}
