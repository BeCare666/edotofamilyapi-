export class CreateCampaignDto {
  title!: string;
  description?: string;
  image_url?: string;
  location!: string;
  date_start!: string;
  date_end?: string | null;
  status?: 'a_venir' | 'planifie' | 'en_cours';
  objective_kits?: number;
}