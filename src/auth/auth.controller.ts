import { Controller, Get, Post, Body, Req, Query, Res } from '@nestjs/common';
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



  @Post('forget-password')
  forgetPassword(@Body() forgetPasswordDto: ForgetPasswordDto) {
    return this.authService.forgetPassword(forgetPasswordDto);
  }

  @Post('reset-password')
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('change-password')
  changePassword(@Body() changePasswordDto: ChangePasswordDto) {
    return this.authService.changePassword(changePasswordDto);
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
      return res.redirect('http://localhost:3000/login');
    } catch (err) {
      return res.status(400).json({ message: 'Lien invalide ou expiré.' });
    }
  }
  // c'est pour voir 

}






