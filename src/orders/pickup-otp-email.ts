// Gabarit de l'e-mail contenant le code de retrait (extrait tel quel de payment-intent.service)
export function buildPickupOtpEmail(trackingNumber: string, otp: string): string {
  return `
<div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 40px rgba(0,0,0,0.06); border: 1px solid #f2f2f2;">
  
  <!-- Header -->
  <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
    <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E·Doto Family" style="height: 72px; margin-bottom: 12px;" />
    <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700; margin: 0;">E·Doto Family</h1>
    <p style="color: #6B7280; font-size: 14px; margin-top: 6px;">Harmonie, bien-être et santé au féminin</p>
  </div>

  <!-- Body -->
  <div style="padding: 40px 30px; background-color: #ffffff; text-align: center;">
    <h2 style="color: #111827; font-size: 20px; margin-bottom: 12px;">Retrait de votre commande 🌸</h2>
    <p style="color: #4B5563; font-size: 15px; line-height: 1.7; margin: 0 auto; max-width: 460px;">
      Pour retirer votre commande <strong>${trackingNumber}</strong>, utilisez le code ci-dessous :
    </p>

    <!-- OTP / Code -->
    <div style="font-size: 28px; font-weight: 700; color: #FF6EA9; margin: 30px 0; padding: 14px 24px; background: #FFF0F5; border-radius: 12px; display: inline-block; letter-spacing: 2px;">
      ${otp}
    </div>

    <p style="color: #6B7280; font-size: 14px; line-height: 1.6;">
      Ce code est valable pendant <strong>48 heures</strong> et ne peut être utilisé qu'une seule fois.<br/>
      Présentez-le au livreur ou au point de retrait lors de la récupération.
    </p>
  </div>

  <!-- Footer -->
  <div style="background: #fafafa; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
    <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
      © ${new Date().getFullYear()} E·Doto Family — Tous droits réservés<br />
      <a href="https://edotofamily.com" style="color: #FF6EA9; text-decoration: none;">www.edotofamily.com</a>
    </p>
  </div>

</div>
      `;
}

export const PICKUP_OTP_EMAIL_SUBJECT = `Votre code de retrait - E·Doto Family`;

// Durée de validité annoncée dans l'e-mail
export const PICKUP_OTP_TTL_MS = 48 * 60 * 60 * 1000;
