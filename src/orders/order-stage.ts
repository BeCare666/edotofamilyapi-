import { BadRequestException } from '@nestjs/common';

// Étapes de suivi côté admin (06/10/2026) :
//  - « à traiter » : pas encore préparée par l'admin et pas retirée (la liste générale) ;
//  - « traitée »   : l'admin a préparé le colis (processed_at), pas encore retirée ;
//  - « retirée »   : retirée / livrée — c'est là qu'elle est « terminée » (statut existant order-completed).
// Seule une commande PAYÉE peut être traitée ; une commande retirée ne change plus d'étape.
export type Stage = 'to_process' | 'processed' | 'withdrawn';
export const STAGES: Stage[] = ['to_process', 'processed', 'withdrawn'];

// Commande retirée : même règle que le site (code validé ou statut terminé)
export const ORDER_WITHDRAWN_SQL = `(order_status = 'order-completed' OR otp_used = 1)`;
// Demande de kit retirée : kit remis par le point de retrait
export const KIT_WITHDRAWN_SQL = `(picked_up = 1 OR order_status = 'order-completed')`;

export function stageSql(stage: any, withdrawnSql: string): string | null {
  if (stage === 'to_process') return `(processed_at IS NULL AND NOT ${withdrawnSql})`;
  if (stage === 'processed') return `(processed_at IS NOT NULL AND NOT ${withdrawnSql})`;
  if (stage === 'withdrawn') return withdrawnSql;
  return null;
}

// Compteurs des 3 étapes dans un périmètre donné (WHERE déjà construit)
export function stageCountsSql(withdrawnSql: string) {
  return `SUM(processed_at IS NULL AND NOT ${withdrawnSql}) AS to_process,
          SUM(processed_at IS NOT NULL AND NOT ${withdrawnSql}) AS processed,
          SUM(${withdrawnSql}) AS withdrawn`;
}

const STOPPED = ['order-cancelled', 'order-refunded', 'order-failed'];

// Règles du bouton « Traiter » / « Annuler le traitement » (commande ou demande de kit)
export function assertCanChangeProcessing(row: any, processed: boolean, kind: 'order' | 'kit') {
  const withdrawn = kind === 'order'
    ? row.order_status === 'order-completed' || Number(row.otp_used) === 1
    : Number(row.picked_up) === 1 || row.order_status === 'order-completed';
  if (withdrawn) throw new BadRequestException(kind === 'order' ? 'Commande déjà retirée : elle est terminée.' : 'Kit déjà retiré.');
  if (STOPPED.includes(row.order_status)) throw new BadRequestException(kind === 'order' ? 'Commande annulée, remboursée ou échouée.' : 'Demande annulée.');
  if (kind === 'order' && processed && row.payment_status !== 'payment-success') {
    throw new BadRequestException('Commande non payée : elle ne peut pas encore être traitée.');
  }
  if (processed && row.processed_at) throw new BadRequestException('Déjà traitée.');
  if (!processed && !row.processed_at) throw new BadRequestException("Elle n'est pas traitée.");
}
