import * as SibApiV3Sdk from 'sib-api-v3-sdk';

export async function sendVerificationEmail({ email, subject, message }) {
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications['api-key'];
  apiKey.apiKey = process.env.BREVO_API_KEY; // clé API depuis ton compte Brevo.

  const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  sendSmtpEmail.sender = { email: "edotofamily@gmail.com", name: "e-doto family" };
  sendSmtpEmail.to = [{ email }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = message;

  await tranEmailApi.sendTransacEmail(sendSmtpEmail);
}
