import { CanActivate, ExecutionContext, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as path from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { SubmissionsModule } from './submissions/submissions.module';

class NoopThrottlerGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

const throttlerAppGuardProvider =
  process.env.NODE_ENV === 'test'
    ? {
        provide: APP_GUARD,
        useClass: NoopThrottlerGuard,
      }
    : {
        provide: APP_GUARD,
        useClass: ThrottlerGuard,
      };

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    ServeStaticModule.forRoot({
      rootPath: path.join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    PrismaModule,
    AuthModule,
    SubmissionsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    throttlerAppGuardProvider,
  ],
})
export class AppModule {}
