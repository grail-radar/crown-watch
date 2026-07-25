import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DigestService } from './digest.service';

@Controller('digest')
export class DigestController {
  constructor(private readonly digest: DigestService) {}

  /** Public signup for the weekly digest. Body: { email } */
  @Post('subscribe')
  @HttpCode(200)
  subscribe(@Body() body: { email?: unknown }) {
    return this.digest.subscribe(body?.email);
  }
}
