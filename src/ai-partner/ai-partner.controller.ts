import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiPartnerService } from './ai-partner.service';
import { RecordingService } from './recording.service';
import { recordingsMaxBytes } from './ai-partner.config';
import { StartSessionDto } from './dto';
import { PERSONAS } from './content/personas';
import { INTERVIEW_FIELDS } from './content/interview-bank';
import { ROLEPLAY_SCENARIOS } from './content/roleplays';
import { HALF_LEVELS, SAMPLE_LESSONS, LESSONS_PER_HALF_LEVEL } from './content/course';
import { aiPartnerEnabled } from './ai-partner.config';
import { PROGRAMMES } from './content/programmes';
import { buildProgrammes } from './programmes.progress';
import { buildCatalog } from './catalog';

@ApiTags('AI Partner')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('ai-partner')
export class AiPartnerController {
  constructor(
    private readonly aiPartner: AiPartnerService,
    private readonly recordings: RecordingService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Feature flag and configuration status for the client' })
  status() {
    return {
      enabled: aiPartnerEnabled(),
      recordingStorage: this.recordings.storageConfigured(),
      personas: PERSONAS.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        tagline: p.tagline,
        bestFor: p.bestFor,
      })),
      interviewFields: INTERVIEW_FIELDS.map((f) => ({ id: f.id, title: f.title })),
      roleplays: ROLEPLAY_SCENARIOS.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        description: r.description,
        persona: r.persona,
        personaRole: r.personaRole,
        level: r.level,
        goal: r.goal,
        rubric: r.rubric,
      })),
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
  async list(@Req() req: any, @Query('limit') limit?: string) {
    const sessions = await this.aiPartner.listSessions(
      req.user.sub,
      limit ? parseInt(limit, 10) : 20,
    );
    const withRecordings = new Set(
      await this.recordings.sessionsWithRecordings(
        req.user.sub,
        sessions.map((session: { id: string }) => session.id),
      ),
    );
    return sessions.map((session: { id: string }) => ({
      ...session,
      hasRecordings: withRecordings.has(session.id),
    }));
  }

  @Get('programmes')
  @ApiOperation({ summary: 'Learning programmes with the learner\'s derived progress (read only)' })
  async programmes(@Req() req: any) {
    this.aiPartner.assertEnabled();
    const sessions = await this.aiPartner.sessionsForProgress(req.user.sub);
    return { programmes: buildProgrammes(PROGRAMMES, sessions) };
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Fields > programmes > levels > lessons with attempts and derived progress (read only)' })
  async catalog(@Req() req: any) {
    this.aiPartner.assertEnabled();
    const sessions = await this.aiPartner.sessionsForCatalog(req.user.sub);
    return { fields: buildCatalog(sessions) };
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'One session with transcript, metrics and report' })
  get(@Req() req: any, @Param('id') id: string) {
    return this.aiPartner.getOwnedSession(id, req.user.sub);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Weekly progress dashboard: sessions, minutes, scores, weaknesses' })
  dashboard(@Req() req: any) {
    return this.aiPartner.getDashboard(req.user.sub);
  }

  @Post('sessions/upload')
  @ApiOperation({ summary: 'Analyse an uploaded audio recording like a session' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  upload(@Req() req: any, @UploadedFile() file?: { buffer: Buffer; mimetype: string; originalname: string }) {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Attach an audio file as multipart field "file".');
    }
    return this.aiPartner.analyzeUpload(req.user.sub, file);
  }

  @Post('sessions/:id/recordings/start')
  @ApiOperation({ summary: 'Reserve a session recording and get an upload plan' })
  startRecording(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { kind?: string; mimeType?: string },
  ) {
    return this.recordings.start(id, req.user.sub, body?.kind ?? '', body?.mimeType ?? '');
  }

  @Post('recordings/:rid/blob')
  @ApiOperation({ summary: 'Relay upload of a recording blob (local storage mode)' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: recordingsMaxBytes() } }),
  )
  uploadRecordingBlob(
    @Req() req: any,
    @Param('rid') rid: string,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Attach the recording as multipart field "file".');
    }
    return this.recordings.saveBlob(rid, req.user.sub, file.buffer);
  }

  @Post('recordings/:rid/complete')
  @ApiOperation({ summary: 'Mark a recording upload finished' })
  completeRecording(
    @Req() req: any,
    @Param('rid') rid: string,
    @Body() body: { bytes?: number; durationMs?: number },
  ) {
    return this.recordings.complete(
      rid,
      req.user.sub,
      Number(body?.bytes ?? 0),
      Number(body?.durationMs ?? 0),
    );
  }

  @Get('sessions/:id/recordings')
  @ApiOperation({ summary: 'Playable recordings of one session, in order' })
  listRecordings(@Req() req: any, @Param('id') id: string) {
    return this.recordings.list(id, req.user.sub);
  }

  @Get('recordings/:rid/playback')
  @ApiOperation({ summary: 'Short-lived playback URL for a recording' })
  playbackRecording(@Req() req: any, @Param('rid') rid: string) {
    return this.recordings.playback(rid, req.user.sub);
  }

  @Get('recordings/:rid/blob')
  @ApiOperation({ summary: 'Stream a recording blob (local storage mode)' })
  async streamRecordingBlob(@Req() req: any, @Param('rid') rid: string, @Res() res: any) {
    const blob = await this.recordings.openBlob(rid, req.user.sub);
    res.setHeader('content-type', blob.mimeType || 'application/octet-stream');
    if (blob.bytes > 0) res.setHeader('content-length', String(blob.bytes));
    blob.stream.pipe(res);
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
