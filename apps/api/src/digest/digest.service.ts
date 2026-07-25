import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Weekly-digest email capture (CONTEXT.md §7.4). No sending yet — list only. */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent subscribe. Always returns ok for a valid address (re-subscribing
   * is a no-op) so responses don't reveal whether an email was already known.
   */
  async subscribe(rawEmail: unknown): Promise<{ ok: true }> {
    const email =
      typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 320) {
      throw new BadRequestException('Please provide a valid email address.');
    }
    await this.prisma.digestSubscriber.upsert({
      where: { email },
      update: {},
      create: { email },
    });
    this.logger.log(`Digest subscriber added/confirmed`);
    return { ok: true };
  }
}
