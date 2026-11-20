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

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  async getDashboard(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getDashboard(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('leaderboard')
  async getLeaderboard(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getLeaderboard(userId);
  }


  @UseGuards(JwtAuthGuard)
  @Post('tribe')
  async joinTribe(@Req() req: any, @Body() dto: JoinTribeDto) {
    const userId = req.user.sub;
    return this.usersService.joinTribe(userId, dto.tribeId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const userId = req.user.sub;
    return this.usersService.updateProfile(userId, dto);
  }


  @UseGuards(JwtAuthGuard)
  @Get('blocked')
  async getBlockedUsers(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getBlockedUsers(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('blocked/:blockedId')
  async unblockUser(@Req() req: any, @Param('blockedId') blockedId: string) {
    const userId = req.user.sub;
    return this.usersService.unblockUser(userId, blockedId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('buddy/:buddyId')
  async toggleBuddy(@Req() req: any, @Param('buddyId') buddyId: string) {
    const userId = req.user.sub;
    return this.usersService.toggleBuddy(userId, buddyId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('buddies')
  async getBuddies(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getBuddies(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscription')
  async upgradeSubscription(@Req() req: any, @Body() dto: UpdateSubscriptionDto) {
    const userId = req.user.sub;
    return this.usersService.upgradeSubscription(userId, dto.planTier);
  }

  @UseGuards(JwtAuthGuard)
  @Post('ai-tokens/consume')
  async consumeAiTokens(@Req() req: any, @Body() dto: ConsumeAiTokensDto) {
    const userId = req.user.sub;
    return this.usersService.consumeAiStudioTokens(userId, dto.amount);
  }

  @UseGuards(JwtAuthGuard)
  @Post('ai-studio/turn')
  async generateAiCoachTurn(@Req() req: any, @Body() dto: AiStudioTurnDto) {
    const userId = req.user.sub;
    return this.usersService.generateAiCoachTurn(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('memos')
  async getMemos(@Req() req: any) {
    const userId = req.user.sub;
    return this.usersService.getMemos(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('memos')
  async saveMemo(@Req() req: any, @Body() dto: SavePartnerMemoDto) {
    const userId = req.user.sub;
    return this.usersService.saveMemo(userId, dto.partnerId, dto.memo);
  }
}

