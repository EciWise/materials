import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Token de autorización requerido');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    await this.prisma.usuarios.upsert({
      where: { id: payload.sub },
      create: {
        id: payload.sub,
        email: payload.email,
        nombre: payload.nombre,
        apellido: payload.apellido,
        updated_at: new Date(),
      },
      update: {},
    });

    (request as Request & { user: JwtPayload }).user = payload;
    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const authorization = request.headers['authorization'];
    if (!authorization?.startsWith('Bearer ')) return null;
    return authorization.slice(7);
  }
}
