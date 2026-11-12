import { validityText, buildPickupOtpEmail } from './pickup-otp-email';
import { buildCampaignOtpEmail } from '../campaigns/campaign-otp-email';

// Validité du code (12/11/2026, choix C) : date de fin à l'heure du Bénin (UTC+1)
describe('validité du code dans les e-mails', () => {
  const end = new Date('2026-11-19T08:00:00Z'); // jeudi 19 novembre, 09 h 00 au Bénin

  it('donne la date et l\'heure de fin', () => {
    expect(validityText(end, 48)).toBe("jusqu'au <strong>jeudi 19 novembre à 09 h 00</strong>");
  });

  it('garde la durée si la date est inconnue', () => {
    expect(validityText(null, 48)).toBe('pendant <strong>48 heures</strong>');
  });

  it('e-mail de commande et e-mail de kit', () => {
    expect(buildPickupOtpEmail('TRK1', '123456', null, end)).toContain("Ce code est valable jusqu'au <strong>jeudi 19 novembre à 09 h 00</strong> et ne peut être utilisé qu'une seule fois.");
    expect(buildCampaignOtpEmail('Point A', '123456', null, end)).toContain("Le code est valable jusqu'au <strong>jeudi 19 novembre à 09 h 00</strong>.");
  });
});
