import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoomsService, CreatedRoom, QueueStatus } from './rooms.service';

export class JoinQueueDto {
  @IsOptional()
  @IsBoolean()
  differentCountryOnly?: boolean;
}

export class BuddyCallDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  buddyId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;
}

export class RecoverTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;
}

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  async createRoom(@Req() req: any): Promise<CreatedRoom> {
    const userId = req.user.sub;
    return this.roomsService.createRoom(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('queue')
  async joinQueue(
    @Req() req: any,
    @Body() dto: JoinQueueDto,
  ): Promise<QueueStatus> {
    const userId = req.user.sub;
    return this.roomsService.joinQueue(userId, !!dto?.differentCountryOnly);
  }

  @UseGuards(JwtAuthGuard)
  @Post('buddy-call')
  async callBuddy(
    @Req() req: any,
    @Body() dto: BuddyCallDto,
  ): Promise<CreatedRoom> {
    const userId = req.user.sub;
    return this.roomsService.createBuddyCall(userId, dto.buddyId, dto.topic);
  }

  @UseGuards(JwtAuthGuard)
  @Post('leave')
  async leaveQueue(@Req() req: any): Promise<{ success: boolean }> {
    const userId = req.user.sub;
    await this.roomsService.leaveQueue(userId);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('recover-ticket')
  async recoverTicket(
    @Req() req: any,
    @Body() dto: RecoverTicketDto,
  ): Promise<{ success: boolean; ticketsLeft: number }> {
    const userId = req.user.sub;
    return this.roomsService.recoverTicket(userId, dto?.sessionId);
  }
}