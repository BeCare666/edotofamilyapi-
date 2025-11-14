import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';

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
    if (!user) return { error: 'Utilisateur introuvable' };

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
      if (!shop) return { error: 'Boutique introuvable pour cet utilisateur' };

      return this.findAll(shop.id);
    }

    // Si autre rôle → pas d’accès
    return { error: 'Accès refusé' };
  }
  async findAll(shopId?: number | null) {
    const pool = this.db.getPool();
    const [rows]: any = await pool.query(
      `SELECT * FROM analytics WHERE ${shopId ? 'shop_id = ?' : 'shop_id IS NULL'} LIMIT 1`,
      shopId ? [shopId] : []
    );

    if (!rows[0]) return null;

    const safeParse = (value: any, fallback: any) => {
      if (value == null) return fallback; // null ou undefined
      if (typeof value === 'string') {
        if (value.trim() === '') return fallback;
        try {
          return JSON.parse(value);
        } catch (e) {
          console.error('❌ JSON parse error for value:', value, e);
          return fallback;
        }
      }
      // Si ce n'est pas une chaîne, on suppose que c'est déjà un objet/tableau
      return value;
    };

    return {
      ...rows[0],
      totalYearSaleByMonth: safeParse(rows[0].totalYearSaleByMonth, []),
      todayTotalOrderByStatus: safeParse(rows[0].todayTotalOrderByStatus, {}),
      weeklyTotalOrderByStatus: safeParse(rows[0].weeklyTotalOrderByStatus, {}),
      monthlyTotalOrderByStatus: safeParse(rows[0].monthlyTotalOrderByStatus, {}),
      yearlyTotalOrderByStatus: safeParse(rows[0].yearlyTotalOrderByStatus, {}),
    };
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
    console.log(`🔍 Recherche du shop pour ownerId=${ownerId}`);

    const [rows]: any = await pool.query(
      `SELECT id, name FROM shops WHERE owner_id = ? LIMIT 1`,
      [ownerId],
    );

    console.log('📦 Résultat SQL shops:', rows);
    return rows[0] || null;
  }


}
