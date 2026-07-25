import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Protects the moderation endpoints with a shared admin token.
 * Fail-closed: if ADMIN_TOKEN is not configured, the endpoints are disabled
 * entirely (never left open on the public internet). Callers must send a
 * matching `x-admin-token` header.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const token = this.config.get<string>('adminToken');
    if (!token) {
      throw new ServiceUnavailableException(
        'Moderation is disabled: set ADMIN_TOKEN on the API to enable it.',
      );
    }
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const provided = req.headers['x-admin-token'];
    if (typeof provided !== 'string' || provided !== token) {
      throw new UnauthorizedException('Invalid or missing x-admin-token header.');
    }
    return true;
  }
}
