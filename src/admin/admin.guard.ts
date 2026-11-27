import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { isAdminEmail } from './admin-policy';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('Authentication required. Please log in.');
    }

    const token = authHeader.replace('Bearer ', '').trim();

    let payload: { sub: string; email: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token. Please log in again.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    // Server-side single-admin rule: the JWT user must carry the admin flag
    // AND their email must be the one configured in ADMIN_EMAIL. When the
    // env is unset, isAdminEmail fails closed and nobody gets in.
    if (!user || !user.isAdmin || !isAdminEmail(user.email)) {
      throw new ForbiddenException('Access denied. Administrator privileges required.');
    }

    request.user = payload;
    return true;
  }
}