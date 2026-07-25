import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit tracker that works behind Render's proxy.
 *
 * Express's own `req.ip` proved unstable there (each request produced a fresh
 * counter, so limits never triggered). We read the left-most X-Forwarded-For
 * entry — the original client — and fall back to the socket address.
 */
@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, string | string[]>;
    const forwarded = headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const client = raw?.split(',')[0]?.trim();
    if (client) return client;

    const realIp = headers['x-real-ip'];
    const real = Array.isArray(realIp) ? realIp[0] : realIp;
    if (real) return real.trim();

    const socket = req.socket as { remoteAddress?: string } | undefined;
    return (req.ip as string) ?? socket?.remoteAddress ?? 'unknown';
  }
}
