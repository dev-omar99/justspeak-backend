import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
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

@ApiTags('Rooms')
@ApiBearerAuth('JWT-auth')
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  @ApiOperation({ summary: 'Create a direct practice room and generate Daily.co WebRTC credentials' })
  async createRoom(@Req() req: any): Promise<CreatedRoom> {
    const userId = req.user.sub;
    return this.roomsService.createRoom(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('queue')
  @ApiOperation({ summary: 'Enter matching queue to pair with an online speaking partner' })
  async joinQueue(
    @Req() req: any,
    @Body() dto: JoinQueueDto,
  ): Promise<QueueStatus> {
    const userId = req.user.sub;
    return this.roomsService.joinQueue(userId, !!dto?.differentCountryOnly);
  }

  @UseGuards(JwtAuthGuard)
  @Post('buddy-call')
  @ApiOperation({ summary: 'Initiate a direct 1-on-1 practice call with an added buddy' })
  async callBuddy(
    @Req() req: any,
    @Body() dto: BuddyCallDto,
  ): Promise<CreatedRoom> {
    const userId = req.user.sub;
    return this.roomsService.createBuddyCall(userId, dto.buddyId, dto.topic);
  }

  @UseGuards(JwtAuthGuard)
  @Post('leave')
  @ApiOperation({ summary: 'Cancel queue search and leave matchmaking queue' })
  async leaveQueue(@Req() req: any): Promise<{ success: boolean }> {
    const userId = req.user.sub;
    await this.roomsService.leaveQueue(userId);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('recover-ticket')
  @ApiOperation({ summary: 'Recover call ticket when a peer disconnects prematurely' })
  async recoverTicket(
    @Req() req: any,
    @Body() dto: RecoverTicketDto,
  ): Promise<{ success: boolean; ticketsLeft: number }> {
    const userId = req.user.sub;
    return this.roomsService.recoverTicket(userId, dto?.sessionId);
  }
}
