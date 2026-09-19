import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeedbackService } from './feedback.service';
import { SubmitFeedbackDto } from './dto';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async submitFeedback(@Req() req: any, @Body() dto: SubmitFeedbackDto) {
    const giverId = req.user.sub;
    return this.feedbackService.submitFeedback(giverId, dto);
  }
}
