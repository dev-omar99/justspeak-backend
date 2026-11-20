import { IsString, IsOptional, IsIn, MaxLength, IsInt, Min, Max } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  @IsOptional()
  @IsIn(['Beginner', 'Elementary', 'Intermediate', 'Upper-Intermediate', 'Advanced', 'Native'])
  englishLevel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  avatarUrl?: string;
}

export class JoinTribeDto {
  @IsInt()
  @Min(1)
  @Max(12)
  tribeId: number;
}

export class UpdateSubscriptionDto {
  @IsString()
  @IsIn(['FREE', 'PLUS', 'ELITE'])
  planTier: 'FREE' | 'PLUS' | 'ELITE';

  @IsOptional()
  @IsString()
  @IsIn(['monthly', 'annual'])
  billingCycle?: 'monthly' | 'annual';
}

export class ConsumeAiTokensDto {
  @IsInt()
  @Min(1)
  @Max(5000)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  topicId?: string;
}

export class AiStudioTurnDto {
  @IsString()
  @MaxLength(150)
  topicTitle: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsString()
  @MaxLength(1200)
  userMessage: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  turnIndex?: number;
}

export class SavePartnerMemoDto {
  @IsString()
  @MaxLength(100)
  partnerId: string;

  @IsString()
  @MaxLength(600)
  memo: string;
}



