import * as SibApiV3Sdk from 'sib-api-v3-sdk';
import { brevoErrorReason, sendVerificationEmail } from '../auth/mailer';
import { INVITATION_TTL_DAYS, MODE_LABEL, Mode, beninLabel, formatShortCode, jitsiUrl } from './tc-rules';
import { maskPhone } from '../common/request-log';

// Téléconsultation : e-mails (Brevo, même envoi que le reste du site) et SMS (Brevo, décision du 19/10/2026).
// Le SMS demande des crédits SMS sur le compte Brevo ; l'expéditeur se règle avec BREVO_SMS_SENDER
// (11 caractères au plus, lettres et chiffres).

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const siteUrl = () => (process.env.FRONTEND_CALLBACK_URL || 'https://edotofamily.com').replace(/\/+$/, '');
export const apiUrl = () => (process.env.BASE_URL || '').replace(/\/+$/, '');

/** Numéro au format international sans « + » (Bénin par défaut pour un numéro local) */
export function smsRecipient(phone: string | null | undefined): string | null {
  const raw = String(phone ?? '').replace(/[^\d+]/g, '');
  if (!raw) return null;
  if (raw.startsWith('+')) return raw.slice(1);
  if (raw.startsWith('00')) return raw.slice(2);
  if (raw.startsWith('229')) return raw;
  return `229${raw}`;
}

export async function sendSms(phone: string | null | undefined, content: string): Promise<void> {
  const key = String(process.env.BREVO_API_KEY ?? '').trim();
  if (!key) throw new Error('Brevo : BREVO_API_KEY absente de la configuration du serveur.');
  const recipient = smsRecipient(phone);
  if (!recipient) throw new Error('Numéro de téléphone absent.');
  SibApiV3Sdk.ApiClient.instance.authentications['api-key'].apiKey = key;
  const api = new SibApiV3Sdk.TransactionalSMSApi();
  const sms = new SibApiV3Sdk.SendTransacSms();
  sms.sender = String(process.env.BREVO_SMS_SENDER || 'EdotoFamily').slice(0, 11);
  sms.recipient = recipient;
  sms.content = content;
  sms.type = 'transactional';
  try {
    await api.sendTransacSms(sms);
  } catch (error) {
    const reason = brevoErrorReason(error);
    console.error(`[sms] Envoi refusé vers ${maskPhone(recipient)} : ${reason}`);
    throw new Error(reason);
  }
}

// Cadre commun des e-mails (même présentation que les e-mails sponsor)
export function frame(kicker: string, body: string) {
  return `
  <div style="font-family: Poppins, Inter, Arial, sans-serif; max-width: 620px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #E9E5DF;">
    <div style="background: #1A1814; padding: 28px; text-align: center;">
      <p style="color: #ffffff; font-size: 22px; margin: 0;">E.doto family</p>
      <p style="color: #B8AC9E; font-size: 12px; letter-spacing: 3px; margin: 6px 0 0;">${esc(kicker)}</p>
    </div>
    <div style="padding: 30px 28px; color: #1A1814; font-size: 15px; line-height: 1.6;">${body}</div>
    <div style="padding: 16px 28px; border-top: 1px solid #E9E5DF; color: #8A837A; font-size: 12px; text-align: center;">
      Échange confidentiel entre vous et un professionnel de santé E.doto family.
    </div>
  </div>`;
}
export const button = (href: string, label: string) =>
  `<p style="text-align:center;margin:24px 0;"><a href="${href}" style="display:inline-block;padding:14px 28px;background:#C2185B;color:#ffffff;border-radius:12px;text-decoration:none;font-weight:600;">${esc(label)}</a></p>`;
const row = (k: string, v: string) =>
  `<tr><td style="padding:8px 0;color:#8A837A;font-size:13px;width:38%;vertical-align:top;">${esc(k)}</td><td style="padding:8px 0;color:#1A1814;font-size:14px;">${v}</td></tr>`;

export type ApptMail = {
  reference: string;
  mode: Mode;
  starts_at: Date | string;
  patient_name: string;
  patient_email?: string | null;
  patient_phone?: string | null;
  doctor_name: string;
  doctor_title?: string | null;
  room?: string | null;
  reason?: string | null;
};

