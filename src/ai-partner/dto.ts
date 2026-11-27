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

  /**
   * Goal-driven roleplay scenario (see content/roleplays.ts).
   * MUST carry a validator decorator: the global ValidationPipe uses
   * whitelist:true and silently strips any property without one. Without it
   * the scenario was dropped on every start (the coach improvised, the report
   * had no goal and programme progress never counted).
   */
  @IsOptional()
  @IsString()
  @MaxLength(96)
  roleplayId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  level?: string;
}
