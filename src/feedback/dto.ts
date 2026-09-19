import { IsEnum, IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';
import { LevelFeedback, PartnerRating } from '@prisma/client';

export class SubmitFeedbackDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  partnerId: string;

  @IsEnum(LevelFeedback, {
    message: 'levelFeedback must be HIGHER, SAME, or LOWER',
  })
  levelFeedback: LevelFeedback;

  @IsEnum(PartnerRating, {
    message: 'partnerRating must be LIKED, NEUTRAL, or BLOCKED',
  })
  partnerRating: PartnerRating;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  compliments?: string[];
}

