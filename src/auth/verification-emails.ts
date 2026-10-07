// Gabarits des e-mails de confirmation d'adresse (extraits tels quels de auth.service)
export function buildCustomerVerificationEmail(verificationLink: string): string {
  return `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 40px rgba(0,0,0,0.06); border: 1px solid #f2f2f2;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
      <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E.doto family" style="height: 72px; margin-bottom: 12px;" />
      <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700; margin: 0;">E.doto family</h1>
      <p style="color: #6B7280; font-size: 14px; margin-top: 6px;">Harmonie, bien-être et santé au féminin</p>
    </div>

    <!-- Body -->
    <div style="padding: 40px 30px; background-color: #ffffff;">
      <h2 style="color: #111827; font-size: 20px; margin-bottom: 12px; text-align: center;">Bienvenue dans la famille 🌸</h2>
      <p style="color: #4B5563; font-size: 15px; line-height: 1.7; text-align: center; margin: 0 auto; max-width: 460px;">
        Merci de t’être inscrite sur <strong>E.doto family</strong>.  
        Pour activer ton compte et rejoindre notre communauté,  
        confirme ton adresse e-mail en cliquant sur le bouton ci-dessous :
      </p>

      <!-- Call to Action -->
      <div style="text-align: center; margin: 36px 0;">
        <a href="${verificationLink}"
          style="background: linear-gradient(135deg, #FF6EA9, #ff579d); color: #fff; padding: 14px 36px;
                 border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;
                 display: inline-block; box-shadow: 0 3px 10px rgba(255,110,169,0.3); transition: all 0.3s ease;">
          Confirmer mon e-mail
        </a>
      </div>

      <p style="color: #6B7280; font-size: 14px; line-height: 1.6; text-align: center;">
        Ce lien expirera dans <strong>5 minutes</strong> pour des raisons de sécurité.  
        Si tu n’as pas créé de compte, ignore simplement cet e-mail.
      </p>

      <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 36px 0;" />

      <p style="color: #9CA3AF; font-size: 13px; text-align: center;">
        Merci pour ta confiance 💖<br />
        L’équipe <strong style="color: #FF6EA9;">E.doto family</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="background: #fafafa; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
      <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
        © ${new Date().getFullYear()} E.doto family. Tous droits réservés<br />
        <a href="https://edotofamily.com" style="color: #FF6EA9; text-decoration: none;">www.edotofamily.com</a>
      </p>
    </div>
  </div>
  `;
}

export function buildPickupVerificationEmail(name: string, verificationLink: string): string {
  return `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 40px rgba(0,0,0,0.06); border: 1px solid #f2f2f2;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
      <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E.doto family" style="height: 72px; margin-bottom: 12px;" />
      <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700; margin: 0;">E.doto family</h1>
      <p style="color: #6B7280; font-size: 14px; margin-top: 6px;">Partenaire officiel · Point de Retrait</p>
    </div>

    <!-- Body -->
    <div style="padding: 40px 30px; background-color: #ffffff;">
      <h2 style="color: #111827; font-size: 20px; margin-bottom: 12px; text-align: center;">
        Bienvenue parmi nos Points de Retrait ✨
      </h2>

      <p style="color: #4B5563; font-size: 15px; line-height: 1.7; text-align: center; margin: 0 auto; max-width: 480px;">
        Bonjour <strong>${name}</strong>,<br/><br/>
        Vous venez de demander à rejoindre notre réseau de <strong>Points de Retrait E.doto family</strong>.<br/>
        Merci de confirmer votre adresse e-mail en cliquant sur le bouton ci-dessous.<br/><br/>
        Votre demande sera ensuite examinée par notre équipe : vous pourrez vous connecter
        à votre espace partenaire dès que votre point de retrait aura été validé.
      </p>

      <!-- Call to Action -->
      <div style="text-align: center; margin: 36px 0;">
        <a href="${verificationLink}"
          style="background: linear-gradient(135deg, #FF6EA9, #ff579d); color: #fff; padding: 14px 36px;
                 border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;
                 display: inline-block; box-shadow: 0 3px 10px rgba(255,110,169,0.3); transition: all 0.3s ease;">
          Activer mon compte
        </a>
      </div>

      <p style="color: #6B7280; font-size: 14px; line-height: 1.6; text-align: center;">
        Ce lien est valable pendant <strong>5 minutes</strong>.  
        Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.
      </p>

      <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 36px 0;" />

      <p style="color: #9CA3AF; font-size: 13px; text-align: center;">
        Merci de contribuer à offrir une meilleure expérience aux membres de la communauté 💖<br />
        L’équipe <strong style="color: #FF6EA9;">E.doto family</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="background: #fafafa; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
      <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
        © ${new Date().getFullYear()} E.doto family. Tous droits réservés<br />
        <a href="https://edotofamily.com" style="color: #FF6EA9; text-decoration: none;">www.edotofamily.com</a>
      </p>
    </div>
  </div>
      `;
}

