import * as SibApiV3Sdk from 'sib-api-v3-sdk';
import { maskEmail } from '../common/request-log';

/**
 * Lit le vrai motif renvoyé par Brevo (ex. « unrecognised IP address », « Key not found »,
 * « sender not valid ») au lieu de l'objet d'erreur HTTP complet, illisible dans les journaux.
 */
export function brevoErrorReason(error: any): string {
  const body = error?.response?.body ?? error?.body;
  const status = error?.status ?? error?.response?.status;
  const reason = body?.message || body?.code || error?.message || String(error);
  return status ? `Brevo ${status} : ${reason}` : `Brevo : ${reason}`;
}

export async function sendVerificationEmail({ email, subject, message }) {
  // .env peut contenir des espaces ou un \r en fin de ligne : Brevo refuse alors la clé.
  const key = String(process.env.BREVO_API_KEY ?? '').trim();
  if (!key) throw new Error('Brevo : BREVO_API_KEY absente de la configuration du serveur.');

  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications['api-key'];
  apiKey.apiKey = key; // clé API depuis le compte Brevo.

  const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  sendSmtpEmail.sender = { email: "edotofamily@gmail.com", name: "E.doto family" };
  sendSmtpEmail.to = [{ email }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = message;

  try {
    await tranEmailApi.sendTransacEmail(sendSmtpEmail);
  } catch (error) {
    const reason = brevoErrorReason(error);
    console.error(`[mailer] Envoi refusé vers ${maskEmail(email)} : ${reason}`);
    throw new Error(reason);
  }
}
