// create-shop.dto.ts
export class CreateShopDto {
  owner_id?: number;
  name: string;
  slug: string;
  description?: string;
  is_active?: boolean;

  // contact et website sont dans ta table shops
  contact?: string;
  website?: string;

  // adresse
  zip?: string;
  city?: string;
  state?: string;
  country?: string;
  street_address?: string;

  // localisation JSON
  location?: Record<string, any>; // ou Location si tu veux taper plus fort

  // images
  cover_image?: {
    url: string;
    key?: string;
    mimeType?: string;
    size?: number;
    originalName?: string;
  };
  logo_image?: {
    url: string;
    key?: string;
    mimeType?: string;
    size?: number;
    originalName?: string;
  };

  // autres
  categories?: number[];
}