export function bookingConfirmationEmail(a: ApptMail) {
  const when = beninLabel(a.starts_at);
  const how =
    a.mode === 'video'
      ? `<p>Le jour J, cliquez sur le bouton ci-dessous quelques minutes avant l'heure : la visio s'ouvre dans votre navigateur, sans installation. Vous recevrez aussi un rappel par e-mail juste avant.</p>${button(jitsiUrl(a.room!), 'Rejoindre la visio')}`
      : `<p>Le médecin vous appellera au <strong>${esc(a.patient_phone)}</strong> à l'heure du rendez-vous. Vous recevrez un SMS de rappel juste avant : restez joignable et dans un endroit calme.</p>`;
  return frame(
    'TÉLÉCONSULTATION',
    `<p>Bonjour <strong>${esc(a.patient_name)}</strong>,</p>
     <p>Votre rendez-vous est confirmé.</p>
     <table style="width:100%;border-collapse:collapse;margin:12px 0 4px;">
       ${row('Date', esc(when))}
       ${row('Mode', esc(MODE_LABEL[a.mode]))}
       ${row('Professionnel', `${esc(a.doctor_name)}${a.doctor_title ? `, ${esc(a.doctor_title)}` : ''}`)}
       ${row('Référence', esc(a.reference))}
     </table>
     ${how}
     <p style="font-size:13px;color:#57524B;">Vous retrouvez ce rendez-vous dans votre dashboard, où vous pouvez aussi l'annuler.</p>
     ${button(`${siteUrl()}/mon-espace`, 'Ouvrir mon dashboard')}`,
  );
}

export function doctorNewBookingEmail(a: ApptMail) {
  return frame(
    'ESPACE MÉDECIN',
    `<p>Bonjour <strong>${esc(a.doctor_name)}</strong>,</p>
     <p>Un nouveau rendez-vous de téléconsultation vient d'être réservé.</p>
     <table style="width:100%;border-collapse:collapse;margin:12px 0 4px;">
       ${row('Date', esc(beninLabel(a.starts_at)))}
       ${row('Mode', esc(MODE_LABEL[a.mode]))}
       ${row('Patient', esc(a.patient_name))}
       ${row('Référence', esc(a.reference))}
     </table>
     ${button(`${siteUrl()}/medecin`, 'Ouvrir mon espace médecin')}`,
  );
}

export function videoReminderEmail(a: ApptMail) {
  return frame(
    'RAPPEL',
    `<p>Bonjour <strong>${esc(a.patient_name)}</strong>,</p>
     <p>Votre téléconsultation en visio commence <strong>${esc(beninLabel(a.starts_at))}</strong> avec ${esc(a.doctor_name)}.</p>
     <p>Installez vous dans un endroit calme, avec un écouteur si possible, puis rejoignez la visio :</p>
     ${button(jitsiUrl(a.room!), 'Rejoindre la visio maintenant')}
     <p style="font-size:13px;color:#57524B;">Référence : ${esc(a.reference)}</p>`,
  );
}

export function phoneReminderSms(a: ApptMail) {
  const t = new Date(a.starts_at).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Porto-Novo', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return `E.doto family : votre teleconsultation commence a ${t}. Le medecin va vous appeler a ce numero. Restez joignable. Ref ${a.reference}`;
}

export function cancellationEmail(a: ApptMail, toDoctor: boolean, reason?: string | null) {
  return frame(
    toDoctor ? 'ESPACE MÉDECIN' : 'TÉLÉCONSULTATION',
    `<p>Bonjour <strong>${esc(toDoctor ? a.doctor_name : a.patient_name)}</strong>,</p>
     <p>Le rendez-vous du <strong>${esc(beninLabel(a.starts_at))}</strong> (${esc(MODE_LABEL[a.mode])}, référence ${esc(a.reference)}) est annulé.</p>
     ${reason ? `<p>Motif : ${esc(reason)}</p>` : ''}
     ${toDoctor ? '' : button(`${siteUrl()}/mon-espace`, 'Reprendre un rendez-vous')}`,
  );
}

export type ReferralMail = {
  patient_name: string;
  mode: Mode;
  token: string;
  short_code: string;
  expires_at: Date | string;
  center: { name: string; organization_label: string; address?: string | null; city?: string | null; phone?: string | null; opening_hours?: string | null };
  patient_summary?: string | null;
  doctor_name: string;
  // Phrase d'introduction (orientation sans téléconsultation : contraceptif sans médecin)
  intro?: string | null;
};

