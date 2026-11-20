import {
  IsEnum,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { LevelFeedback, PartnerRating } from '@prisma/client';

export class SubmitFeedbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
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
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  compliments?: string[];
}

