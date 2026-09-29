// Gabarit de l'e-mail du code de retrait de kit (extrait tel quel de campaigns.service)
export function buildCampaignOtpEmail(pickupCenterName: string, otp: string): string {
  return `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden;">

    <!-- HEADER -->
    <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
      <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E·Doto Family" style="height: 72px;" />
      <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700;">Retrait de votre kit gratuit</h1>
    </div>

    <!-- CONTENT. --> 
    <div style="padding: 40px 30px; text-align: center;">
      <h2 style="color: #111827; font-size: 20px;">Votre code de retrait 🎁</h2>

      <p style="color: #4B5563; font-size: 15px; max-width: 460px; margin: auto;">
        Vous êtes inscrit la campagne de kits SSR. </strong>.<br/>
        Pour retirer votre kit gratuit, rendez-vous au point de retrait :
        <br/><br/>
        <strong style="color:#FF6EA9; font-size:16px;">${pickupCenterName}</strong>
      </p>

      <div style="font-size: 28px; font-weight: 700; color: #FF6EA9; margin: 30px 0; background: #FFF0F5; padding: 14px 24px; border-radius: 12px;">
        ${otp}
      </div>

      <p style="color: #6B7280; font-size: 14px;">
        Présentez ce code à l’agent sur place pour récupérer votre kit.<br/>
        Le code est valable <strong>48 heures</strong>.<br/>
        Gardez-le confidentiel.
      </p>
    </div>

    <!-- FOOTER -->
    <div style="background: #fafafa; padding: 20px; text-align: center;">
      <p style="color: #9CA3AF; font-size: 12px;">
        © ${new Date().getFullYear()} E·Doto Family — Tous droits réservés
      </p>
    </div>

    
  </div>
  `;
}

export const CAMPAIGN_OTP_EMAIL_SUBJECT = `Code de retrait de campagne - E·Doto Family`;

// Durée de validité du code annoncée dans l'e-mail
export const CAMPAIGN_OTP_TTL_MS = 48 * 60 * 60 * 1000;
