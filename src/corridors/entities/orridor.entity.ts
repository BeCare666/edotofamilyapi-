export class Corridor {
    id: string;
    from_pays_id: number;
    to_pays_id: number;
    douanes?: string;
    taxes?: string;
    logistique?: string;
    produits_ids?: number[]; // liaison via corridors_produits
    created_at?: Date;
    updated_at?: Date;
}
