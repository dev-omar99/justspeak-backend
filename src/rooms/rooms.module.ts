import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { SignalingGateway } from './signaling.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RoomsController],
  providers: [RoomsService, SignalingGateway],
  exports: [RoomsService, SignalingGateway],
})
export class RoomsModule {}