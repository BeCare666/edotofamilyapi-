import { CoreEntity } from 'src/common/entities/core.entity';

export class Feedback extends CoreEntity {
  user_id: number;          // ID de l'utilisateur
  product_id: number;       // ID du produit concerné
  model_type: string;       // type de modèle (ex: 'Question')
  model_id: number;         // ID du modèle associé
  positive?: boolean;       // feedback positif
  negative?: boolean;       // feedback négatif
  comment?: string;         // commentaire optionnel
}
