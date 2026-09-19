import { Controller, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoomsService, CreatedRoom, QueueStatus } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  async createRoom(): Promise<CreatedRoom> {
    return this.roomsService.createRoom();
  }

  @UseGuards(JwtAuthGuard)
  @Post('queue')
  async joinQueue(
    @Req() req: any,
    @Body('differentCountryOnly') differentCountryOnly?: boolean,
  ): Promise<QueueStatus> {
    const userId = req.user.sub;
    return this.roomsService.joinQueue(userId, !!differentCountryOnly);
  }


  @UseGuards(JwtAuthGuard)
  @Post('buddy-call')
  async callBuddy(
    @Req() req: any,
    @Body('buddyId') buddyId: string,
    @Body('topic') topic?: string,
  ): Promise<CreatedRoom> {
    const userId = req.user.sub;
    return this.roomsService.createBuddyCall(userId, buddyId, topic);
  }

  @UseGuards(JwtAuthGuard)
  @Post('leave')
  async leaveQueue(@Req() req: any): Promise<{ success: boolean }> {
    const userId = req.user.sub;
    await this.roomsService.leaveQueue(userId);
    return { success: true };
  }
}
