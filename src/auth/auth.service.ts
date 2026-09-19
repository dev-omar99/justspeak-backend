import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import twilio from 'twilio';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma.service';
import { SignupDto, LoginDto, GoogleAuthDto } from './dto';

export interface SafeUser {
  id: string;
  email: string | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

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
    const phone = dto.phone ? this.normalizePhone(dto.phone, dto.countryCode) : null;

    if (!email && !phone) {
      throw new BadRequestException('Please provide either an email address or a phone number to register.');
    }

    if (email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email },
      });
      if (existingEmail) {
        throw new ConflictException('An account with this email already exists.');
      }
    }

    if (phone) {
      const existingPhone = await this.prisma.user.findUnique({
        where: { phone },
      });
      if (existingPhone) {
        throw new ConflictException('An account with this phone number already exists.');
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: email || null,
        phone: phone || null,
        countryCode: dto.countryCode || null,
        name: dto.name?.trim() || null,
        country: dto.country?.trim() || null,
        password: hashedPassword,
      },
    });

    const accessToken = this.generateToken(user.id, user.email || user.phone || user.id);

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

      user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { phone: input },
            { phone: normalizedPhone },
            ...(withoutLeadingZero.length >= 7 ? [{ phone: { endsWith: withoutLeadingZero } }] : []),
            { email: input.toLowerCase() },
          ],
        },
      });
    }


    if (!user) {
      throw new UnauthorizedException('Invalid credentials. Please check your email or phone number and password.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials. Please check your email or phone number and password.');
    }

    const accessToken = this.generateToken(user.id, user.email || user.phone || user.id);

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
      console.log(`[SMS INFO] Twilio credentials not configured in .env. Real SMS skipped for ${phone}.`);
      return false;
    }

    try {
      const client = twilio(accountSid, authToken);
      const message = await client.messages.create({
        body: `رمز التحقق الخاص بك في JustSpeak هو: ${code}\nصالح لمدة 10 دقائق.`,
        from: fromNumber,
        to: phone,
      });
      console.log(`[REAL SMS SENT] SID: ${message.sid} to ${phone}`);
      return true;
    } catch (err: any) {
      console.error(`[REAL SMS ERROR] Failed to send SMS to ${phone}:`, err?.message || err);
      return false;
    }
  }

  private async dispatchRealEmail(email: string, code: string): Promise<boolean> {
    const smtpHost = process.env.SMTP_HOST?.trim();
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER?.trim();
    const smtpPass = process.env.SMTP_PASS?.trim();
    const fromEmail = process.env.SMTP_FROM?.trim() || smtpUser || 'no-reply@justspeak.app';

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log(`[EMAIL INFO] SMTP credentials not configured in .env. Real email skipped for ${email}.`);
      return false;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: `"JustSpeak" <${fromEmail}>`,
        to: email,
        subject: `JustSpeak - رمز التحقق الخاص بك: ${code}`,
        text: `رمز التحقق الخاص بك في JustSpeak هو: ${code} (صالح لمدة 10 دقائق)`,
        html: `
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
      });
      console.log(`[REAL EMAIL SENT] Verification email sent to ${email}`);
      return true;
    } catch (err: any) {
      console.error(`[REAL EMAIL ERROR] Failed to send email to ${email}:`, err?.message || err);
      return false;
    }
  }

  async sendOtp(dto: { identifier: string; type?: 'email' | 'phone'; countryCode?: string }) {
    let identifier = dto.identifier.trim();
    if (!identifier) {
      throw new BadRequestException('Please provide an email or phone number.');
    }

    if (identifier.includes('@')) {
      identifier = identifier.toLowerCase();
    } else {
      identifier = this.normalizePhone(identifier, dto.countryCode);
    }

    // Rate-limit: Check if an OTP was generated within the last 60 seconds
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentOtp = await this.prisma.otpCode.findFirst({
      where: {
        identifier,
        createdAt: { gte: oneMinuteAgo },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      const secondsLeft = Math.ceil((recentOtp.createdAt.getTime() + 60000 - Date.now()) / 1000);
      throw new BadRequestException(`Please wait ${secondsLeft > 0 ? secondsLeft : 60} seconds before requesting a new code.`);
    }

    // Generate random 6-digit PIN code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    await this.prisma.otpCode.create({
      data: {
        identifier,
        code,
        expiresAt,
      },
    });

    // Dispatch real SMS or Email
    let isRealSent = false;
    if (identifier.includes('@')) {
      isRealSent = await this.dispatchRealEmail(identifier, code);
    } else {
      isRealSent = await this.dispatchRealSms(identifier, code);
    }

    console.log(`\n========================================`);
    console.log(`[JUSTSPEAK OTP] Sent code to ${identifier}: ${code} (Real Dispatch: ${isRealSent ? 'SUCCESS' : 'DEV/SIMULATED'})`);
    console.log(`========================================\n`);

    return {
      success: true,
      message: identifier.includes('@')
        ? (isRealSent ? `تم إرسال رمز التحقق إلى بريدك الإلكتروني (${identifier})` : `تم إرسال رمز التحقق إلى بريدك الإلكتروني (${identifier})`)
        : (isRealSent ? `تم إرسال رمز التحقق إلى هاتفك (${identifier}) عبر رسالة نصية SMS` : `تم إرسال رمز التحقق إلى هاتفك (${identifier}) عبر رسالة نصية SMS`),
      identifier,
      isRealSent,
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
    let identifier = dto.identifier.trim();
    if (!identifier) {
      throw new BadRequestException('Identifier is required.');
    }

    if (identifier.includes('@')) {
      identifier = identifier.toLowerCase();
    } else {
      identifier = this.normalizePhone(identifier, dto.countryCode);
    }

    const code = dto.code.trim();

    // Verify against DB
    const validOtp = await this.prisma.otpCode.findFirst({
      where: {
        identifier,
        code,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!validOtp) {
      throw new BadRequestException('Invalid or expired verification code. Please check and try again.');
    }

    // Mark as verified
    await this.prisma.otpCode.update({
      where: { id: validOtp.id },
      data: { verified: true },
    });

    // If password provided, complete signup
    if (dto.password) {
      const isEmail = identifier.includes('@');
      const email = isEmail ? identifier : null;
      const phone = !isEmail ? identifier : null;

      if (email) {
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
          throw new ConflictException('An account with this email already exists. Please log in.');
        }
      }

      if (phone) {
        const existing = await this.prisma.user.findUnique({ where: { phone } });
        if (existing) {
          throw new ConflictException('An account with this phone number already exists. Please log in.');
        }
      }

      const hashedPassword = await bcrypt.hash(dto.password, 10);
      const user = await this.prisma.user.create({
        data: {
          email,
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

    // If no password provided, check if user exists to log them in or just confirm verification
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { phone: identifier },
        ],
      },
    });

    if (existingUser) {
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

  async googleLogin(dto: GoogleAuthDto): Promise<AuthResult & { success: boolean; message: string }> {
    let email = dto.email ? dto.email.toLowerCase().trim() : '';
    let name = dto.name ? dto.name.trim() : '';
    let avatarUrl = dto.avatarUrl || null;

    // If Google JWT credential provided, decode the payload
    if (dto.credential) {
      try {
        const parts = dto.credential.split('.');
        if (parts.length === 3) {
          const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
          const googlePayload = JSON.parse(payloadStr);
          if (googlePayload && googlePayload.email) {
            email = googlePayload.email.toLowerCase().trim();
            name = googlePayload.name || name;
            avatarUrl = googlePayload.picture || avatarUrl;
          }
        }
      } catch (err) {
        console.warn('Failed to parse Google JWT credential payload:', err);
      }
    }

    if (!email) {
      throw new BadRequestException('A valid Google email address is required.');
    }

    // Check if user already exists
    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // First time Google user: create user account with a secure random hash
      const randomPassword = randomBytes(24).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await this.prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          avatarUrl: avatarUrl,
          country: dto.country?.trim() || null,
          password: hashedPassword,
        },
      });
    } else if (avatarUrl && !user.avatarUrl) {
      // Update avatar if not set yet
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl },
      });
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