export const CUSTOMER_VERIFICATION_SUBJECT = "Confirme ton adresse e-mail · E.doto family";
export const PICKUP_VERIFICATION_SUBJECT = "Activez votre compte Point de Retrait · E.doto family";

export const PICKUP_APPROVED_SUBJECT = 'Votre Point de Retrait est validé · E.doto family';

// Envoyé au point de retrait quand l'admin valide son inscription
export function buildPickupApprovedEmail(name: string, loginUrl: string): string {
  return `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 640px; margin: auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 40px rgba(0,0,0,0.06); border: 1px solid #f2f2f2;">
    <div style="background: linear-gradient(135deg, #fff5f8, #ffe4ef); padding: 32px 24px; text-align: center;">
      <img src="https://edotofamily.netlify.app/images/edotofamily6.1.png" alt="E.doto family" style="height: 72px; margin-bottom: 12px;" />
      <h1 style="color: #FF6EA9; font-size: 22px; font-weight: 700; margin: 0;">E.doto family</h1>
      <p style="color: #6B7280; font-size: 14px; margin-top: 6px;">Partenaire officiel · Point de Retrait</p>
    </div>
    <div style="padding: 40px 30px; background-color: #ffffff;">
      <h2 style="color: #111827; font-size: 20px; margin-bottom: 12px; text-align: center;">
        Votre point de retrait est validé ✅
      </h2>
      <p style="color: #4B5563; font-size: 15px; line-height: 1.7; text-align: center; margin: 0 auto; max-width: 480px;">
        Bonjour <strong>${name}</strong>,<br/><br/>
        Notre équipe a validé votre inscription au réseau des <strong>Points de Retrait E.doto family</strong>.
        Vous pouvez dès maintenant vous connecter à votre espace partenaire pour suivre les commandes
        et valider les retraits de vos clientes.
      </p>
      <div style="text-align: center; margin: 36px 0;">
        <a href="${loginUrl}"
          style="background: linear-gradient(135deg, #FF6EA9, #ff579d); color: #fff; padding: 14px 36px;
                 border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;
                 display: inline-block; box-shadow: 0 3px 10px rgba(255,110,169,0.3);">
          Me connecter
        </a>
      </div>
      <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 36px 0;" />
      <p style="color: #9CA3AF; font-size: 13px; text-align: center;">
        Merci de contribuer à offrir une meilleure expérience aux membres de la communauté 💖<br />
        L’équipe <strong style="color: #FF6EA9;">E.doto family</strong>
      </p>
    </div>
    <div style="background: #fafafa; padding: 20px; text-align: center; border-top: 1px solid #f3f4f6;">
      <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
        © ${new Date().getFullYear()} E.doto family. Tous droits réservés<br />
        <a href="https://edotofamily.com" style="color: #FF6EA9; text-decoration: none;">www.edotofamily.com</a>
      </p>
    </div>
  </div>
  `;
}
