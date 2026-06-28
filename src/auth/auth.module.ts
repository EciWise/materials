import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { envs } from '../config';
import { JwtAuthGuard } from './jwt.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: envs.jwtSecret,
      verifyOptions: { algorithms: ['HS256'] },
    }),
  ],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
