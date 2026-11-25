import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class StartSessionDto {
  @IsIn(['free-talk', 'interview', 'lesson'])
  mode!: 'free-talk' | 'interview' | 'lesson';

  @IsString()
  @MaxLength(32)
  personaId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  fieldId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  lessonId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  level?: string;
}
