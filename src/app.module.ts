import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RoomsModule } from './rooms/rooms.module';
import { AdminModule } from './admin/admin.module';
import { FeedbackModule } from './feedback/feedback.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [AuthModule, RoomsModule, AdminModule, FeedbackModule, UsersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
