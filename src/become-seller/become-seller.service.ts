import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { CreateBecomeSellerDto } from './dto/create-become-seller.dto';
import * as jwt from 'jsonwebtoken';
@Injectable()
export class BecomeSellerService {
  constructor(private readonly database: DatabaseService) { }

  async create(createBecomeSellerDto: CreateBecomeSellerDto) {
    const { userId } = createBecomeSellerDto;

    // Même règle que users/became-seller : seul un client devient vendeur
    // (un admin ou un point de retrait ne doit jamais perdre son rôle ici)
    const [current]: any = await this.database.query('SELECT role FROM users WHERE id = ?', [userId]);
    const role = current?.[0]?.role;
    if (!role) throw new NotFoundException('Utilisateur non trouvé.');
    if (role === 'store_owner') throw new BadRequestException('Vous êtes déjà vendeur.');
    if (role !== 'customer') throw new BadRequestException('Seul un compte client peut devenir vendeur.');

    await this.database.query(
      'UPDATE users SET role = ? WHERE id = ? AND role = ?',
      ['store_owner', userId, 'customer'],
    );

    // Récupération des informations de l'utilisateur
    const [user] = await this.database.query(
      'SELECT id, email FROM users WHERE id = ?',
      [userId],
    );

    if (!user) {
      throw new Error('Utilisateur non trouvé après mise à jour du rôle');
    }

    // Création du JWT avec id et email
    { /**    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        permissions: ['store_owner'],
      },
      process.env.JWT_SECRET_KEY,
      { expiresIn: '7d' }
    );

    return {
      token,
      permissions: ['store_owner'],
      message: 'Rôle mis à jour avec succès',
      success: true,
    };***/}
  }


  async findAll() {
    const [rows] = await this.database.query(
      'SELECT id, name, email, is_active, is_verified, created_at FROM users WHERE role = ?',
      ['store_owner'],
    );
    return rows;
  }
}
