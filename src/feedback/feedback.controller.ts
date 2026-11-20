import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeedbackService } from './feedback.service';
import { SubmitFeedbackDto } from './dto';

@ApiTags('Feedback')
@ApiBearerAuth('JWT-auth')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: 'Submit rating, language badges, and review for partner after conversation' })
  @ApiResponse({ status: 201, description: 'Feedback recorded and partner XP/reputation updated' })
  async submitFeedback(@Req() req: any, @Body() dto: SubmitFeedbackDto) {
    const giverId = req.user.sub;
    return this.feedbackService.submitFeedback(giverId, dto);
  }
}
