// pickup.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.services';

@Injectable()
export class PickupService {
    constructor(private db: DatabaseService) { }

    async getPickupPoint(userId: number) {
        const pool = this.db.getPool();
        const [rows]: any = await pool.query(
            `SELECT id, name, pickup_lat, pickup_lng, pickup_address 
       FROM users 
       WHERE id = ? AND role = 'super_pickuppoint'`,
            [userId]
        );
        return rows[0] || null;
    }

    async getAllPickupPoints() {
        const pool = this.db.getPool();
        const [rows]: any = await pool.query(
            `SELECT id, name, pickup_lat, pickup_lng, pickup_address 
       FROM users 
       WHERE role = 'super_pickuppoint'`
        );
        return rows;
    }
}