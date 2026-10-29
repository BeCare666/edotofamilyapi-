/**
 * Journal des accès aux dossiers de santé (audit sécurité 2.5, 29/10/2026), table health_access_log (migration 018).
 * Un échec d'écriture ne bloque pas la consultation du dossier : il est signalé dans les journaux.
 */
export type HealthAccess = {
  actorUserId: number;
  actorRole: 'doctor' | 'health_center' | 'super_admin';
  patientUserId: number | null;
  resource: 'tc_appointment' | 'tc_referral' | 'contraception_request';
  resourceId: number;
  ip: string | null;
};

export async function logHealthAccess(pool: any, e: HealthAccess): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO health_access_log (actor_user_id, actor_role, patient_user_id, resource, resource_id, ip) VALUES (?, ?, ?, ?, ?, ?)`,
      [e.actorUserId, e.actorRole, e.patientUserId, e.resource, e.resourceId, e.ip],
    );
  } catch (err: any) {
    console.error(`[santé] journal d’accès non écrit (${e.resource} ${e.resourceId}) :`, err?.message);
  }
}
