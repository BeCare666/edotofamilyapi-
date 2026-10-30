import { Controller, Get, Post, Body, Req, Query, Res, UseGuards, HttpException, HttpStatus, Optional } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_LOGIN, THROTTLE_SENSITIVE, MINUTE } from '../common/client-throttler.guard';
import { allowAttempt } from '../sponsors/sponsor-rules';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { signStepUp } from './step-up';
import { Response } from 'express';
import {
  ChangePasswordDto,
  ForgetPasswordDto,
  ResendVerificationDto,
  LoginDto,
  OtpDto,
  OtpLoginDto,
  RegisterDto,
  ResetPasswordDto,
  SocialLoginDto,
  VerifyForgetPasswordDto,
  TotpChallengeDto,
  TotpCodeDto,
  TotpLoginDto,
  VerifyOtpDto,
} from './dto/create-auth.dto';
import * as jwt from 'jsonwebtoken';
import { Public } from './public.decorator';
import { readEmailVerification } from './session';
import { realClientIp } from '../common/client-ip';
@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Optional() private readonly totpService?: TotpService,
  ) { }

  @Public()
  @Throttle(THROTTLE_SENSITIVE)
  @Post('register')
  createAccount(@Body() registerDto: RegisterDto, @Req() req: any) {
    return this.authService.register(registerDto, realClientIp(req));
  }
  @Public()
  @Post('register-pick-up-point')
  createAccountpickUpPoint(@Body() registerDto: RegisterDto, @Req() req: any) {
    return this.authService.registerPickUpPoint(registerDto, realClientIp(req));
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
    return this.authService.login(email, password, loginDto.device);
  }

  @Public()
  @Post('resend-verification-email')
  resendVerificationEmail(@Body() { email }: ResendVerificationDto) {
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

  // Nouvel appareil (jeunes, points de retrait) : code reçu par e-mail, 5 essais par minute et par défi
  @Public()
  @Throttle(THROTTLE_LOGIN)
  @Post('token/device')
  loginDevice(@Body() body: TotpLoginDto) {
    this.limitTotp(body?.challenge);
    return this.authService.loginWithDeviceCode(String(body?.challenge || ''), String(body?.code || ''));
  }

  @Public()
  @Throttle(THROTTLE_LOGIN)
  @Post('token/device/resend')
  resendDevice(@Body() body: TotpChallengeDto) {
    return this.authService.resendDeviceCode(String(body?.challenge || ''));
  }

  // Inactivité 5 min (29/10/2026) : jeton renouvelé tant que la personne agit (session encore valide).
  // Environ un appel toutes les 3 min : limite globale (100/min) seulement.
  @Post('token/refresh')
  refresh(@Req() req) {
    return this.authService.refreshSession(req.user);
  }

  // ---------------- Double authentification (audit 3.1, 29/10/2026)
  // Connexion, étape 2 : 5 essais par minute par IP et par compte (le défi identifie le compte)
  @Public()
  @Throttle(THROTTLE_LOGIN)
  @Post('token/totp')
  loginTotp(@Body() body: TotpLoginDto) {
    this.limitTotp(body?.challenge);
    return this.authService.loginWithTotp(String(body?.challenge || ''), String(body?.code || ''));
  }

  @Public()
  @Throttle(THROTTLE_LOGIN)
  @Post('token/totp/setup')
  loginTotpSetup(@Body() body: TotpChallengeDto) {
    return this.authService.totpSetupFromChallenge(String(body?.challenge || ''));
  }

  @Public()
  @Throttle(THROTTLE_LOGIN)
  @Post('token/totp/activate')
  loginTotpActivate(@Body() body: TotpLoginDto) {
    this.limitTotp(body?.challenge);
    return this.authService.totpActivateFromChallenge(String(body?.challenge || ''), String(body?.code || ''));
  }

  // Compte connecté : état, activation, désactivation (si le rôle ne l'exige pas)
  @Get('me/totp')
  totpStatus(@Req() req) {
    return this.totpService.status(Number(req.user?.id));
  }

  @Post('me/totp/setup')
  async totpSetup(@Req() req) {
    return this.totpService.startSetup(await this.totpService.userById(Number(req.user?.id)));
  }

  @Throttle(THROTTLE_LOGIN)
  @Post('me/totp/activate')
  async totpActivate(@Req() req, @Body() body: TotpCodeDto) {
    const codes = await this.totpService.activate(await this.totpService.userById(Number(req.user?.id)), body?.code);
    return { success: true, recovery_codes: codes, message: 'Double authentification activée. Gardez vos codes de secours en lieu sûr.' };
  }

  @Throttle(THROTTLE_LOGIN)
  @Post('me/totp/disable')
  async totpDisable(@Req() req, @Body() body: TotpCodeDto) {
    await this.totpService.disable(await this.totpService.userById(Number(req.user?.id)), body?.code);
    return { success: true, message: 'Double authentification désactivée.' };
  }

  // Actions sensibles (suppression, export) : code vérifié → autorisation de 5 min (en-tête X-Step-Up)
  @Throttle(THROTTLE_LOGIN)
  @Post('me/totp/step-up')
  async totpStepUp(@Req() req, @Body() body: TotpCodeDto) {
    const user = await this.totpService.userById(Number(req.user?.id));
    if (!this.totpService.isEnabled(user)) throw new HttpException('Activez d’abord la double authentification.', HttpStatus.BAD_REQUEST);
    await this.totpService.checkCode(user, body?.code);
    return signStepUp(user);
  }

  private limitTotp(challenge: unknown) {
    const key = String(challenge || '').split('.')[1] || 'vide';
    if (!allowAttempt(`totp:${key}`, 5, MINUTE)) {
      throw new HttpException('Trop de codes saisis. Réessayez dans une minute.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // Audit 2.9 (M12) : utilisateur fourni par le guard JWT global
  @Get('me')
  me(@Req() req) {
    return this.authService.meById(Number(req.user?.id));
  }

  @Post('add-points')
  addWalletPoints(@Body() addPointsDto: any, @Req() req) {
    return this.authService.meById(Number(req.user?.id));
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






