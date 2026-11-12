// Textes des notifications push (04/11/2026, décision D2 : discrets sur l'écran verrouillé).
// Jamais de produit, de méthode, de motif ni de nom de médecin : seulement « ce qui se passe » et la page à ouvrir.
// Le titre est toujours le nom de la plateforme.

export type PushMessage = {
  title: string;
  body: string;
  url: string; // page du site ouverte au toucher (chemin relatif)
  tag?: string; // une notification du même tag remplace la précédente
  ttl?: number; // secondes pendant lesquelles le service d'envoi garde la notification si le téléphone est éteint
  // Sujet (05/11/2026, décision P4) : la personne peut couper orders, appointments ou campaigns dans Paramètres.
  // Sans sujet (rappel, activation) : toujours envoyée.
  topic?: PushTopic;
};

export const PUSH_TOPICS = ['orders', 'appointments', 'campaigns'] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];

const TITLE = 'E.doto family';
const DAY = 24 * 3600;

export const PUSH = {
  orderPaid: (orderId: number): PushMessage => ({
    title: TITLE, body: 'Votre paiement est confirmé. Votre commande est en préparation.', url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY, topic: 'orders',
  }),
  orderOnTheWay: (orderId: number): PushMessage => ({
    title: TITLE, body: 'Votre commande est en route vers vous.', url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY, topic: 'orders',
  }),
  orderWithdrawn: (orderId: number, delivered: boolean): PushMessage => ({
    title: TITLE, body: delivered ? 'Votre commande a été livrée.' : 'Votre commande a été retirée.', url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY, topic: 'orders',
  }),
  orderRefunded: (orderId: number): PushMessage => ({
    title: TITLE, body: 'Votre commande a été remboursée.', url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY, topic: 'orders',
  }),
  // Tournées de retrait (12/11/2026, rapports/PLAN_TOURNEES_RETRAIT.md, Q4) : jour et heure seulement, jamais de produit
  orderAvailableAt: (orderId: number, day: string, hour: string): PushMessage => ({
    title: TITLE, body: `Votre commande sera disponible à votre point de retrait le ${day} à ${hour}.`, url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY, topic: 'orders',
  }),
  orderAvailable: (orderId: number): PushMessage => ({
    title: TITLE, body: 'Votre commande est disponible à votre point de retrait.', url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY, topic: 'orders',
  }),
  orderNewTime: (orderId: number, day: string, hour: string): PushMessage => ({
    title: TITLE, body: `Nouvelle heure : votre commande sera disponible le ${day} à ${hour}.`, url: `/orders/${orderId}`, tag: `order-${orderId}`, ttl: DAY, topic: 'orders',
  }),
  kitAvailableAt: (day: string, hour: string): PushMessage => ({
    title: TITLE, body: `Votre kit sera disponible à votre point de retrait le ${day} à ${hour}.`, url: '/campaigns', tag: 'kit', ttl: DAY, topic: 'orders',
  }),
  kitAvailable: (): PushMessage => ({
    title: TITLE, body: 'Votre kit est disponible à votre point de retrait.', url: '/campaigns', tag: 'kit', ttl: DAY, topic: 'orders',
  }),
  kitNewTime: (day: string, hour: string): PushMessage => ({
    title: TITLE, body: `Nouvelle heure : votre kit sera disponible le ${day} à ${hour}.`, url: '/campaigns', tag: 'kit', ttl: DAY, topic: 'orders',
  }),
  kitWithdrawn: (): PushMessage => ({
    title: TITLE, body: 'Votre retrait a bien été enregistré.', url: '/campaigns', tag: 'kit', ttl: DAY, topic: 'orders',
  }),
  appointmentBooked: (): PushMessage => ({
    title: TITLE, body: 'Votre rendez-vous est confirmé.', url: '/mon-espace', tag: 'rdv', ttl: DAY, topic: 'appointments',
  }),
  appointmentSoon: (minutes: number): PushMessage => ({
    title: TITLE,
    body: minutes > 1 ? `Votre rendez-vous commence dans ${minutes} minutes.` : 'Votre rendez-vous commence dans une minute.',
    url: '/mon-espace', tag: 'rdv', ttl: 15 * 60, topic: 'appointments',
  }),
  newCampaign: (): PushMessage => ({
    title: TITLE, body: 'Une nouvelle campagne a commencé. Découvrez-la.', url: '/campaigns', tag: 'campagne', ttl: 2 * DAY, topic: 'campaigns',
  }),
  reminder: (): PushMessage => ({
    title: TITLE, body: 'C’est l’heure de votre rappel.', url: '/mon-espace', tag: 'rappel', ttl: 6 * 3600,
  }),
  test: (): PushMessage => ({
    title: TITLE, body: 'Les notifications sont activées sur cet appareil.', url: '/mon-espace', tag: 'test', ttl: 3600,
  }),
};