export function referralEmail(r: ReferralMail) {
  const qrPage = `${siteUrl()}/qr/${r.token}`;
  const qrImg = `${apiUrl()}/teleconsultation/qr/${r.token}.png`;
  const where = [r.center.address, r.center.city].filter(Boolean).map(esc).join(', ');
  return frame(
    'VOTRE ORIENTATION',
    `<p>Bonjour <strong>${esc(r.patient_name)}</strong>,</p>
     <p>${r.intro ? esc(r.intro) : `Suite à votre téléconsultation avec ${esc(r.doctor_name)}, vous êtes orienté(e) vers le centre ci-dessous.`}
        Présentez simplement ce code QR à l'accueil : le professionnel du centre verra directement votre dossier, sans avoir à vous reposer de questions.</p>
     <p style="text-align:center;margin:22px 0 8px;"><img src="${qrImg}" width="220" height="220" alt="Code QR de votre orientation" style="border:1px solid #E9E5DF;border-radius:12px;padding:10px;background:#fff;" /></p>
     <p style="text-align:center;margin:0 0 4px;color:#8A837A;font-size:12px;letter-spacing:2px;">CODE DE SECOURS</p>
     <p style="text-align:center;margin:0 0 18px;font-family:'Courier New',monospace;font-size:24px;font-weight:700;letter-spacing:4px;">${esc(formatShortCode(r.short_code))}</p>
     ${button(qrPage, 'Afficher en grand ou télécharger le code QR')}
     <table style="width:100%;border-collapse:collapse;margin:8px 0;">
       ${row('Centre', `${esc(r.center.name)} (${esc(r.center.organization_label)})`)}
       ${where ? row('Adresse', where) : ''}
       ${r.center.phone ? row('Téléphone', esc(r.center.phone)) : ''}
       ${r.center.opening_hours ? row('Horaires', esc(r.center.opening_hours)) : ''}
       ${row('Valable jusqu’au', esc(beninLabel(r.expires_at, false)))}
     </table>
     ${r.patient_summary ? `<div style="margin-top:16px;padding:16px;border:1px solid #E9E5DF;border-radius:12px;background:#F9F8F6;"><p style="margin:0 0 6px;color:#8A837A;font-size:12px;letter-spacing:2px;">LE MOT DU MÉDECIN</p><p style="margin:0;white-space:pre-line;">${esc(r.patient_summary)}</p></div>` : ''}
     <p style="font-size:13px;color:#57524B;margin-top:18px;">Ce code est personnel : ne le partagez pas. Il est aussi disponible dans votre dashboard.</p>`,
  );
}

export function referralSms(r: ReferralMail) {
  return `E.doto family : vous etes oriente(e) vers ${r.center.name}. Presentez ce code a l'accueil : ${formatShortCode(r.short_code)}. Code QR : ${siteUrl()}/qr/${r.token}`;
}

export function invitationEmail(kind: 'doctor' | 'center', name: string, link: string) {
  const space = kind === 'doctor' ? 'ESPACE MÉDECIN' : 'ESPACE CENTRE';
  const text =
    kind === 'doctor'
      ? 'E.doto family vous invite à rejoindre son équipe de téléconsultation : vous y fixerez vos disponibilités, retrouverez vos rendez-vous et rédigerez vos comptes rendus.'
      : 'E.doto family vous invite à activer l’espace de votre centre : vous y recevrez les jeunes orientés par nos médecins et ouvrirez leur dossier en scannant leur code QR.';
  return frame(
    space,
    `<p style="text-align:center;">Bonjour <strong>${esc(name)}</strong>,</p>
     <p style="text-align:center;color:#57524B;">${text} Choisissez votre mot de passe en cliquant sur le bouton ci-dessous.</p>
     ${button(link, 'Activer mon espace')}
     <p style="text-align:center;font-size:13px;color:#8A837A;">Ce lien est valable ${INVITATION_TTL_DAYS} jours.</p>`,
  );
}

export async function mail(email: string | null | undefined, subject: string, message: string) {
  // Adresse provisoire (domaine .invalid, ex. médecin E.doto family pas encore renseigné) : aucun envoi
  if (!email || /\.invalid$/i.test(email.trim())) return;
  await sendVerificationEmail({ email, subject, message });
}
