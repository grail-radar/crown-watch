import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../moderation/admin.guard';
import { DigestSenderService } from './digest-sender.service';
import { DigestService } from './digest.service';

@Controller('digest')
export class DigestController {
  constructor(
    private readonly digest: DigestService,
    private readonly sender: DigestSenderService,
  ) {}

  /** Public signup for the weekly digest. Body: { email } */
  @Post('subscribe')
  @HttpCode(200)
  subscribe(@Body() body: { email?: unknown }) {
    return this.digest.subscribe(body?.email);
  }

  /** Public unsubscribe via the tokenized link in every email. */
  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  unsubscribe(@Query('token') token?: string) {
    return this.sender.unsubscribe(token);
  }

  /** Admin: send the weekly digest (?dryRun=true to compose without sending). */
  @Post('send')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  send(@Query('dryRun') dryRun?: string, @Query('force') force?: string) {
    return this.sender.send({
      dryRun: dryRun === 'true',
      force: force === 'true',
    });
  }

  /** Admin: preview this week's digest HTML in the browser. */
  @Get('preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @UseGuards(AdminGuard)
  preview() {
    return this.sender.preview();
  }
}
