import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from 'src/database/database.services';

@Injectable()
export class AnalyticsCronService {
    private readonly logger = new Logger(AnalyticsCronService.name);

    constructor(private readonly databaseService: DatabaseService) { }

    // Cron toutes les 2 minutes
    @Cron('*/2 * * * *')
    async handleCron() {
        this.logger.debug('Cron: mise à jour des analytics');

        const pool = this.databaseService.getPool();

        try {
            // 1️⃣ Récupérer tous les shops
            const [shops]: any = await pool.query(`SELECT id, owner_id FROM shops`);

            for (const shop of shops) {
                const shopId = shop.id;
                const ownerId = shop.owner_id;

                // 2️⃣ Calculer les analytics par shop
                const [rows]: any = await pool.query(
                    `
          SELECT 
            SUM(oc.subtotal) AS totalRevenue,
            COUNT(DISTINCT o.id) AS totalOrders,
            SUM(CASE WHEN DATE(oc.created_at) = CURDATE() THEN oc.subtotal ELSE 0 END) AS todaysRevenue
          FROM order_children oc
          INNER JOIN orders o ON o.id = oc.order_id
          INNER JOIN products p ON p.id = oc.product_id
          WHERE oc.payment_status = 'payment-success' AND p.shop_id = ?
          `,
                    [shopId],
                );

                const totalRevenue = Number(rows[0].totalRevenue || 0);
                const totalOrders = Number(rows[0].totalOrders || 0);
                const todaysRevenue = Number(rows[0].todaysRevenue || 0);

                // 3️⃣ Compter le nombre de shops de l’owner
                let totalShops = 0;
                if (ownerId) {
                    const [shopCountRow]: any = await pool.query(
                        `SELECT COUNT(*) as totalShops FROM shops WHERE owner_id = ?`,
                        [ownerId],
                    );
                    totalShops = Number(shopCountRow[0]?.totalShops || 0);
                }

                // Compter le nombre de produits et commandes du shop
                const [[productsCountRow]]: any = await pool.query(
                    `SELECT COUNT(*) AS productsCount FROM products WHERE shop_id = ?`,
                    [shopId],
                );
                const productsCount = Number(productsCountRow?.productsCount || 0);

                const [[ordersCountRow]]: any = await pool.query(
                    `
                    SELECT COUNT(DISTINCT o.id) AS ordersCount
                    FROM orders o
                    INNER JOIN order_children oc ON oc.order_id = o.id
                    INNER JOIN products p ON p.id = oc.product_id
                    WHERE p.shop_id = ? AND oc.payment_status = 'payment-success'
                    `,
                    [shopId],
                );
                const ordersCount = Number(ordersCountRow?.ordersCount || 0);

                // 🔄 Mettre à jour la table shops
                await pool.query(
                    `
                    UPDATE shops
                    SET orders_count = ?, products_count = ?, updated_at = NOW()
                    WHERE id = ?
                    `,
                    [ordersCount, productsCount, shopId],
                );

                // 4️⃣ Vérifier si analytics existant
                const [existing]: any = await pool.query(
                    `SELECT id FROM analytics WHERE shop_id = ?`,
                    [shopId],
                );

                // --- Début : Calculs additionnels (ventes mois par mois + status aujourd'hui) ---
                /** Calculer ventes mois par mois (année courante) */
                const [monthlyRows]: any = await pool.query(
                    `SELECT MONTH(oc.created_at) as month, COALESCE(SUM(oc.subtotal),0) as monthSum
                     FROM order_children oc
                     INNER JOIN orders o ON o.id = oc.order_id
                     INNER JOIN products p ON p.id = oc.product_id
                     WHERE oc.payment_status = 'payment-success' AND p.shop_id = ? AND YEAR(oc.created_at) = YEAR(CURDATE())
                     GROUP BY MONTH(oc.created_at)`,
                    [shopId],
                );

                // Construire tableau 12 mois (nombres)
                const monthsArray = Array(12).fill(0);
                for (const r of monthlyRows) {
                    const m = parseInt(r.month, 10); // 1..12
                    monthsArray[m - 1] = Number(r.monthSum) || 0;
                }
                // Transformer en tableau d'objets { total: number } pour compatibilité front
                const monthsArrayObjects = monthsArray.map((v) => ({ total: Number(v || 0) }));

                /** today order status counts */
                const [todayStatusRows]: any = await pool.query(
                    `SELECT oc.payment_status as status, COUNT(*) as cnt
                     FROM order_children oc
                     INNER JOIN orders o ON o.id = oc.order_id
                     INNER JOIN products p ON p.id = oc.product_id
                     WHERE p.shop_id = ? AND DATE(oc.created_at) = CURDATE()
                     GROUP BY oc.payment_status`,
                    [shopId],
                );
                const todayStatusObj: Record<string, number> = {};
                for (const r of todayStatusRows) {
                    todayStatusObj[r.status] = Number(r.cnt) || 0;
                }
                // --- Fin : Calculs additionnels ---

                if (existing.length > 0) {
                    // update (avec champs JSON mis à jour)
                    await pool.query(
                        `
            UPDATE analytics
            SET totalRevenue = ?, totalOrders = ?, todaysRevenue = ?, totalShops = ?, totalYearSaleByMonth = ?, todayTotalOrderByStatus = ?, updated_at = NOW()
            WHERE shop_id = ?
            `,
                        [
                            totalRevenue,
                            totalOrders,
                            todaysRevenue,
                            totalShops,
                            JSON.stringify(monthsArrayObjects),
                            JSON.stringify(todayStatusObj),
                            shopId,
                        ],
                    );
                } else {
                    // insert (avec champs JSON)
                    await pool.query(
                        `
            INSERT INTO analytics (shop_id, totalRevenue, totalOrders, todaysRevenue, totalShops, totalYearSaleByMonth, todayTotalOrderByStatus)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
                        [
                            shopId,
                            totalRevenue,
                            totalOrders,
                            todaysRevenue,
                            totalShops,
                            JSON.stringify(monthsArrayObjects),
                            JSON.stringify(todayStatusObj),
                        ],
                    );
                }
            }

            // 5️⃣ Calculer les analytics globales (admin)
            // --- Début : calculs globaux mois par mois + status aujourd'hui ---
            const [globalRows]: any = await pool.query(
                `
        SELECT 
          SUM(oc.subtotal) AS totalRevenue,
          COUNT(DISTINCT o.id) AS totalOrders,
          SUM(CASE WHEN DATE(oc.created_at) = CURDATE() THEN oc.subtotal ELSE 0 END) AS todaysRevenue
        FROM order_children oc
        INNER JOIN orders o ON o.id = oc.order_id
        WHERE oc.payment_status = 'payment-success'
        `,
            );

            const totalRevenueGlobal = Number(globalRows[0].totalRevenue || 0);
            const totalOrdersGlobal = Number(globalRows[0].totalOrders || 0);
            const todaysRevenueGlobal = Number(globalRows[0].todaysRevenue || 0);

            // calcul mois par mois global (année courante)
            const [globalMonthlyRows]: any = await pool.query(
                `SELECT MONTH(oc.created_at) as month, COALESCE(SUM(oc.subtotal),0) as monthSum
                 FROM order_children oc
                 INNER JOIN orders o ON o.id = oc.order_id
                 WHERE oc.payment_status = 'payment-success' AND YEAR(oc.created_at) = YEAR(CURDATE())
                 GROUP BY MONTH(oc.created_at)`
            );

            const globalMonthsArray = Array(12).fill(0);
            for (const r of globalMonthlyRows) {
                const m = parseInt(r.month, 10);
                globalMonthsArray[m - 1] = Number(r.monthSum) || 0;
            }
            const globalMonthsArrayObjects = globalMonthsArray.map((v) => ({ total: Number(v || 0) }));

            // today global status
            const [globalTodayStatusRows]: any = await pool.query(
                `SELECT oc.payment_status as status, COUNT(*) as cnt
                 FROM order_children oc
                 INNER JOIN orders o ON o.id = oc.order_id
                 WHERE DATE(oc.created_at) = CURDATE() AND oc.payment_status = 'payment-success'
                 GROUP BY oc.payment_status`
            );
            const globalTodayStatusObj: Record<string, number> = {};
            for (const r of globalTodayStatusRows) {
                globalTodayStatusObj[r.status] = Number(r.cnt) || 0;
            }
            // --- Fin : calculs globaux ---

            const [existingAdmin]: any = await pool.query(
                `SELECT id FROM analytics WHERE shop_id IS NULL`,
            );

            if (existingAdmin.length > 0) {
                await pool.query(
                    `
          UPDATE analytics
          SET totalRevenue = ?, totalOrders = ?, todaysRevenue = ?, totalYearSaleByMonth = ?, todayTotalOrderByStatus = ?, updated_at = NOW()
          WHERE shop_id IS NULL
          `,
                    [totalRevenueGlobal, totalOrdersGlobal, todaysRevenueGlobal, JSON.stringify(globalMonthsArrayObjects), JSON.stringify(globalTodayStatusObj)],
                );
            } else {
                await pool.query(
                    `
          INSERT INTO analytics (totalRevenue, totalOrders, todaysRevenue, totalYearSaleByMonth, todayTotalOrderByStatus)
          VALUES (?, ?, ?, ?, ?)
          `,
                    [totalRevenueGlobal, totalOrdersGlobal, todaysRevenueGlobal, JSON.stringify(globalMonthsArrayObjects), JSON.stringify(globalTodayStatusObj)],
                );
            }

            this.logger.debug('Cron: analytics mis à jour avec succès');
        } catch (error) {
            this.logger.error('Erreur lors de la mise à jour des analytics', error);
        }
    }
}
