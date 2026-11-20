import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  SignupDto,
  LoginDto,
  SendOtpDto,
  VerifyOtpDto,
  GoogleAuthDto,
  ResetPasswordDto,
} from './dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('signup')
  @ApiOperation({ summary: 'Register a new user with email or phone' })
  @ApiResponse({ status: 201, description: 'User registered successfully and OTP sent' })
  @ApiResponse({ status: 400, description: 'Validation error or user already exists' })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  @ApiOperation({ summary: 'Log in with credentials' })
  @ApiResponse({ status: 200, description: 'Login successful, returns JWT token or requires OTP' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('send-otp')
  @ApiOperation({ summary: 'Send OTP code via Email (SMTP) or SMS (Twilio)' })
  @ApiResponse({ status: 200, description: 'OTP code dispatched successfully' })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('verify-otp')
  @ApiOperation({ summary: 'Verify OTP code to complete registration or login' })
  @ApiResponse({ status: 200, description: 'Code verified, returns access token and user profile' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP code' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Post('google')
  @ApiOperation({ summary: 'Sign in or register with Google OAuth ID token' })
  @ApiResponse({ status: 200, description: 'Authenticated successfully with Google' })
  @ApiResponse({ status: 401, description: 'Invalid Google credential token' })
  googleAuth(@Body() dto: GoogleAuthDto) {
    return this.authService.googleLogin(dto);
  }

  @Throttle({ default: { limit: 8, ttl: 60000 } })
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using verified OTP code' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid code or password requirements not met' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
