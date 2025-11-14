import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { CreateBecomeSellerDto } from './dto/create-become-seller.dto';
import * as jwt from 'jsonwebtoken';
@Injectable()
export class BecomeSellerService {
  constructor(private readonly database: DatabaseService) { }

  async create(createBecomeSellerDto: CreateBecomeSellerDto) {
    const { userId } = createBecomeSellerDto;
    console.log('→ Utilisateur userId :', userId);

    // Mise à jour du rôle
    await this.database.query(
      'UPDATE users SET role = ? WHERE id = ?',
      ['store_owner', userId],
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
      'SELECT * FROM users WHERE role = ?',
      ['store_owner'],
    );
    return rows;
  }
}
