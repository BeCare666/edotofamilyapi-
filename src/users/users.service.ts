import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { GetUsersDto, UserPaginator } from './dto/get-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { DatabaseService } from '../database/database.services';
import { paginate } from 'src/common/pagination/paginate';
import { OkPacket, RowDataPacket } from 'mysql2';
import { BadRequestException } from '@nestjs/common';
import { sendVerificationEmail } from '../auth/mailer';
import * as jwt from 'jsonwebtoken';
import { createPool } from 'mysql2/promise';
@Injectable()
export class UsersService {
  constructor(private readonly DatabaseService: DatabaseService) { }
  async create(createUserDto: CreateUserDto): Promise<User> {
    const { name, email, password, profile, address, permission } = createUserDto;

    const [result]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
      `INSERT INTO users (name, email, password, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [name, email, password, true]
    );
    const userId = result.insertId;

    if (profile) {
      await this.DatabaseService.query(
        `INSERT INTO profiles (bio, socials, contact, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())`,
        [profile.bio, profile.socials, profile.contact, userId]
      );
    }

    if (address && address.length > 0) {
      for (const addr of address) {
        await this.DatabaseService.query(
          `INSERT INTO addresses (title, type, default_flag, zip, city, state, country, street_address, customer_id, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            addr.title,
            addr.type,
            addr.default,
            addr.address.zip,
            addr.address.city,
            addr.address.state,
            addr.address.country,
            addr.address.street_address,
            userId,
          ]
        );
      }
    }

    if (permission) {
      const [permRows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
        `SELECT id FROM permissions WHERE LOWER(name) = ?`,
        [permission.toLowerCase()]
      );
      if (permRows.length > 0) {
        await this.DatabaseService.query(
          `INSERT INTO model_has_permissions (model_id, permission_id, model_type) VALUES (?, ?, ?)`,
          [userId, permRows[0].id, 'Marvel\\Database\\Models\\User']
        );
      }
    }

    const [rows]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    return rows[0] as User;
  }

  async findOne(id: number): Promise<User> {
    const pool = this.DatabaseService.getPool();
    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    if (!rows.length) throw new NotFoundException('User not found');
    return rows[0] as User;
  }

  async getUsers({ limit = 30, page = 1 }: GetUsersDto): Promise<UserPaginator> {
    const pool = this.DatabaseService.getPool();

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM users LIMIT ? OFFSET ?',
      [limitNumber, offset]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM users'
    );
    const total = countRows[0].total;

    return {
      data: rows as User[],
      ...paginate(total, pageNumber, limitNumber, rows.length, `/users?limit=${limitNumber}`),
    };
  }



  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    const pool = this.DatabaseService.getPool();
    const { name, email, profile } = updateUserDto;

    // Vérifier que l'utilisateur existe
    const [userExists]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );
    if (userExists.length === 0) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    // Mise à jour de la table users
    const fieldsToUpdate = [];
    const values = [];

    if (name !== undefined) {
      fieldsToUpdate.push('name = ?');
      values.push(name);
    }
    if (email !== undefined) {
      fieldsToUpdate.push('email = ?');
      values.push(email);
    }

    if (fieldsToUpdate.length > 0) {
      fieldsToUpdate.push('updated_at = NOW()');
      values.push(id);

      await pool.query(
        `UPDATE users SET ${fieldsToUpdate.join(', ')} WHERE id = ?`,
        values
      );
    }

    // Gestion du profil lié à l'utilisateur
    // ...
    // Gestion du profil lié à l'utilisateur.
    if (profile) {
      const bio = profile.bio ?? null;
      const socials = profile.socials ?? null;
      const contact = profile.contact ?? null;

      let avatar_id: number | null | undefined = undefined;

      console.log('Avatar reçu dans DTO:', profile.avatar);

      if ('avatar' in profile && profile.avatar) {
        // On cast localement avatar pour dire à TypeScript qu'il peut contenir ces champs là.
        const avatar = profile.avatar as {
          url?: string;
          key?: string;
          mimeType?: string;
          size?: number;
          originalName?: string;
        };

        if (avatar.url) {
          console.log('Recherche du media existant avec url:', avatar.url);

          const [existingMedia]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
            'SELECT id FROM media WHERE url = ?',
            [avatar.url]
          );

          console.log('Résultat de existingMedia:', existingMedia);

          if (existingMedia.length > 0) {
            console.log('Media déjà existant, id:', existingMedia[0].id);
            avatar_id = existingMedia[0].id;
          } else {
            console.log('Insertion du nouveau media');

            const [inserted]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
              `INSERT INTO media 
         (user_id, url, \`key\`, mime_type, size, original_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              [
                id,
                avatar.url,
                avatar.key,
                avatar.mimeType,
                avatar.size,
                avatar.originalName,
              ]
            );

            console.log('Media inséré, insertId:', inserted.insertId);
            avatar_id = inserted.insertId;
          }
        }
      }




      // Vérifie si le profil existe déjà
      const [existingProfile]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
        'SELECT id FROM profiles WHERE customer_id = ?',
        [id]
      );

      if (existingProfile.length > 0) {
        if (avatar_id !== undefined) {
          await this.DatabaseService.query(
            `UPDATE profiles 
         SET bio = ?, socials = ?, contact = ?, avatar_id = ?, updated_at = NOW() 
         WHERE customer_id = ?`,
            [bio, socials, contact, avatar_id, id]
          );
        } else {
          await this.DatabaseService.query(
            `UPDATE profiles 
         SET bio = ?, socials = ?, contact = ?, updated_at = NOW() 
         WHERE customer_id = ?`,
            [bio, socials, contact, id]
          );
        }
      } else {
        await this.DatabaseService.query(
          `INSERT INTO profiles (bio, socials, contact, avatar_id, customer_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
          [bio, socials, contact, avatar_id ?? null, id]
        );
      }
    }

    // ...


    // Renvoie l'utilisateur mis à jour
    return this.findOne(id);
  }


  //  Supprimer un utilisateur
  // Vérifie si l'utilisateur existe avant de le supprimer



  async remove(id: number): Promise<string> {
    const pool = this.DatabaseService.getPool();
    const [userExists]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );
    if (userExists.length === 0) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    return `This action removes user #${id}`;
  }
  // ban user
  async banUser(id: number): Promise<User> {
    const pool = this.DatabaseService.getPool();
    const user = await this.findOne(id);
    await pool.query(
      'UPDATE users SET is_active = ? WHERE id = ?',
      [!user.is_active, id]
    );
    return this.findOne(id);
  }

  async activeUser(id: number): Promise<User> {
    return this.banUser(id);
  }

  async getAllCustomers({ limit = 30, page = 1 }: GetUsersDto): Promise<UserPaginator> {
    const pool = this.DatabaseService.getPool();
    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.* FROM users u
     JOIN model_has_permissions m ON u.id = m.model_id
     JOIN permissions p ON m.permission_id = p.id
     WHERE p.name = 'customer'
     LIMIT ? OFFSET ?`,
      [limitNumber, offset]
    );

    const [count] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM users u
     JOIN model_has_permissions m ON u.id = m.model_id
     JOIN permissions p ON m.permission_id = p.id
     WHERE p.name = 'customer'`
    );

    return {
      data: rows as User[],
      ...paginate(count[0].total, pageNumber, limitNumber, rows.length, `/customers/list?limit=${limitNumber}`),
    };
  }

  async getAdmin({ limit = 30, page = 1 }: GetUsersDto): Promise<UserPaginator> {
    const pool = this.DatabaseService.getPool();
    const pageNumber = Number(page);   // ✅ Assure que c'est un nombre
    const limitNumber = Number(limit); // ✅ Assure que c'est un nombre
    const offset = (pageNumber - 1) * limitNumber;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM users WHERE role = 'super_admin' LIMIT ? OFFSET ?`,
      [limitNumber, offset] // ✅ ces valeurs doivent être des nombres
    );

    const [count] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM users WHERE role = 'super_admin'`
    );

    return {
      data: rows as User[],
      ...paginate(count[0].total, pageNumber, limitNumber, rows.length, `/admin/list?limit=${limitNumber}`),
    };
  }



  async getVendors({ limit = 30, page = 1 }: GetUsersDto): Promise<UserPaginator> {
    const pool = this.DatabaseService.getPool();
    const pageNumber = Number(page) || 1;    // sécuriser la conversion
    const limitNumber = Number(limit) || 30; // sécuriser la conversion
    const offset = (pageNumber - 1) * limitNumber;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM users WHERE role = 'store_owner' LIMIT ? OFFSET ?`,
      [limitNumber, offset]
    );

    const [count] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM users WHERE role = 'store_owner'`
    );

    return {
      data: rows as User[],
      ...paginate(count[0].total, pageNumber, limitNumber, rows.length, `/vendors/list?limit=${limitNumber}`),
    };
  }



  async getAllStaffs({ limit = 30, page = 1 }: GetUsersDto): Promise<UserPaginator> {
    const pool = this.DatabaseService.getPool();
    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.* FROM users u
     JOIN model_has_permissions m ON u.id = m.model_id
     JOIN permissions p ON m.permission_id = p.id
     WHERE p.name IN ('staff', 'super_admin')
     LIMIT ? OFFSET ?`,
      [limitNumber, offset]
    );

    const [count] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM users u
     JOIN model_has_permissions m ON u.id = m.model_id
     JOIN permissions p ON m.permission_id = p.id
     WHERE p.name IN ('staff', 'super_admin')`
    );

    return {
      data: rows as User[],
      ...paginate(count[0].total, pageNumber, limitNumber, rows.length, `/all-staffs/list?limit=${limitNumber}`),
    };
  }

  async getMyStaffs({ limit = 30, page = 1 }: GetUsersDto): Promise<UserPaginator> {
    const pool = this.DatabaseService.getPool();
    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.* FROM users u
     JOIN model_has_permissions m ON u.id = m.model_id
     JOIN permissions p ON m.permission_id = p.id
     WHERE p.name IN ('staff')
     LIMIT ? OFFSET ?`,
      [limitNumber, offset]
    );

    const [count] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM users u
     JOIN model_has_permissions m ON u.id = m.model_id
     JOIN permissions p ON m.permission_id = p.id
     WHERE p.name IN ('staff')`
    );

    return {
      data: rows as User[],
      ...paginate(count[0].total, pageNumber, limitNumber, rows.length, `/mystaffs/list?limit=${limitNumber}`),
    };
  }


  async updateUserRole(userId: number): Promise<{ token: string; permissions: string[] }> {

    // 1️⃣ Vérifier l'utilisateur
    const [rows] = await this.DatabaseService.query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = Array.isArray(rows) ? rows[0] : rows;

    if (!user) {
      throw new NotFoundException("Utilisateur non trouvé.");
    }

    // 2️⃣ Vérifier le rôle actuel
    if (user.role === 'store_owner') {
      throw new BadRequestException("Vous êtes déjà vendeur sur Galilée Commerce.");
    }

    if (user.role !== 'customer') {
      throw new BadRequestException("Seuls les utilisateurs avec le rôle 'customer' peuvent devenir vendeur.");
    }

    // 3️⃣ Mise à jour du rôle
    try {
      await this.DatabaseService.query('UPDATE users SET role = ? WHERE id = ?', ['store_owner', userId]);
    } catch (error) {
      console.error("Erreur lors de la mise à jour du rôle :", error);
      throw new InternalServerErrorException("Impossible de mettre à jour le rôle de l'utilisateur.");
    }

    // 4️⃣ Générer un nouveau token JWT
    let token: string;
    try {
      token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          permissions: ['store_owner'],
        },
        process.env.JWT_SECRET_KEY as string,
        { expiresIn: '7d' }
      );
    } catch (error) {
      console.error("Erreur lors de la génération du token :", error);
      throw new InternalServerErrorException("Impossible de générer un nouveau token.");
    }


    // 6️⃣ Retourner le token et les permissions
    return {
      token,
      permissions: ['store_owner'],
    };
  }

}      
