import { Throttle } from '@nestjs/throttler';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import {
  UpdateProfileDto,
  JoinTribeDto,
  UpdateSubscriptionDto,
  ConsumeAiTokensDto,
  AiStudioTurnDto,
  SavePartnerMemoDto,
} from './dto';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  @ApiOperation({ summary: 'Get current user dashboard summary, stats, and tier info' })
  async getDashboard(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getDashboard(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('leaderboard')
  @ApiOperation({ summary: 'Get global user leaderboard rankings and user position' })
  async getLeaderboard(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getLeaderboard(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tribe')
  @ApiOperation({ summary: 'Join or switch language practice tribe' })
  async joinTribe(@Req() req: any, @Body() dto: JoinTribeDto) {
    const userId = req.user.sub;
    return this.usersService.joinTribe(userId, dto.tribeId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  @ApiOperation({ summary: 'Update user profile (name, avatar, bio, language level)' })
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const userId = req.user.sub;
    return this.usersService.updateProfile(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('blocked')
  @ApiOperation({ summary: 'List all blocked users' })
  async getBlockedUsers(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getBlockedUsers(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('blocked/:blockedId')
  @ApiOperation({ summary: 'Unblock a user by ID' })
  async unblockUser(@Req() req: any, @Param('blockedId') blockedId: string) {
    const userId = req.user.sub;
    return this.usersService.unblockUser(userId, blockedId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('buddy/:buddyId')
  @ApiOperation({ summary: 'Add or remove a user from practice buddies' })
  async toggleBuddy(@Req() req: any, @Param('buddyId') buddyId: string) {
    const userId = req.user.sub;
    return this.usersService.toggleBuddy(userId, buddyId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('buddies')
  @ApiOperation({ summary: 'Get list of practice buddies' })
  async getBuddies(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getBuddies(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscription')
  @ApiOperation({ summary: 'Upgrade or change subscription tier (FREE, PRO, UNLIMITED)' })
  async upgradeSubscription(@Req() req: any, @Body() dto: UpdateSubscriptionDto) {
    const userId = req.user.sub;
    return this.usersService.upgradeSubscription(userId, dto.planTier);
  }

  @UseGuards(JwtAuthGuard)
  @Post('ai-tokens/consume')
  @ApiOperation({ summary: 'Deduct AI tokens for AI practice sessions' })
  async consumeAiTokens(@Req() req: any, @Body() dto: ConsumeAiTokensDto) {
    const userId = req.user.sub;
    return this.usersService.consumeAiStudioTokens(userId, dto.amount);
  }

  @UseGuards(JwtAuthGuard)
  @Post('ai-studio/turn')
  @ApiOperation({ summary: 'Interact with AI English conversation coach' })
  async generateAiCoachTurn(@Req() req: any, @Body() dto: AiStudioTurnDto) {
    const userId = req.user.sub;
    return this.usersService.generateAiCoachTurn(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('memos')
  @ApiOperation({ summary: 'Retrieve private partner notes and memos' })
  async getMemos(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getMemos(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('memos')
  @ApiOperation({ summary: 'Save or update private memo about a practice partner' })
  async saveMemo(@Req() req: any, @Body() dto: SavePartnerMemoDto) {
    const userId = req.user.sub;
    return this.usersService.saveMemo(userId, dto.partnerId, dto.memo);
  }

  @UseGuards(JwtAuthGuard)
  @Get('academy-progress')
  @ApiOperation({ summary: 'Get user cloud-synced CEFR Academy progress and global scores' })
  async getAcademyProgress(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getAcademyProgress(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('academy-progress')
  @ApiOperation({ summary: 'Save and cloud-sync user CEFR Academy progress across devices' })
  async saveAcademyProgress(@Req() req: any, @Body() body: any) {
    const userId = req.user.sub;
    return this.usersService.saveAcademyProgress(userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('translate-word')
  @ApiOperation({ summary: 'Auto-detect Arabic or English word and return translation, definition, and example' })
  async translateWord(
    @Req() _req: any,
    @Body() body: { text: string },
  ) {
    return this.usersService.translateCustomWord(body?.text || '');
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('change-password')
  @ApiOperation({ summary: 'Change password for authenticated user' })
  async changePassword(
    @Req() req: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    const userId = req.user.sub;
    return this.usersService.changePassword(
      userId,
      body?.currentPassword || '',
      body?.newPassword || '',
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me')
  @ApiOperation({ summary: 'Permanently delete authenticated user account and associated data' })
  async deleteOwnAccount(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.deleteOwnAccount(userId);
  }
}
