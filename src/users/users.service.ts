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
import * as bcrypt from 'bcrypt';
import { pickupCityOf } from '../campaigns/pickup-city';
import { bumpTokenVersion, signSession } from '../auth/session';
import { normCity } from '../common/geo-city';
import { safeError } from '../common/request-log';
@Injectable()
export class UsersService {
  constructor(private readonly DatabaseService: DatabaseService) { }
  async create(createUserDto: CreateUserDto): Promise<User> {
    const { name, email, password, profile, address, permission } = createUserDto;
    // Même hachage que /register : sans lui, le compte créé ne peut pas se connecter (bcrypt.compare)
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const [result]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
      `INSERT INTO users (name, email, password, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [name, email, hashedPassword, true]
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

  // Liste publique : uniquement les colonnes nécessaires à la sélection d'un point de retrait
  // Liste publique des points de retrait.
  // Avec lat/lng : triée du plus proche au plus loin (distance_km, formule de haversine).
  // Avec en plus radius_km : seulement les points situés dans ce rayon (0 < rayon <= 50 km).
  async getPublicUsersByRole({
    limit = 30,
    page = 1,
    role,
    lat,
    lng,
    radius_km,
    city,
  }: GetUsersDto & { role?: string; lat?: any; lng?: any; radius_km?: any; city?: any }): Promise<UserPaginator> {
    const pool = this.DatabaseService.getPool();
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(200, Math.max(1, Number(limit) || 30));
    const offset = (pageNumber - 1) * limitNumber;

    const latNum = lat === undefined || lat === '' ? NaN : Number(lat);
    const lngNum = lng === undefined || lng === '' ? NaN : Number(lng);
    const hasPosition =
      Number.isFinite(latNum) && Number.isFinite(lngNum) && Math.abs(latNum) <= 90 && Math.abs(lngNum) <= 180;
    const radius = Number(radius_km);
    const hasRadius = hasPosition && Number.isFinite(radius) && radius > 0 && radius <= 50;

    // Les inscriptions en attente de validation ne sont pas des points de retrait :
    // elles n'apparaissent pas. Les points bloqués restent visibles avec status = 'blocked'.
    const base = `FROM users WHERE role = ? AND pickup_approved = 1`;
    // D3 : retraits déjà effectués par le point =
    //   commandes retirées (orders.pickup_point_id, order_status 'order-completed', validées par OTP)
    // + kits de campagne retirés (campaign_registrations.picked_up = 1 ; le point est stocké en texte
    //   dans pickup_center) — décision du 24/09/2026.
    const withdrawals = (idColumn: string) =>
      `((SELECT COUNT(*) FROM orders o WHERE o.pickup_point_id = ${idColumn} AND o.order_status = 'order-completed')
        + (SELECT COUNT(*) FROM campaign_registrations cr WHERE cr.pickup_center = CAST(${idColumn} AS CHAR) AND cr.picked_up = 1))`;
    let rows: RowDataPacket[];
    let total: number;

    // Kit de campagne (16/10/2026) : seulement les points de retrait de la ville de la campagne.
    // La ville d'un point est déduite de sa position GPS (calculée une fois, gardée en base).
    const wantedCity = typeof city === 'string' ? city.trim() : '';
    if (wantedCity && role === 'super_pickuppoint') {
      const distance = hasPosition
        ? `CASE WHEN pickup_lat IS NULL OR pickup_lng IS NULL THEN NULL ELSE (6371 * 2 * ASIN(LEAST(1, SQRT(
            POW(SIN(RADIANS(pickup_lat - ?) / 2), 2) +
            COS(RADIANS(?)) * COS(RADIANS(pickup_lat)) * POW(SIN(RADIANS(pickup_lng - ?) / 2), 2)
          )))) END`
        : 'NULL';
      const [all] = await pool.query<RowDataPacket[]>(
        `SELECT id, name, pickup_address, pickup_lat, pickup_lng, is_active, pickup_city, pickup_city_src,
                ${distance} AS distance_km, ${withdrawals('users.id')} AS withdrawals_count
         ${base} AND pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL
         ORDER BY distance_km IS NULL, distance_km ASC, id ASC`,
        hasPosition ? [latNum, latNum, lngNum, role] : [role],
      );
      const inCity: RowDataPacket[] = [];
      for (const r of all) {
        const c = await pickupCityOf(pool, r as any);
        if (c && normCity(c) === normCity(wantedCity)) inCity.push(r);
      }
      total = inCity.length;
      rows = inCity.slice(offset, offset + limitNumber).map(({ pickup_city_src, ...r }: any) => r);
      return {
        data: rows.map((r) => ({
          ...r,
          distance_km: r.distance_km === null || r.distance_km === undefined ? null : Math.round(Number(r.distance_km) * 100) / 100,
          status: Number(r.is_active) === 0 ? 'blocked' : 'active',
          withdrawals_count: Number(r.withdrawals_count) || 0,
        })) as unknown as User[],
        ...paginate(total, pageNumber, limitNumber, rows.length, `/users?role=${role}&city=${encodeURIComponent(wantedCity)}&limit=${limitNumber}`),
      };
    }

    if (hasPosition) {
      const distance = `(6371 * 2 * ASIN(LEAST(1, SQRT(
          POW(SIN(RADIANS(pickup_lat - ?) / 2), 2) +
          COS(RADIANS(?)) * COS(RADIANS(pickup_lat)) * POW(SIN(RADIANS(pickup_lng - ?) / 2), 2)
        ))))`;
      const inner = `SELECT id, name, pickup_address, pickup_lat, pickup_lng, is_active,
          CASE WHEN pickup_lat IS NULL OR pickup_lng IS NULL THEN NULL ELSE ${distance} END AS distance_km
        ${base}`;
      const innerParams = [latNum, latNum, lngNum, role];
      const filter = hasRadius ? `WHERE t.distance_km IS NOT NULL AND t.distance_km <= ?` : '';
      const filterParams = hasRadius ? [radius] : [];

      [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.*, ${withdrawals('t.id')} AS withdrawals_count FROM (${inner}) t ${filter}
         ORDER BY t.distance_km IS NULL, t.distance_km ASC, t.id ASC
         LIMIT ? OFFSET ?`,
        [...innerParams, ...filterParams, limitNumber, offset]
      );
      const [countRows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as total FROM (${inner}) t ${filter}`,
        [...innerParams, ...filterParams]
      );
      total = countRows[0].total;
    } else {
      [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, name, pickup_address, pickup_lat, pickup_lng, is_active,
                ${withdrawals('users.id')} AS withdrawals_count ${base} LIMIT ? OFFSET ?`,
        [role, limitNumber, offset]
      );
      const [countRows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) as total ${base}`, [role]);
      total = countRows[0].total;
    }

    return {
      data: rows.map((r) => ({
        ...r,
        distance_km: r.distance_km === null || r.distance_km === undefined ? null : Math.round(Number(r.distance_km) * 100) / 100,
        status: Number(r.is_active) === 0 ? 'blocked' : 'active',
        withdrawals_count: Number(r.withdrawals_count) || 0,
      })) as unknown as User[],
      ...paginate(total, pageNumber, limitNumber, rows.length, `/users?role=${role}&limit=${limitNumber}`),
    };
  }

// Liste admin des utilisateurs, filtres réels : recherche (nom, e-mail — avant ignorée),
// rôle, compte actif/bloqué, e-mail confirmé, période d'inscription (UTC+1), tri sécurisé.
async getUsers(query: GetUsersDto & { role?: string; [k: string]: any }): Promise<UserPaginator> {
  const pool = this.DatabaseService.getPool();
  const q: any = query;
  const pageNumber = Math.max(1, Number(q.page) || 1);
  const limitNumber = Math.min(100, Math.max(1, Number(q.limit) || 30));
  const offset = (pageNumber - 1) * limitNumber;

  const where: string[] = [];
  const params: any[] = [];
  let text = q.text ?? q.name;
  if (!text && typeof q.search === 'string') {
    const m = q.search.split(';').map((p: string) => p.split(':')).find(([k]: string[]) => k === 'name');
    if (m?.[1]) text = m[1];
  }
  if (text && String(text).trim()) {
    const term = `%${String(text).trim()}%`;
    where.push('(name COLLATE utf8mb4_general_ci LIKE ? OR email COLLATE utf8mb4_general_ci LIKE ?)');
    params.push(term, term);
  }
  if (q.role) { where.push('role = ?'); params.push(String(q.role)); }
  if (q.is_active === '1' || q.is_active === '0') { where.push(q.is_active === '1' ? 'is_active = 1' : '(is_active = 0 OR is_active IS NULL)'); }
  if (q.is_verified === '1' || q.is_verified === '0') { where.push(q.is_verified === '1' ? 'is_verified = 1' : '(is_verified = 0 OR is_verified IS NULL)'); }
  const day = (s: any) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const beninDayUtc = (s: string, add = 0) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + add) - 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  };
  if (day(q.date_from)) { where.push('created_at >= ?'); params.push(beninDayUtc(q.date_from)); }
  if (day(q.date_to)) { where.push('created_at < ?'); params.push(beninDayUtc(q.date_to, 1)); }
  // Filtres avancés (19/10/2026) : sexe, âge (date de naissance renseignée), commandes passées
  if (q.sex === 'female' || q.sex === 'male') { where.push('sex = ?'); params.push(q.sex); }
  if (q.sex === 'none') where.push("(sex IS NULL OR sex = '')");
  const minAge = Number(q.min_age);
  const maxAge = Number(q.max_age);
  if (String(q.min_age ?? '') !== '' && Number.isInteger(minAge) && minAge >= 0) { where.push('birth_date IS NOT NULL AND TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) >= ?'); params.push(minAge); }
  if (String(q.max_age ?? '') !== '' && Number.isInteger(maxAge) && maxAge >= 0) { where.push('birth_date IS NOT NULL AND TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) <= ?'); params.push(maxAge); }
  if (q.has_orders === '1') where.push('EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = users.id AND o2.is_archived = 0)');
  if (q.has_orders === '0') where.push('NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = users.id AND o2.is_archived = 0)');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const SORTS: Record<string, string> = { created_at: 'created_at', name: 'name', orders_count: 'orders_count' };
  const orderCol = SORTS[String(q.orderBy)] ?? 'created_at';
  const dir = String(q.sortedBy).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const [[rows], [countRows]]: any = await Promise.all([
    pool.query(
      `SELECT users.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = users.id AND o.is_archived = 0) AS orders_count
       FROM users ${whereSql} ORDER BY ${orderCol} ${dir}, id DESC LIMIT ? OFFSET ?`,
      [...params, limitNumber, offset],
    ),
    pool.query(`SELECT COUNT(*) as total FROM users ${whereSql}`, params),
  ]);
  const total = Number(countRows[0].total);
  return {
    data: rows.map((r: any) => ({ ...r, orders_count: Number(r.orders_count ?? 0) })) as User[],
    ...paginate(total, pageNumber, limitNumber, rows.length, `/users?limit=${limitNumber}`),
  };
}

// Compteurs réels des filtres de la liste admin
async getUserFacets(role?: string) {
  const pool = this.DatabaseService.getPool();
  const where = role ? 'WHERE role = ?' : '';
  const params = role ? [role] : [];
  const [[roles], [sum]]: any = await Promise.all([
    pool.query(`SELECT role, COUNT(*) AS n FROM users ${where} GROUP BY role ORDER BY n DESC`, params),
    pool.query(
      `SELECT COUNT(*) AS total, SUM(is_active = 1) AS active, SUM(is_verified = 1) AS verified,
              SUM(sex = 'female') AS female, SUM(sex = 'male') AS male,
              SUM(EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = users.id AND o2.is_archived = 0)) AS with_orders,
              MIN(TIMESTAMPDIFF(YEAR, birth_date, CURDATE())) AS min_age, MAX(TIMESTAMPDIFF(YEAR, birth_date, CURDATE())) AS max_age
       FROM users ${where}`,
      params,
    ),
  ]);
  const n = (v: any) => Number(v ?? 0);
  const s = sum[0] ?? {};
  return {
    total: n(s.total),
    roles: roles.map((r: any) => ({ value: r.role, count: n(r.n) })),
    active: { yes: n(s.active), no: n(s.total) - n(s.active) },
    verified: { yes: n(s.verified), no: n(s.total) - n(s.verified) },
    sex: { female: n(s.female), male: n(s.male), none: n(s.total) - n(s.female) - n(s.male) },
    orders: { yes: n(s.with_orders), no: n(s.total) - n(s.with_orders) },
    age: { min: s.min_age != null ? n(s.min_age) : null, max: s.max_age != null ? n(s.max_age) : null },
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


      if ('avatar' in profile && profile.avatar) {
        // On cast localement avatar pour dire à TypeScript qu'il peut contenir ces champs là.
        const avatar = profile.avatar as {
          url?: string;
          key?: string;
          mimeType?: string;
          size?: number;
          originalName?: string;
          original?: string;
          thumbnail?: string;
        };
        // L'admin (profile-update-form.tsx) envoie l'adresse dans « original », pas dans « url »
        // (28/10/2026) : sans cette reprise, l'avatar n'était jamais enregistré.
        const rawUrl = avatar.url ?? avatar.original;
        const avatarUrl = typeof rawUrl === 'string' ? rawUrl : '';

        if (avatarUrl) {

          // Table avatars : c'est elle que référence profiles.avatar_id (clé étrangère, vérifié le 16/10/2026)
          const [existingMedia]: [RowDataPacket[], any] = await this.DatabaseService.query<RowDataPacket[]>(
            'SELECT id FROM avatars WHERE original = ?',
            [avatarUrl]
          );


          if (existingMedia.length > 0) {
            console.log('Media déjà existant, id:', existingMedia[0].id);
            avatar_id = existingMedia[0].id;
          } else {
            console.log('Insertion du nouveau media');

            const [inserted]: [OkPacket, any] = await this.DatabaseService.query<OkPacket>(
              `INSERT INTO avatars (original, thumbnail) VALUES (?, ?)`,
              [avatarUrl, avatarUrl]
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
  // Bloquer et débloquer sont explicites (28/10/2026) : avant, les deux routes inversaient
  // is_active, si bien que « débloquer » un compte déjà actif le bloquait.
  async banUser(id: number): Promise<User> {
    return this.setActive(id, false);
  }

  async activeUser(id: number): Promise<User> {
    return this.setActive(id, true);
  }

  private async setActive(id: number, active: boolean): Promise<User> {
    const pool = this.DatabaseService.getPool();
    await this.findOne(id);
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
    // Audit 1.5 : blocage ou déblocage → les jetons émis avant ne valent plus
    await bumpTokenVersion(pool, 'id = ?', [id]);
    return this.findOne(id);
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
      // Audit 1.5 : changement de rôle → l'ancien jeton « customer » ne vaut plus
      await bumpTokenVersion(this.DatabaseService, 'id = ?', [userId]);
    } catch (error) {
      console.error("Erreur lors de la mise à jour du rôle :", safeError(error));
      throw new InternalServerErrorException("Impossible de mettre à jour le rôle de l'utilisateur.");
    }

    // 4️⃣ Générer un nouveau token JWT
    let token: string;
    try {
      // Version incrémentée juste au-dessus
      token = signSession({ ...user, token_version: (Number(user.token_version) || 0) + 1 }, 'store_owner');
    } catch (error) {
      console.error("Erreur lors de la génération du token :", safeError(error));
      throw new InternalServerErrorException("Impossible de générer un nouveau token.");
    }


    // 6️⃣ Retourner le token et les permissions
    return {
      token,
      permissions: ['store_owner'],
    };
  }

}      
