import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';

@Injectable()
export class ProductCorridorService {
    constructor(private readonly db: DatabaseService) { }

    async getUnlinkedProducts() {
        const [rows]: any[] = await this.db.getPool().query(`
      SELECT * FROM products
      WHERE id NOT IN (
        SELECT DISTINCT produit_id FROM corridors_produits
      )
    `);
        return rows;
    }

    async getValidCorridors(productId: number) {
        const [productRows]: any[] = await this.db.getPool().query(
            'SELECT id, countries_id FROM products WHERE id = ?',
            [productId]
        );

        if (productRows.length === 0) {
            throw new NotFoundException('Produit introuvable');
        }

        const productCountryId = productRows[0].countries_id;

        const [validCorridors]: any[] = await this.db.getPool().query(
            `
      SELECT c.*
      FROM corridors c
      WHERE c.id NOT IN (
        SELECT corridor_id FROM corridors_produits WHERE produit_id = ?
      )
      `,
            [productId]
        );

        return validCorridors;
    }

    async linkProductToCorridors(productId: number, corridorIds: number[]) {
        if (!corridorIds.length) {
            throw new Error('Aucun corridor sélectionné');
        }

        const values = corridorIds.map(id => [productId, id]);

        await this.db.getPool().query(
            `INSERT INTO corridors_produits (produit_id, corridor_id) VALUES ?`,
            [values]
        );

        return { message: 'Corridors liés avec succès.' };
    }
}
