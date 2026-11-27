import { Controller, Get, Delete, Patch, Post, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { PlanTierId } from '../users/subscription-store';

/** The AdminGuard attaches the verified JWT payload ({ sub, email }) here. */
interface AdminRequest {
  user: { sub: string; email: string };
}

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'Admin: Get list of all registered users' })
  async getUsers() {
    return this.adminService.getAllUsers();
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Admin: Full detail of one user (profile, plan, quota, counts)' })
  async getUserDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Admin: Retrieve platform overview statistics and metrics' })
  async getStats() {
    return this.adminService.getStats();
  }

  @Patch('users/:id/subscription')
  @ApiOperation({ summary: 'Admin: Manually update user subscription plan or AI token balance' })
  async updateUserSubscription(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: { planTier?: PlanTierId; aiTokensBalance?: number; addTokens?: number },
  ) {
    return this.adminService.updateUserSubscription(id, body, req.user.email);
  }

  @Post('users/:id/ai-quota-offset')
  @ApiOperation({ summary: 'Admin: Set AI partner free-quota offset (grants sessions without deleting history)' })
  async setAiQuotaOffset(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: { offset: number },
  ) {
    return this.adminService.setAiQuotaOffset(req.user.email, id, body?.offset ?? 0);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Admin: Delete a user (the admin account itself is protected)' })
  async deleteUser(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.adminService.deleteUser(id, req.user.email);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Admin: List P2P practice sessions, newest first' })
  async getSessions(@Query('take') take?: string, @Query('skip') skip?: string) {
    return this.adminService.getSessions(Number(take) || 20, Number(skip) || 0);
  }

  @Get('live')
  @ApiOperation({ summary: 'Admin: Live P2P rooms and active AI sessions right now' })
  async getLiveOverview() {
    return this.adminService.getLiveOverview();
  }

  @Get('ai-sessions')
  @ApiOperation({ summary: 'Admin: List AI partner sessions with optional status/user filters' })
  async getAiSessions(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.adminService.getAiSessions({
      status,
      userId,
      take: Number(take) || undefined,
      skip: Number(skip) || undefined,
    });
  }

  @Get('ai-sessions/:id')
  @ApiOperation({ summary: 'Admin: One AI session in full (transcript, metrics, report, recordings)' })
  async getAiSessionDetail(@Param('id') id: string) {
    return this.adminService.getAiSessionDetail(id);
  }

  @Post('ai-sessions/:id/force-end')
  @ApiOperation({ summary: 'Admin: Force-end a stuck active AI session (keeps all data)' })
  async forceEndAiSession(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.adminService.forceEndAiSession(req.user.email, id);
  }

  @Get('recordings')
  @ApiOperation({ summary: 'Admin: List AI session recordings' })
  async getRecordings(
    @Query('userId') userId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.adminService.getRecordings({
      userId,
      take: Number(take) || undefined,
      skip: Number(skip) || undefined,
    });
  }

  @Get('feedback')
  @ApiOperation({ summary: 'Admin: List P2P session feedback (peer reports)' })
  async getFeedback(@Query('take') take?: string, @Query('skip') skip?: string) {
    return this.adminService.getFeedback(Number(take) || 20, Number(skip) || 0);
  }

  @Get('audit-log')
  @ApiOperation({ summary: 'Admin: Audit trail of admin actions' })
  async getAuditLog(@Query('take') take?: string, @Query('skip') skip?: string) {
    return this.adminService.getAuditLog(Number(take) || 50, Number(skip) || 0);
  }
}
