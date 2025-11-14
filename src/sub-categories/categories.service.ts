import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { GetCategoriesDto } from './dto/get-categories.dto';
import { paginate } from 'src/common/pagination/paginate';
import categoriesData from '@db/edotofamily_categories_full.json';
import { readFileSync } from 'fs';
import { join } from 'path';
export interface SubCategorie {
  id: number;
  name: string;
  slug: string;
  sous_categories_id: number;
  icon?: string | null;
  details?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  sous_category_name?: string | null;
}

@Injectable()
export class CategoriesService {
  private subCategories: SubCategorie[];

  constructor() {
    let filePath = join(__dirname, '..', 'db', 'pixer', 'edotofamily_categories_full.json');

    try {
      // Essai avec dist/ (prod)
      const raw = readFileSync(filePath, 'utf8');
      const categoriesData = JSON.parse(raw);

      this.subCategories = (categoriesData.sub_categories || []).map((sc: any) => ({
        ...sc,
        icon: sc.icon ?? null,
        details: sc.details ?? null,
        created_at: sc.created_at ?? null,
        updated_at: sc.updated_at ?? null,
        sous_category_name:
          (categoriesData.sub_categories || []).find(
            (ssc: any) => ssc.id === sc.sous_categories_id,
          )?.name || null,
      }));
    } catch (err) {
      // Fallback sur src/ (dev)
      filePath = join(process.cwd(), 'src', 'db', 'edotofamily_categories_full.json');
      const raw = readFileSync(filePath, 'utf8');
      const categoriesData = JSON.parse(raw);

      this.subCategories = (categoriesData.sub_categories || []).map((sc: any) => ({
        ...sc,
        icon: sc.icon ?? null,
        details: sc.details ?? null,
        created_at: sc.created_at ?? null,
        updated_at: sc.updated_at ?? null,
        sous_category_name:
          (categoriesData.sub_categories || []).find(
            (ssc: any) => ssc.id === sc.sous_categories_id,
          )?.name || null,
      }));
    }
  }

  async create(dto: CreateCategoryDto) {
    const newSubCat: SubCategorie = {
      id: this.subCategories.length
        ? Math.max(...this.subCategories.map((c) => c.id)) + 1
        : 1,
      name: dto.name,
      slug: dto.slug,
      sous_categories_id: dto.sous_categories_id ?? null,
      icon: dto.icon ?? null,
      details: dto.details ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sous_category_name:
        (categoriesData as any).sous_categories.find(
          (ssc: any) => ssc.id === dto.sous_categories_id,
        )?.name || null,
    };
    this.subCategories.push(newSubCat);
    return newSubCat;
  }

  async createMany(dtos: CreateCategoryDto[]) {
    return Promise.all(dtos.map((dto) => this.create(dto)));
  }

  async findByCategoryId(categoryIds: number | number[] | string) {
    let ids: number[] = [];

    if (Array.isArray(categoryIds)) {
      ids = categoryIds.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    } else if (typeof categoryIds === 'string') {
      ids = categoryIds
        .split(',')
        .map((s) => s.trim())
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
    } else if (typeof categoryIds === 'number') {
      if (Number.isFinite(categoryIds) && categoryIds > 0) ids = [categoryIds];
    }

    if (!ids.length) return [];

    return this.subCategories
      .filter((sc) => ids.includes(sc.sous_categories_id))
      .map((sc) => ({
        ...sc,
        has_children: this.subCategories.some(
          (child) => child.sous_categories_id === sc.id,
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getCategories({ limit = 200, page = 1, search }: GetCategoriesDto) {
    const numericLimit = Number(limit);
    const numericPage = Number(page);

    let filtered = [...this.subCategories];

    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          c.slug.toLowerCase().includes(s),
      );
    }

    filtered.sort((a, b) => {
      const dateA = a.created_at || '';
      const dateB = b.created_at || '';
      return dateA < dateB ? 1 : dateA > dateB ? -1 : 0;
    });

    const total = filtered.length;
    const start = (numericPage - 1) * numericLimit;
    const data = filtered.slice(start, start + numericLimit);

    const url = `/sub_categories?search=${search || ''}&limit=${limit}`;

    return {
      data,
      ...paginate(total, numericPage, numericLimit, data.length, url),
    };
  }

  async getCategory(param: string, language: string) {
    return this.subCategories.find(
      (c) => c.id === Number(param) || c.slug === param,
    );
  }

  async update(id: number, dto: UpdateCategoryDto) {
    const index = this.subCategories.findIndex((c) => c.id === id);
    if (index === -1) return null;

    this.subCategories[index] = {
      ...this.subCategories[index],
      ...dto,
      updated_at: new Date().toISOString(),
      sous_category_name:
        (categoriesData as any).sous_categories.find(
          (ssc: any) => ssc.id === dto.sous_categories_id,
        )?.name || this.subCategories[index].sous_category_name,
    };
    return this.subCategories[index];
  }

  async remove(id: number) {
    const index = this.subCategories.findIndex((c) => c.id === id);
    if (index === -1) return null;

    const deleted = this.subCategories.splice(index, 1)[0];
    return deleted;
  }
}
