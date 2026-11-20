import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Length,
  Matches,
  IsOptional,
  IsNotEmpty,
  IsIn,
} from 'class-validator';

export class SignupDto {
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString({ message: 'Phone number must be a valid string' })
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;

  @IsString({ message: 'Password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(72, { message: 'Password must not exceed 72 characters' })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}

export class LoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(254)
  identifier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;

  @IsString({ message: 'Password is required' })
  @MaxLength(72)
  password: string;
}

export class SendOtpDto {
  @IsString({ message: 'Identifier (email or phone) is required' })
  @IsNotEmpty({ message: 'Identifier (email or phone) is required' })
  @MaxLength(254)
  identifier: string;

  @IsOptional()
  @IsString()
  @IsIn(['email', 'phone'])
  type?: 'email' | 'phone';

  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;
}

export class VerifyOtpDto {
  @IsString({ message: 'Identifier (email or phone) is required' })
  @IsNotEmpty({ message: 'Identifier (email or phone) is required' })
  @MaxLength(254)
  identifier: string;

  @IsString({ message: '6-digit verification code is required' })
  @Length(6, 6, { message: 'Code must be 6 digits' })
  @Matches(/^\d{6}$/, { message: 'Code must be a 6-digit number' })
  code: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(72, { message: 'Password must not exceed 72 characters' })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;
}

export class GoogleAuthDto {
  @IsNotEmpty({ message: 'Google credential (ID token) is required' })
  @IsString({ message: 'Google credential must be a valid string' })
  @MaxLength(4096)
  credential: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;
}

export class ResetPasswordDto {
  @IsString({ message: 'Identifier (email or phone) is required' })
  @IsNotEmpty({ message: 'Identifier (email or phone) is required' })
  @MaxLength(254)
  identifier: string;

  @IsString({ message: '6-digit verification code is required' })
  @Length(6, 6, { message: 'Code must be 6 digits' })
  @Matches(/^\d{6}$/, { message: 'Code must be a 6-digit number' })
  code: string;

  @IsString({ message: 'New password is required' })
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  @MaxLength(72, { message: 'Password must not exceed 72 characters' })
  newPassword: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;
}
