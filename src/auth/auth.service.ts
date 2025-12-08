import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async login(password: string): Promise<{ access_token: string }> {
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword || password !== adminPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { role: 'admin' as const };
    const access_token = this.jwtService.sign(payload);

    return { access_token };
  }
}

