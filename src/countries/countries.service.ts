// src/countries/countries.service.ts
import { Injectable } from '@nestjs/common';
import { CreateCountryDto } from './dto/create-countries.dto';
import { DatabaseService } from '../database/database.services';
import { OkPacket } from 'mysql2';

@Injectable()
export class CountriesService {
    constructor(private readonly db: DatabaseService) { }

    async createCountry(dto: CreateCountryDto): Promise<any> {
        const {
            name, slug, code, iso3, phone_code, currency, continent, flag_url
        } = dto;

        const [result]: [OkPacket, any] = await this.db.query<OkPacket>(
            `
      INSERT INTO countries
      (name, slug, code, iso3, phone_code, currency, continent, flag_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
            [name, slug, code, iso3, phone_code, currency, continent, flag_url]
        );

        return { id: result.insertId, ...dto };
    }

    async createMany(countries: CreateCountryDto[]): Promise<any[]> {
        const inserted: any[] = [];
        for (const dto of countries) {
            try {
                const res = await this.createCountry(dto);
                inserted.push(res);
            } catch (e: any) {
                inserted.push({ error: e.message, country: dto });
            }
        }
        return inserted;
    }

    async findAll(): Promise<any[]> {
        const [rows]: [any[], any] = await this.db.query(
            `SELECT * FROM countries ORDER BY name ASC`
        );
        return rows;
    }

    async findOne(id: number): Promise<any> {
        const [rows]: [any[], any] = await this.db.query(
            `SELECT * FROM countries WHERE id = ?`,
            [id]
        );
        return rows[0];
    }

    async remove(id: number): Promise<{ deleted: boolean }> {
        const [result]: [OkPacket, any] = await this.db.query<OkPacket>(
            `DELETE FROM countries WHERE id = ?`,
            [id]
        );
        return { deleted: result.affectedRows > 0 };
    }
}
