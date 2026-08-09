import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModerationStatus } from '@prisma/client';
import { ABOUT_A_WATCH } from '../drops/about-a-watch';
import { PrismaService } from '../prisma/prisma.service';

const UNSUB_PLACEHOLDER = '{{UNSUB_URL}}';
const WINDOW_DAYS = 7;
const RESEND_BATCH_LIMIT = 100;
/** Refuse a second real send within this many days unless force=true. */
const RESEND_GUARD_DAYS = 5;

interface DigestDrop {
  title: string;
  type: string;
  priceLow: unknown;
  priceHigh: unknown;
  currency: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  brand: { name: string; slug: string };
}

export interface SendResult {
  sent: boolean;
  reason?: string;
  dropCount: number;
  recipientCount: number;
  subject?: string;
  failed?: number;
}

const TYPE_LABELS: Record<string, string> = {
  kickstarter_launch: 'Kickstarter',
  waitlist_open: 'Waitlist open',
  restock: 'Restock',
  pre_order: 'Pre-order',
};

/**
 * Weekly digest sender. Email goes out via Resend's HTTP API (free tier).
 * Without RESEND_API_KEY everything still composes (preview/dry-run) but
 * nothing sends. Every message carries a per-subscriber unsubscribe link.
 */
@Injectable()
export class DigestSenderService {
  private readonly logger = new Logger(DigestSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async dropsInWindow(): Promise<DigestDrop[]> {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
    return this.prisma.drop.findMany({
      where: {
        moderationStatus: ModerationStatus.approved,
        publishedAt: { gte: since },
        // A strap is not a release, and an inbox is no more able to unsend than
        // a Channel is (ADR-0006).
        ...ABOUT_A_WATCH,
      },
      orderBy: { publishedAt: 'desc' },
      select: {
        title: true,
        type: true,
        priceLow: true,
        priceHigh: true,
        currency: true,
        imageUrl: true,
        sourceUrl: true,
        brand: { select: { name: true, slug: true } },
      },
    });
  }

  private price(drop: DigestDrop): string | null {
    const low = drop.priceLow ? String(drop.priceLow) : null;
    const high = drop.priceHigh ? String(drop.priceHigh) : null;
    if (!low && !high) return null;
    const cur = drop.currency ? ` ${drop.currency}` : '';
    if (low && high && low !== high) return `${low}–${high}${cur}`;
    return `${low ?? high}${cur}`;
  }

  /** Build subject + HTML + plain text (with an unsubscribe placeholder). */
  compose(drops: DigestDrop[]): { subject: string; html: string; text: string } {
    const web = this.config.get<string>('digest.publicWebUrl')!;
    const n = drops.length;
    const names = [...new Set(drops.map((d) => d.brand.name))];
    const lead = names.slice(0, 2).join(', ');
    const subject =
      n === 1
        ? `1 new microbrand drop this week: ${lead}`
        : `${n} new microbrand drops this week: ${lead}${names.length > 2 ? ' & more' : ''}`;

    const rows = drops
      .map((d) => {
        const link = d.sourceUrl ?? `${web}/brands/${d.brand.slug}`;
        const price = this.price(d);
        const meta = [TYPE_LABELS[d.type] ?? d.type, price]
          .filter(Boolean)
          .join(' · ');
        const img = d.imageUrl
          ? `<img src="${d.imageUrl}" width="132" alt="" style="display:block;width:132px;height:82px;object-fit:cover;border-radius:8px;background:#eceae3;" />`
          : `<div style="width:132px;height:82px;border-radius:8px;background:#eceae3;"></div>`;
        return `
          <tr>
            <td style="padding:14px 0;border-top:1px solid #e7e4db;vertical-align:top;width:132px;">
              <a href="${link}" target="_blank">${img}</a>
            </td>
            <td style="padding:14px 0 14px 16px;border-top:1px solid #e7e4db;vertical-align:top;">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#b08d4f;font-weight:600;">${d.brand.name}</div>
              <div style="margin-top:3px;font-size:15px;line-height:1.35;">
                <a href="${link}" target="_blank" style="color:#22211d;text-decoration:none;font-weight:600;">${d.title}</a>
              </div>
              <div style="margin-top:5px;font-size:12px;color:#8a877e;">${meta}</div>
            </td>
          </tr>`;
      })
      .join('');

    const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f4ef;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;padding:32px 32px 24px;font-family:Georgia,'Times New Roman',serif;color:#22211d;">
        <tr><td>
          <div style="font-size:20px;"><span style="color:#b08d4f;">Crown</span> Watch</div>
          <div style="margin-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a877e;">The weekly microbrand drop radar</div>
          <div style="margin-top:22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#44423c;">
            ${n === 1 ? 'One new drop' : `${n} new drops`} cleared the radar this week — every one from an independent watchmaker, straight from the brand's own store.
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;font-family:Arial,Helvetica,sans-serif;">
            ${rows}
          </table>
          <div style="margin-top:22px;">
            <a href="${web}/#drops" target="_blank" style="display:inline-block;background:#b08d4f;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;padding:10px 18px;border-radius:10px;text-decoration:none;">See all drops on the radar</a>
          </div>
          <div style="margin-top:28px;border-top:1px solid #e7e4db;padding-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#a09d94;">
            You're receiving this because you joined the Crown Watch digest.
            Headlines and images belong to their publishers and link to the original coverage.<br/>
            <a href="${UNSUB_PLACEHOLDER}" style="color:#a09d94;">Unsubscribe</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const text = [
      `Crown Watch — ${n} new microbrand drop${n === 1 ? '' : 's'} this week`,
      '',
      ...drops.map((d) => {
        const price = this.price(d);
        const link = d.sourceUrl ?? `${web}/brands/${d.brand.slug}`;
        return `• ${d.brand.name} — ${d.title} (${TYPE_LABELS[d.type] ?? d.type}${price ? `, ${price}` : ''})\n  ${link}`;
      }),
      '',
      `All drops: ${web}/#drops`,
      `Unsubscribe: ${UNSUB_PLACEHOLDER}`,
    ].join('\n');

    return { subject, html, text };
  }

  /** Send the weekly digest to all active subscribers. */
  async send(options: { dryRun?: boolean; force?: boolean }): Promise<SendResult> {
    const apiKey = this.config.get<string>('digest.resendApiKey');
    const from = this.config.get<string>('digest.from')!;
    const apiUrl = this.config.get<string>('digest.publicApiUrl')!;

    const drops = await this.dropsInWindow();
    const subscribers = await this.prisma.digestSubscriber.findMany({
      where: { unsubscribedAt: null },
      select: { email: true, unsubscribeToken: true },
    });
    const base: SendResult = {
      sent: false,
      dropCount: drops.length,
      recipientCount: subscribers.length,
    };

    if (drops.length === 0) return { ...base, reason: 'no drops published in the last 7 days' };
    const { subject, html, text } = this.compose(drops);
    if (options.dryRun) return { ...base, subject, reason: 'dry run — nothing sent' };
    if (subscribers.length === 0) return { ...base, subject, reason: 'no active subscribers' };
    if (!apiKey) return { ...base, subject, reason: 'RESEND_API_KEY not configured' };

    if (!options.force) {
      const last = await this.prisma.digestSend.findFirst({
        where: { dryRun: false },
        orderBy: { sentAt: 'desc' },
      });
      if (
        last &&
        Date.now() - last.sentAt.getTime() < RESEND_GUARD_DAYS * 24 * 3600 * 1000
      ) {
        return {
          ...base,
          subject,
          reason: `already sent ${last.sentAt.toISOString()} — pass force=true to resend`,
        };
      }
    }

    let delivered = 0;
    let failed = 0;
    for (let i = 0; i < subscribers.length; i += RESEND_BATCH_LIMIT) {
      const chunk = subscribers.slice(i, i + RESEND_BATCH_LIMIT);
      const payload = chunk.map((s) => {
        const unsub = `${apiUrl}/digest/unsubscribe?token=${s.unsubscribeToken}`;
        return {
          from,
          to: [s.email],
          subject,
          html: html.split(UNSUB_PLACEHOLDER).join(unsub),
          text: text.split(UNSUB_PLACEHOLDER).join(unsub),
        };
      });
      try {
        const res = await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          failed += chunk.length;
          this.logger.error(`Resend batch failed: HTTP ${res.status} ${await res.text()}`);
        } else {
          delivered += chunk.length;
        }
      } catch (err) {
        failed += chunk.length;
        this.logger.error(`Resend batch error: ${err instanceof Error ? err.message : err}`);
      }
    }

    await this.prisma.digestSend.create({
      data: {
        dropCount: drops.length,
        recipientCount: delivered,
        dryRun: false,
      },
    });
    this.logger.log(`Digest sent: ${delivered} delivered, ${failed} failed, ${drops.length} drops`);
    return { ...base, sent: delivered > 0, subject, recipientCount: delivered, failed };
  }

