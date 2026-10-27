import { Controller, Get, Post, Body, Req, Query, Res, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_LOGIN, THROTTLE_SENSITIVE, MINUTE } from '../common/client-throttler.guard';
import { allowAttempt } from '../sponsors/sponsor-rules';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { Response } from 'express';
import {
  ChangePasswordDto,
  ForgetPasswordDto,
  LoginDto,
  OtpDto,
  OtpLoginDto,
  RegisterDto,
  ResetPasswordDto,
  SocialLoginDto,
  VerifyForgetPasswordDto,
  VerifyOtpDto,
} from './dto/create-auth.dto';
import * as jwt from 'jsonwebtoken';
import { Public } from './public.decorator';
import { readEmailVerification } from './session';
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Public()
  @Throttle(THROTTLE_SENSITIVE)
  @Post('register')
  createAccount(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }
  @Public()
  @Post('register-pick-up-point')
  createAccountpickUpPoint(@Body() registerDto: RegisterDto) {
    return this.authService.registerPickUpPoint(registerDto);
  }
  // Audit 1.2 : 5 essais par minute par IP (Throttle) et par adresse e-mail
  @Public()
  @Throttle(THROTTLE_LOGIN)
  @Post('token')
  login(@Body() loginDto: LoginDto) {
    const { email, password } = loginDto;
    if (!allowAttempt(`login:${String(email || '').trim().toLowerCase()}`, 5, MINUTE)) {
      throw new HttpException('Trop de tentatives. Réessayez dans une minute.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.authService.login(email, password);
  }

  @Public()
  @Post('resend-verification-email')
  resendVerificationEmail(@Body('email') email: string) {
    return this.authService.resendVerificationEmail(email);
  }

  @Public()
  @Throttle(THROTTLE_SENSITIVE)
  @Post('forget-password')
  forgetPassword(@Body() forgetPasswordDto: ForgetPasswordDto) {
    return this.authService.forgetPassword(forgetPasswordDto);
  }

  @Public()
  @Throttle(THROTTLE_SENSITIVE)
  @Post('reset-password')
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Body() changePasswordDto: ChangePasswordDto, @Req() req: any) {
    return this.authService.changePassword(changePasswordDto, Number(req.user?.id) || undefined);
  }

  @Public()
  @Post('logout')
  async logout(): Promise<boolean> {
    return true;
  }

  @Public()
  @Throttle(THROTTLE_SENSITIVE)
  @Post('verify-forget-password-token')
  verifyForgetPassword(
    @Body() verifyForgetPasswordDto: VerifyForgetPasswordDto,
  ) {
    return this.authService.verifyForgetPasswordToken(verifyForgetPasswordDto);
  }

  @Get('me')
  me(@Req() req) {
    return this.authService.me(req?.headers?.authorization);
  }

  @Post('add-points')
  addWalletPoints(@Body() addPointsDto: any, @Req() req) {
    return this.authService.me(req?.headers?.authorization);
  }

  @Public()
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string, @Res() res: Response) {
    try {
      // Audit 1.5 : seul un jeton émis pour ce lien (purpose 'verify-email') est accepté
      await this.authService.verifyEmail(readEmailVerification(token));
      return res.redirect(`${process.env.FRONTEND_CALLBACK_URL}/login`);
    } catch (err) {
      return res.status(400).json({ message: 'Lien invalide ou expiré.' });
    }
  }
  // c'est pour voir 

}






