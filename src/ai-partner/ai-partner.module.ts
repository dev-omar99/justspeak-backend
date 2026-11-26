import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma.module';
import { AiPartnerController } from './ai-partner.controller';
import { AiPartnerGateway } from './ai-partner.gateway';
import { AiPartnerService } from './ai-partner.service';
import { ClaudeService } from './claude.service';
import { ConversationService } from './conversation.service';
import { DeepgramPrerecordedService, DeepgramService } from './deepgram.service';
import { TtsService } from './tts.service';
import { PronunciationService } from './pronunciation.service';

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [AiPartnerController],
  providers: [
    AiPartnerGateway,
    AiPartnerService,
    ClaudeService,
    ConversationService,
    DeepgramService,
    DeepgramPrerecordedService,
    TtsService,
    PronunciationService,
  ],
})
export class AiPartnerModule {}
