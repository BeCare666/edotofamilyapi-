import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { OkPacket, RowDataPacket } from 'mysql2';
import { Shop } from './entities/shop.entity';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { GetShopsDto } from './dto/get-shops.dto';
import { GetStaffsDto } from './dto/get-staffs.dto';
import { paginate } from 'src/common/pagination/paginate';
import { User } from 'src/users/entities/user.entity';
import { DatabaseService } from '../database/database.services';
import { sendVerificationEmail } from '../auth/mailer';

@Injectable()
export class ShopsService {
  constructor(private readonly DatabaseService: DatabaseService) { }

  // Fonction utilitaire pour générer un slug propre à partir d'un texte.
  private formatSlug(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  }

  async create(createShopDto: CreateShopDto & { address?: any }): Promise<Shop> {
    const pool = this.DatabaseService.getPool();
    const {
      name,
      slug,
      description,
      is_active = false,
      owner_id,
      contact,
      website,
      location,
      cover_image,
      logo_image,
      address = {},
    } = createShopDto;

    const {
      zip = null,
      city = null,
      state = null,
      country = null,
      street_address = null,
    } = address;

    if (!owner_id) throw new Error('owner_id is required');

    const finalSlug = slug && slug.trim() !== '' ? slug : this.formatSlug(name);

    let cover_image_id: number | null = null;
    let logo_image_id: number | null = null;

    // Insert cover image in db
    if (cover_image?.url) {
      const [cover]: [OkPacket, any] = await pool.query<OkPacket>(
        `INSERT INTO media (user_id, url, \`key\`, mime_type, size, original_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          owner_id,
          cover_image.url,
          cover_image.key ?? null,
          cover_image.mimeType ?? null,
          cover_image.size ?? null,
          cover_image.originalName ?? null,
        ]
      );
      cover_image_id = cover.insertId;
      console.log('Inserted cover_image_id:', cover_image_id);
    }

    // Insert logo image
    if (logo_image?.url) {
      const [logo]: [OkPacket, any] = await pool.query<OkPacket>(
        `INSERT INTO media (user_id, url, \`key\`, mime_type, size, original_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          owner_id,
          logo_image.url,
          logo_image.key ?? null,
          logo_image.mimeType ?? null,
          logo_image.size ?? null,
          logo_image.originalName ?? null,
        ]
      );
      logo_image_id = logo.insertId;
      console.log('Inserted logo_image_id:', logo_image_id);
    }

    // Vérifier et transformer location
    const locationJson = location ? JSON.stringify(location) : null;
    console.log('Final location JSON:', locationJson);

    // Insert shop
    console.log('Inserting shop with:', {
      owner_id,
      name,
      finalSlug,
      description,
      is_active,
      contact,
      website,
      zip,
      city,
      state,
      country,
      street_address,
      locationJson,
      cover_image_id,
      logo_image_id,
    });

    const [shop]: [OkPacket, any] = await pool.query<OkPacket>(
      `INSERT INTO shops
       (owner_id, name, slug, description, is_active, contact, website, zip, city, state, country, street_address, location, cover_image_id, logo_image_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        owner_id,
        name,
        finalSlug,
        description ?? null,
        is_active,
        contact ?? null,
        website ?? null,
        zip,
        city,
        state,
        country,
        street_address,
        locationJson,
        cover_image_id ?? null,
        logo_image_id ?? null,
      ]
    );

    console.log('Created shop ID:', shop.insertId);

    return this.getShopById(shop.insertId);
  }


  // --- GET SHOP BY ID (avec cover et logo) ----
  private async getShopById(id: number): Promise<Shop> {
    const pool = this.DatabaseService.getPool();
    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT s.*, 
              ci.url as cover_image_url,
              li.url as logo_image_url
       FROM shops s
       LEFT JOIN media ci ON s.cover_image_id = ci.id
       LEFT JOIN media li ON s.logo_image_id = li.id
       WHERE s.id = ?`,
      [id]
    );

    if (!rows.length) throw new NotFoundException('Shop not found');

    const shop = rows[0] as any;
    return {
      ...shop,
      cover_image: shop.cover_image_url ? { url: shop.cover_image_url } : null,
      logo_image: shop.logo_image_url ? { url: shop.logo_image_url } : null,
    } as Shop;
  }

  // --- GET SHOPS (pagination + search) ---
  async getShops({ search, limit = 30, page = 1 }: GetShopsDto) {
    const pool = this.DatabaseService.getPool();
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params: any[] = [];

    if (search) {
      whereClause = 'WHERE name LIKE ? OR slug LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Assurer que limit et offset sont des nombres
    const limitNum = Number(limit);
    const offsetNum = Number(offset);

    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM shops ${whereClause} LIMIT ${limitNum} OFFSET ${offsetNum}`,
      params // seuls les params de search restent ici
    );

    const [count]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM shops ${whereClause}`,
      params
    );

    return {
      data: rows as Shop[],
      ...paginate(count[0].total, page, limitNum, rows.length, `/shops?limit=${limitNum}`),
    };
  }


  // --- GET NEW SHOPS (is_active=0) ---
  async getNewShops({ search, limit = 30, page = 1 }: GetShopsDto) {
    const pool = this.DatabaseService.getPool();

    // Forcer des valeurs correctes
    limit = Math.max(1, Math.min(100, Number(limit))); // max 100 par page
    page = Math.max(1, Number(page));
    const offset = (page - 1) * limit;

    // Construire le WHERE de manière sécurisée
    const params: any[] = [];
    let whereClause = 'WHERE is_active = 0';
    if (search && search.trim() !== '') {
      whereClause += ' AND (name LIKE ? OR slug LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Récupérer les shops
    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM shops ${whereClause} LIMIT ? OFFSET ?`,
      [...params, limit, offset] // limit et offset sont des nombres
    );

    // Compter le total
    const [count]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM shops ${whereClause}`,
      params
    );

    return {
      data: rows as Shop[],
      ...paginate(count[0].total, page, limit, rows.length, `/new-shops?limit=${limit}`),
    };
  }


  // --- GET SHOP BY SLUG ---
  async getShop(slug: string): Promise<any> {
    const pool = this.DatabaseService.getPool();
    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(`
    SELECT 
      s.*,
      cover_media.url AS cover_image_url,
      logo_media.url AS logo_image_url
    FROM shops s
    LEFT JOIN media AS cover_media ON s.cover_image_id = cover_media.id
    LEFT JOIN media AS logo_media ON s.logo_image_id = logo_media.id
    WHERE s.slug = ?
  `, [slug]);

    if (!rows.length) throw new NotFoundException('Shop not found');
    return rows[0];
  }


  // --- UPDATE SHOP ---
  async update(id: number, updateShopDto: UpdateShopDto): Promise<Shop> {
    const pool = this.DatabaseService.getPool();
    const fieldsToUpdate: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(updateShopDto)) {
      fieldsToUpdate.push(`${key} = ?`);
      params.push(value);
    }

    if (fieldsToUpdate.length > 0) {
      fieldsToUpdate.push('updated_at = NOW()');
      params.push(id);

      await pool.query(
        `UPDATE shops SET ${fieldsToUpdate.join(', ')} WHERE id = ?`,
        params
      );
    }

    return this.getShopById(id);
  }

  // --- REMOVE SHOP ---
  async remove(id: number): Promise<string> {
    const pool = this.DatabaseService.getPool();
    await pool.query(`DELETE FROM shops WHERE id = ?`, [id]);
    return `This action removes shop #${id}`;
  }