  /** Render the digest HTML for in-browser preview (unsubscribe link stubbed). */
  async preview(): Promise<string> {
    const drops = await this.dropsInWindow();
    if (drops.length === 0) {
      return '<p style="font-family:sans-serif">No drops published in the last 7 days — nothing to preview.</p>';
    }
    const { html } = this.compose(drops);
    return html.split(UNSUB_PLACEHOLDER).join('#unsubscribe-preview');
  }

  /** Idempotent unsubscribe by token; returns a tiny confirmation page. */
  async unsubscribe(token: string | undefined): Promise<string> {
    const page = (title: string, body: string) => `<!doctype html>
<html><body style="margin:0;background:#101014;color:#ece9e2;font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="text-align:center;padding:32px;">
    <div style="font-size:22px;"><span style="color:#c9a96a;">Crown</span> Watch</div>
    <h1 style="margin-top:18px;font-size:26px;font-weight:500;">${title}</h1>
    <p style="margin-top:8px;color:#918e85;font-family:Arial,sans-serif;font-size:14px;">${body}</p>
  </div>
</body></html>`;

    if (!token) return page('Invalid link', 'This unsubscribe link is missing its token.');
    const sub = await this.prisma.digestSubscriber.findUnique({
      where: { unsubscribeToken: token },
    });
    if (!sub) return page('Invalid link', 'This unsubscribe link is not recognised.');
    if (!sub.unsubscribedAt) {
      await this.prisma.digestSubscriber.update({
        where: { id: sub.id },
        data: { unsubscribedAt: new Date() },
      });
    }
    return page(
      "You're unsubscribed",
      'You will no longer receive the weekly digest. Changed your mind? Just sign up again on the site.',
    );
  }
}
