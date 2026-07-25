import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SubmissionInput, SubmissionsService } from './submissions.service';

@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  /** Public "submit a drop" — heavily throttled; lands in the moderation queue. */
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  submit(@Body() body: SubmissionInput) {
    return this.submissions.submit(body ?? {});
  }
}