  // --- APPROVE SHOP ---
  async approveShop(id: number): Promise<Shop> {
    const pool = this.DatabaseService.getPool();

    // 1️⃣ Active la boutique
    await pool.query(
      `UPDATE shops SET is_active = 1, updated_at = NOW() WHERE id = ?`,
      [id]
    );

    // 2️⃣ Récupère owner_id
    const [shopRows] = await pool.query<RowDataPacket[]>(`SELECT owner_id FROM shops WHERE id = ?`, [id]);
    const shop = shopRows[0];
    if (!shop) {
      throw new NotFoundException(`Aucune boutique trouvée avec l'id ${id}`);
    }

    const ownerId = shop.owner_id;

    // 3️⃣ Récupère email du propriétaire
    const [userRows] = await pool.query<RowDataPacket[]>(`SELECT email FROM users WHERE id = ?`, [ownerId]);
    const user = userRows[0];
    if (!user) {
      throw new NotFoundException(`Aucun utilisateur trouvé avec l'id ${ownerId}`);
    }

    const loginLink = `https://galileecommerce-admin.vercel.app/login`;

    try {
      // 4️⃣ Envoie de l'email
      await sendVerificationEmail({
        email: user.email,
        subject: 'Bienvenue sur Galilée Commerce !',
        message: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <div style="background: #f3f4f6; padding: 20px; text-align: center;">
            <img src="https://galileecommerce.netlify.app/img/logo_galile_pc.png" alt="Galilée Commerce" style="height: 80px; margin-bottom: 10px;" />
          </div>
          <div style="padding: 30px;">
            <h2 style="color: #111827; margin-bottom: 10px;">Félicitations !</h2>
            <p style="color: #374151; font-size: 16px; line-height: 1.5;">
              Vous êtes désormais fournisseur sur notre plateforme Galilée Commerce.
              Cliquez sur le bouton ci-dessous pour accéder à votre espace.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${loginLink}" style="background-color: #ec4899; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">
                Accéder à mon espace vendeur
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
              Merci,<br />L’équipe Galilée Commerce
            </p>
          </div>
        </div>
      `,
      });
    } catch (error) {
      console.error("Erreur lors de l'envoi des e-mails :", error);
      throw new InternalServerErrorException("Impossible d'envoyer les e-mails de notification.");
    }

    return this.getShopById(id);
  }


  async disapproveShop(id: number): Promise<Shop> {
    const pool = this.DatabaseService.getPool();

    // 1️⃣ Désactiver la boutique
    await pool.query(
      `UPDATE shops SET is_active = 0, updated_at = NOW() WHERE id = ?`,
      [id]
    );

    // 2️⃣ Récupérer l'owner_id du shop
    const [shopRows] = await pool.query<RowDataPacket[]>(
      `SELECT owner_id FROM shops WHERE id = ?`,
      [id]
    );
    const shop = shopRows[0];
    if (!shop) {
      throw new NotFoundException(`Aucune boutique trouvée avec l'id ${id}`);
    }

    const ownerId = shop.owner_id;

    // 3️⃣ Récupérer l'email du propriétaire
    const [userRows] = await pool.query<RowDataPacket[]>(
      `SELECT email FROM users WHERE id = ?`,
      [ownerId]
    );
    const user = userRows[0];
    if (!user) {
      throw new NotFoundException(`Aucun utilisateur trouvé avec l'id ${ownerId}`);
    }

    // 4️⃣ Contenu du mail
    const supportLink = `https://galileecommerce.netlify.app/contact`; // exemple de lien vers support

    try {
      // 5️⃣ Envoi du mail de désactivation
      await sendVerificationEmail({
        email: user.email,
        subject: 'Votre boutique a été désactivée sur Galilée Commerce',
        message: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <div style="background: #f3f4f6; padding: 20px; text-align: center;">
            <img src="https://galileecommerce.netlify.app/img/logo_galile_pc.png" alt="Galilée Commerce" style="height: 80px; margin-bottom: 10px;" />
          </div>
          <div style="padding: 30px;">
            <h2 style="color: #b91c1c; margin-bottom: 10px;">Votre boutique a été désactivée</h2>
            <p style="color: #374151; font-size: 16px; line-height: 1.5;">
              Nous vous informons que votre boutique sur Galilée Commerce a été désactivée par notre équipe.
            </p>
            <p style="color: #374151; font-size: 16px; line-height: 1.5;">
              Si vous pensez qu'il s'agit d'une erreur ou souhaitez en savoir plus, vous pouvez nous contacter via le lien ci-dessous.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${supportLink}" style="background-color: #dc2626; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">
                Contacter le support
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
              Merci de votre compréhension,<br />L’équipe Galilée Commerce
            </p>
          </div>
        </div>
      `,
      });
    } catch (error) {
      console.error("Erreur lors de l'envoi de l'e-mail de désactivation :", error);
      throw new InternalServerErrorException("Impossible d'envoyer l'e-mail de notification.");
    }

    // 6️⃣ Retourner la boutique mise à jour
    return this.getShopById(id);
  }

  approve(id: number) {
    return this.approveShop(id);
  }

  // --- GET STAFFS ---
  async getStaffs({ shop_id, limit = 30, page = 1 }: GetStaffsDto) {
    const pool = this.DatabaseService.getPool();
    const offset = (page - 1) * limit;

    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT u.* FROM staffs s
       JOIN users u ON s.user_id = u.id
       WHERE s.shop_id = ? LIMIT ? OFFSET ?`,
      [shop_id, limit, offset]
    );

    const [count]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM staffs WHERE shop_id = ?`,
      [shop_id]
    );

    return {
      data: rows as User[],
      ...paginate(count[0].total, page, limit, rows.length, `/staffs?limit=${limit}`),
    };
  }

  // --- FOLLOW SHOP (toggle) ---
  async followShop(shop_id: number): Promise<boolean> {
    const pool = this.DatabaseService.getPool();
    const user_id = 1; // TODO: remplacer par user_id du contexte auth

    const [existing]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM shop_follows WHERE user_id = ? AND shop_id = ?`,
      [user_id, shop_id]
    );

    if (existing.length > 0) {
      await pool.query(
        `DELETE FROM shop_follows WHERE user_id = ? AND shop_id = ?`,
        [user_id, shop_id]
      );
      return false; // Unfollow
    } else {
      await pool.query(
        `INSERT INTO shop_follows (user_id, shop_id, created_at) VALUES (?, ?, NOW())`,
        [user_id, shop_id]
      );
      return true; // Follow
    }
  }

  // --- CHECK IF FOLLOWING SHOP ---
  async getFollowShop(shop_id: number): Promise<boolean> {
    const pool = this.DatabaseService.getPool();
    const user_id = 1; // TODO: remplacer par user_id du contexte auth

    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM shop_follows WHERE user_id = ? AND shop_id = ?`,
      [user_id, shop_id]
    );

    return rows.length > 0;
  }

  // --- TOP SHOPS ---
  async topShops({ search, limit = 15, page = 1 }: GetShopsDto) {
    const pool = this.DatabaseService.getPool();
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params: any[] = [];

    if (search) {
      whereClause = 'WHERE name LIKE ? OR slug LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM shops ${whereClause} ORDER BY rating DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [count]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM shops ${whereClause}`,
      params
    );

    return {
      data: rows as Shop[],
      ...paginate(count[0].total, page, limit, rows.length, `/top-shops?limit=${limit}`),
    };
  }

  // shops.service.ts
  async getNearByShop(lat: string, lng: string): Promise<Shop[]> {
    const pool = this.DatabaseService.getPool();
    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(`
    SELECT *,
      JSON_EXTRACT(location, '$.lat') as latitude,
      JSON_EXTRACT(location, '$.lng') as longitude,
      (
        6371 * acos(
          cos(radians(?)) *
          cos(radians(JSON_EXTRACT(location, '$.lat'))) *
          cos(radians(JSON_EXTRACT(location, '$.lng')) - radians(?)) +
          sin(radians(?)) *
          sin(radians(JSON_EXTRACT(location, '$.lat')))
        )
      ) AS distance
    FROM shops
    WHERE location IS NOT NULL
    HAVING distance < 10
    ORDER BY distance
    LIMIT 10
  `, [lat, lng, lat]);

    return rows as Shop[];
  }
  async getShopByIdWithLocation(id: number): Promise<Shop> {
    const pool = this.DatabaseService.getPool();
    const [rows]: [RowDataPacket[], any] = await pool.query<RowDataPacket[]>(
      `SELECT s.*, 
              ci.url as cover_image_url,
              li.url as logo_image_url,
              JSON_EXTRACT(s.location, '$.lat') as lat,
              JSON_EXTRACT(s.location, '$.lng') as lng
       FROM shops s
       LEFT JOIN media ci ON s.cover_image_id = ci.id
       LEFT JOIN media li ON s.logo_image_id = li.id
       WHERE s.id = ?`,
      [id]
    );

    if (!rows.length) throw new NotFoundException('Shop not found');

    const shop = rows[0] as any;
    return {
      ...shop,
      cover_image: shop.cover_image_url ? { url: shop.cover_image_url } : null,
      logo_image: shop.logo_image_url ? { url: shop.logo_image_url } : null,
      lat: shop.lat,
      lng: shop.lng,
    } as Shop;
  }
}
