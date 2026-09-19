import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class SignupDto {
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'Phone number must be a valid string' })
  phone?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsString({ message: 'Password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class LoginDto {
  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsString({ message: 'Password is required' })
  password: string;
}

export class SendOtpDto {
  @IsString({ message: 'Identifier (email or phone) is required' })
  identifier: string;

  @IsOptional()
  @IsString()
  type?: 'email' | 'phone';

  @IsOptional()
  @IsString()
  countryCode?: string;
}

export class VerifyOtpDto {
  @IsString({ message: 'Identifier (email or phone) is required' })
  identifier: string;

  @IsString({ message: '6-digit verification code is required' })
  @MinLength(6, { message: 'Code must be 6 digits' })
  code: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;
}

export class GoogleAuthDto {
  @IsOptional()
  @IsString()
  credential?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  country?: string;
}