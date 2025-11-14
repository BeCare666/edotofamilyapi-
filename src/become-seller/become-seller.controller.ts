// src/become-seller/become-seller.controller.ts
import { Body, Controller, Get, Post, UseGuards, Req, UnauthorizedException } from '@nestjs/common';
import { BecomeSellerService } from './become-seller.service';
import { CreateBecomeSellerDto } from './dto/create-become-seller.dto';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

@Controller('became-seller')
export class BecomeSellerController {
  constructor(private readonly becomeSellerService: BecomeSellerService) { }

  // Ici on protège l'accès avec JWT  
  @UseGuards(AuthGuard('jwt'))
  @Post()
  async create(@Req() req: Request) {
    const user = req.user as any; // ou typage plus précis si tu as
    console.log('→ Utilisateur courant :', user); // ← ajoute ceci
    if (!user?.id) {
      throw new UnauthorizedException('Utilisateur non authentifié');
    }

    return this.becomeSellerService.create({ userId: user.id });
  }

  @Get()
  findAll() {
    return this.becomeSellerService.findAll();
  }
}
