import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';
import { safeError } from '../common/request-log';

@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DatabaseService) { }

  async findAllByUser(userId: number) {
    const pool = this.db.getPool();


    // Récupère le rôle de l'utilisateur

    const [userRows]: any = await pool.query(
      `SELECT role FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );


    const user = userRows[0];


    if (!user) {
      console.error('❌ Utilisateur introuvable pour ID:', userId);
      return { error: 'Utilisateur introuvable' };
    }


    // Super admin → récupère toutes les analytics
    if (user.role === 'super_admin') {
      return this.findAll(); // sans shopId
    }

    // Store owner → récupère l'id de sa boutique
    if (user.role === 'store_owner') {

      const [shopRows]: any = await pool.query(
        `SELECT id FROM shops WHERE owner_id = ? LIMIT 1`,
        [userId]
      );


      const shop = shopRows[0];


      if (!shop) {
        console.error('❌ Boutique introuvable pour user:', userId);
        return { error: 'Boutique introuvable pour cet utilisateur' };
      }


      return this.findAll(shop.id);
    }

    console.warn('⚠️ Accès refusé pour role:', user.role);

    // Si autre rôle → pas d’accès
    return { error: 'Accès refusé' };
  }
  async findAll(shopId?: number | null) {
    const pool = this.db.getPool();


    const query = `SELECT * FROM analytics WHERE ${shopId ? 'shop_id = ?' : 'shop_id IS NULL'} LIMIT 1`;


    const [rows]: any = await pool.query(
      query,
      shopId ? [shopId] : []
    );


    if (!rows[0]) {
      console.warn('⚠️ Aucun résultat dans analytics');
      return null;
    }

    const safeParse = (value: any, fallback: any) => {
      if (value == null) return fallback;
      if (typeof value === 'string') {
        if (value.trim() === '') return fallback;
        try {
          return JSON.parse(value);
        } catch (e) {
          console.error('❌ JSON parse error pour value:', value, safeError(e));
          return fallback;
        }
      }
      return value;
    };

    const result = {
      ...rows[0],
      totalYearSaleByMonth: safeParse(rows[0].totalYearSaleByMonth, []),
      todayTotalOrderByStatus: safeParse(rows[0].todayTotalOrderByStatus, {}),
      weeklyTotalOrderByStatus: safeParse(rows[0].weeklyTotalOrderByStatus, {}),
      monthlyTotalOrderByStatus: safeParse(rows[0].monthlyTotalOrderByStatus, {}),
      yearlyTotalOrderByStatus: safeParse(rows[0].yearlyTotalOrderByStatus, {}),
    };


    return result;
  }



  // 📦 Produits par catégorie
  async findAllCategoryWiseProduct() {
    const pool = this.db.getPool();
    const [rows] = await pool.query(`
      SELECT c.name as category, COUNT(p.id) as productCount
      FROM product_categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY productCount DESC
      LIMIT 10
    `);
    return rows;
  }

  async findAllLowStockProducts() {
    const pool = this.db.getPool();
    const [rows] = await pool.query(`
      SELECT id, name, stock, price
      FROM products
      WHERE stock < 10
      ORDER BY stock ASC
      LIMIT 10
    `);
    return rows;
  }

  async findAllTopRateProduct() {
    const pool = this.db.getPool();
    const [rows] = await pool.query(`
      SELECT id, name, rating, price
      FROM products
      ORDER BY rating DESC
      LIMIT 10
    `);
    return rows;
  }

  // 🔹 Helper pour récupérer le shop d’un store_owner
  async getShopByOwnerId(ownerId: number) {
    const pool = this.db.getPool();

    const [rows]: any = await pool.query(
      `SELECT id, name FROM shops WHERE owner_id = ? LIMIT 1`,
      [ownerId],
    );

    return rows[0] || null;
  }


}
