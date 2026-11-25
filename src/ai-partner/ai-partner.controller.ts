import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiPartnerService } from './ai-partner.service';
import { StartSessionDto } from './dto';
import { PERSONAS } from './content/personas';
import { INTERVIEW_FIELDS } from './content/interview-bank';
import { HALF_LEVELS, SAMPLE_LESSONS, LESSONS_PER_HALF_LEVEL } from './content/course';
import { aiPartnerEnabled } from './ai-partner.config';

@ApiTags('AI Partner')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('ai-partner')
export class AiPartnerController {
  constructor(private readonly aiPartner: AiPartnerService) {}

  @Get('status')
  @ApiOperation({ summary: 'Feature flag and configuration status for the client' })
  status() {
    return {
      enabled: aiPartnerEnabled(),
      personas: PERSONAS.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        tagline: p.tagline,
        bestFor: p.bestFor,
      })),
      interviewFields: INTERVIEW_FIELDS.map((f) => ({ id: f.id, title: f.title })),
      halfLevels: HALF_LEVELS,
      lessonsPerHalfLevel: LESSONS_PER_HALF_LEVEL,
      availableLessons: SAMPLE_LESSONS.map((l) => ({
        id: l.id,
        halfLevel: l.halfLevel,
        title: l.title,
        goal: l.goal,
      })),
    };
  }

  @Get('quota')
  @ApiOperation({ summary: 'Remaining AI sessions for the current user' })
  quota(@Req() req: any) {
    return this.aiPartner.getQuota(req.user.sub);
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Create an AI Partner session (enforces plan quota)' })
  start(@Req() req: any, @Body() dto: StartSessionDto) {
    this.aiPartner.assertEnabled();
    return this.aiPartner.startSession(req.user.sub, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Recent AI Partner sessions for the current user' })
  list(@Req() req: any, @Query('limit') limit?: string) {
    return this.aiPartner.listSessions(req.user.sub, limit ? parseInt(limit, 10) : 20);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'One session with transcript, metrics and report' })
  get(@Req() req: any, @Param('id') id: string) {
    return this.aiPartner.getOwnedSession(id, req.user.sub);
  }

  @Post('sessions/:id/report')
  @ApiOperation({ summary: 'Generate or fetch the end-of-session feedback report' })
  report(@Req() req: any, @Param('id') id: string) {
    this.aiPartner.assertEnabled();
    return this.aiPartner.generateReport(id, req.user.sub);
  }

  @Post('sessions/:id/placement')
  @ApiOperation({ summary: 'Score a placement session with the stronger model' })
  placement(@Req() req: any, @Param('id') id: string) {
    this.aiPartner.assertEnabled();
    return this.aiPartner.generatePlacementReport(id, req.user.sub);
  }
}
