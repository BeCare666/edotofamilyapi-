import { Controller, Get, Post, Body, Req, Query, Res, UseGuards } from '@nestjs/common';
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
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  createAccount(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }
  @Post('register-pick-up-point')
  createAccountpickUpPoint(@Body() registerDto: RegisterDto) {
    return this.authService.registerPickUpPoint(registerDto);
  }
  @Post('token')
  login(@Body() loginDto: LoginDto) {
    const { email, password } = loginDto;
    return this.authService.login(email, password);
  }

  @Post('social-login-token')
  socialLogin(@Body() socialLoginDto: SocialLoginDto) {
    socialLoginDto.provider = socialLoginDto.provider || 'google';
    return this.authService.socialLoginx(socialLoginDto);
  }

  @Post('otp-login')
  otpLogin(@Body() otpLoginDto: OtpLoginDto) {
    return this.authService.otpLogin(otpLoginDto);
  }



  @Post('resend-verification-email')
  resendVerificationEmail(@Body('email') email: string) {
    return this.authService.resendVerificationEmail(email);
  }

  @Post('forget-password')
  forgetPassword(@Body() forgetPasswordDto: ForgetPasswordDto) {
    return this.authService.forgetPassword(forgetPasswordDto);
  }

  @Post('reset-password')
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Body() changePasswordDto: ChangePasswordDto, @Req() req: any) {
    return this.authService.changePassword(changePasswordDto, Number(req.user?.id) || undefined);
  }

  @Post('logout')
  async logout(): Promise<boolean> {
    return true;
  }

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

  @Post('contact-us')
  contactUs(@Body() addPointsDto: any) {
    return {
      success: true,
      message: 'Thank you for contacting us. We will get back to you soon.',
    };
  }
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string, @Res() res: Response) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY) as { email: string };
      await this.authService.verifyEmail(decoded.email);
      return res.redirect(`${process.env.FRONTEND_CALLBACK_URL}/login`);
    } catch (err) {
      return res.status(400).json({ message: 'Lien invalide ou expiré.' });
    }
  }
  // c'est pour voir 

}






