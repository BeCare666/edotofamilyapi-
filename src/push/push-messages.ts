// Textes des notifications push (04/11/2026, décision D2 : discrets sur l'écran verrouillé).
// Jamais de produit, de méthode, de motif ni de nom de médecin : seulement « ce qui se passe » et la page à ouvrir.
// Le titre est toujours le nom de la plateforme.

export type PushMessage = {
  title: string;
  body: string;
  url: string; // page du site ouverte au toucher (chemin relatif)
  tag?: string; // une notification du même tag remplace la précédente
  ttl?: number; // secondes pendant lesquelles le service d'envoi garde la notification si le téléphone est éteint
};

const TITLE = 'E.doto family';
const DAY = 24 * 3600;

export const PUSH = {
  orderPaid: (orderId: number): PushMessage => ({
    title: TITLE, body: 'Votre paiement est confirmé. Votre commande est en préparation.', url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY,
  }),
  orderOnTheWay: (orderId: number): PushMessage => ({
    title: TITLE, body: 'Votre commande est en route vers vous.', url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY,
  }),
  orderWithdrawn: (orderId: number, delivered: boolean): PushMessage => ({
    title: TITLE, body: delivered ? 'Votre commande a été livrée.' : 'Votre commande a été retirée.', url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY,
  }),
  orderRefunded: (orderId: number): PushMessage => ({
    title: TITLE, body: 'Votre commande a été remboursée.', url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY,
  }),
  kitWithdrawn: (): PushMessage => ({
    title: TITLE, body: 'Votre retrait a bien été enregistré.', url: '/campaigns', tag: 'kit', ttl: DAY,
  }),
  appointmentBooked: (): PushMessage => ({
    title: TITLE, body: 'Votre rendez-vous est confirmé.', url: '/mon-espace', tag: 'rdv', ttl: DAY,
  }),
  appointmentSoon: (minutes: number): PushMessage => ({
    title: TITLE,
    body: minutes > 1 ? `Votre rendez-vous commence dans ${minutes} minutes.` : 'Votre rendez-vous commence dans une minute.',
    url: '/mon-espace', tag: 'rdv', ttl: 15 * 60,
  }),
  newCampaign: (): PushMessage => ({
    title: TITLE, body: 'Une nouvelle campagne a commencé. Découvrez-la.', url: '/campaigns', tag: 'campagne', ttl: 2 * DAY,
  }),
  reminder: (): PushMessage => ({
    title: TITLE, body: 'C’est l’heure de votre rappel.', url: '/mon-espace', tag: 'rappel', ttl: 6 * 3600,
  }),
  test: (): PushMessage => ({
    title: TITLE, body: 'Les notifications sont activées sur cet appareil.', url: '/mon-espace', tag: 'test', ttl: 3600,
  }),
};
