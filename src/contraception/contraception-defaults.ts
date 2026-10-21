// Fiches par défaut des méthodes contraceptives modernes (21/10/2026), chargées seulement si la table est vide.
// Source : OMS, « Planification familiale : un manuel à l'intention des prestataires de services du monde entier »
// (efficacité en utilisation courante, première année). Tout est modifiable dans l'admin.
// requires_doctor : 1 = pose, prescription ou intervention par un professionnel de santé ; 0 = sans médecin.

export type MethodDefaults = {
  slug: string;
  name: string;
  family: string;
  requires_doctor: 0 | 1;
  summary: string;
  description: string;
  how_to: string;
  advantages: string[];
  drawbacks: string[];
  criteria: string[];
  efficacy: string;
  duration: string;
  protects_sti: 0 | 1;
  image_url: string | null;
  image_credit: string | null;
};

const NO_STI = 'Ne protège pas des infections sexuellement transmissibles ni du VIH : associer le préservatif en cas de risque.';

export const CONTRACEPTION_DEFAULTS: MethodDefaults[] = [
  {
    slug: 'implant',
    name: 'Implant contraceptif',
    family: 'Longue durée, hormonale',
    requires_doctor: 1,
    summary: 'Un ou deux petits bâtonnets souples placés sous la peau du bras, qui protègent pendant plusieurs années.',
    description:
      "L'implant libère en continu un progestatif proche de l'hormone naturelle. Il épaissit la glaire du col de l'utérus, ce qui empêche les spermatozoïdes de rencontrer l'ovule, et bloque l'ovulation chez beaucoup de femmes.",
    how_to:
      "Un professionnel de santé formé l'insère sous la peau de la face interne du bras, après une anesthésie locale, en quelques minutes. Il n'y a rien à faire ensuite. Le retrait, à tout moment, se fait aussi par un professionnel formé ; la fécondité revient rapidement.",
    advantages: [
      "Parmi les méthodes les plus efficaces : plus de 99 %.",
      'Rien à penser au quotidien pendant plusieurs années.',
      'Discret : rien ne se voit.',
      'Retour rapide de la fécondité dès le retrait.',
      'Utilisable sans œstrogène, y compris pendant l’allaitement.',
    ],
    drawbacks: [
      'Saignements irréguliers fréquents (spotting, règles plus longues ou absentes), surtout la première année.',
      'Possibles maux de tête, douleurs abdominales, sensibilité des seins.',
      "Pose et retrait uniquement par un professionnel formé.",
      NO_STI,
    ],
    criteria: [
      "Convient à la plupart des femmes, quel que soit l'âge, avec ou sans enfant.",
      "Le professionnel vérifie notamment : cancer du sein actuel ou passé, maladie grave du foie, saignements vaginaux inexpliqués.",
      "Possible juste après un accouchement ou un avortement.",
    ],
    efficacy: 'Plus de 99 % (moins de 1 grossesse pour 100 femmes par an)',
    duration: '3 à 5 ans selon le modèle',
    protects_sti: 0,
    image_url: '/images/contraception/implant.jpg',
    image_credit: 'Photo : Vera de Kok, CC BY-SA 4.0, Wikimedia Commons',
  },
  {
    slug: 'diu-cuivre',
    name: 'DIU au cuivre (stérilet)',
    family: 'Longue durée, sans hormone',
    requires_doctor: 1,
    summary: 'Un petit dispositif en plastique souple entouré de cuivre, placé dans l’utérus, efficace jusqu’à 12 ans sans hormone.',
    description:
      "Le cuivre modifie l'environnement de l'utérus : les spermatozoïdes sont abîmés et ne peuvent pas féconder l'ovule. Il ne contient aucune hormone.",
    how_to:
      "Un professionnel formé fait d'abord un examen gynécologique, puis place le DIU dans l'utérus à travers le col, en quelques minutes. Des fils fins restent dans le vagin pour le retrait. Une visite de contrôle est proposée après les premières règles.",
    advantages: [
      'Plus de 99 % d’efficacité.',
      'Sans hormone : le cycle naturel est conservé.',
      'Protection très longue, jusqu’à 12 ans.',
      'Fécondité retrouvée dès le retrait.',
      "Peut aussi servir de contraception d'urgence s'il est posé dans les 5 jours après un rapport non protégé.",
    ],
    drawbacks: [
      'Règles souvent plus abondantes, plus longues et plus douloureuses les premiers mois.',
      'Douleurs ou crampes au moment de la pose.',
      'Rarement : expulsion du DIU, ou perforation de l’utérus lors de la pose.',
      NO_STI,
    ],
    criteria: [
      'Convient à la plupart des femmes, y compris les jeunes et celles sans enfant.',
      "Non posé en cas de grossesse, d'infection génitale en cours, de saignements inexpliqués ou de cancer du col ou de l'utérus.",
      'Pose possible dans les 48 heures après un accouchement ou à partir de 4 semaines.',
    ],
    efficacy: 'Plus de 99 % (moins de 1 grossesse pour 100 femmes par an)',
    duration: "Jusqu'à 12 ans",
    protects_sti: 0,
    image_url: '/images/contraception/diu-cuivre.jpg',
    image_credit: 'Photo : CooperSurgical, CC BY 4.0, Wikimedia Commons',
  },
  {
    slug: 'diu-hormonal',
    name: 'DIU hormonal (au lévonorgestrel)',
    family: 'Longue durée, hormonale',
    requires_doctor: 1,
    summary: 'Un dispositif placé dans l’utérus qui libère chaque jour une petite quantité de progestatif.',
    description:
      "Le DIU hormonal libère du lévonorgestrel directement dans l'utérus. La glaire du col s'épaissit et la muqueuse de l'utérus s'amincit : les spermatozoïdes ne peuvent pas atteindre l'ovule.",
    how_to:
      "Après un examen gynécologique, un professionnel formé le place dans l'utérus à travers le col, en quelques minutes. Des fils fins restent dans le vagin pour le retrait. Une visite de contrôle est proposée après quelques semaines.",
    advantages: [
      'Plus de 99 % d’efficacité.',
      'Règles plus légères et moins douloureuses ; elles peuvent même s’arrêter.',
      'Protection de plusieurs années sans geste quotidien.',
      'Fécondité retrouvée dès le retrait.',
    ],
    drawbacks: [
      'Saignements irréguliers les premiers mois.',
      'Possibles maux de tête, acné, sensibilité des seins.',
      'Douleurs au moment de la pose ; rarement expulsion ou perforation.',
      NO_STI,
    ],
    criteria: [
      'Convient à la plupart des femmes, y compris les jeunes et celles sans enfant.',
      "Non posé en cas de grossesse, d'infection génitale en cours, de saignements inexpliqués, de cancer du sein ou de l'utérus.",
    ],
    efficacy: 'Plus de 99 % (moins de 1 grossesse pour 100 femmes par an)',
    duration: '3 à 5 ans selon le modèle',
    protects_sti: 0,
    image_url: '/images/contraception/diu-hormonal.jpg',
    image_credit: 'Photo : Hic et nunc, domaine public, Wikimedia Commons',
  },
  {
    slug: 'injectable',
    name: 'Injectable (piqûre tous les 3 mois)',
    family: 'Hormonale',
    requires_doctor: 1,
    summary: 'Une injection de progestatif (DMPA) qui protège pendant 3 mois.',
    description:
      "L'injection libère un progestatif qui bloque l'ovulation et épaissit la glaire du col de l'utérus. Elle ne contient pas d'œstrogène.",
    how_to:
      "Un professionnel de santé fait l'injection dans le muscle du bras ou de la fesse, ou sous la peau pour la forme sous-cutanée (que certaines femmes apprennent ensuite à faire elles-mêmes). Il faut revenir toutes les 13 semaines ; un retard jusqu'à 4 semaines reste acceptable.",
    advantages: [
      'Discret : rien à prendre chaque jour, rien à porter.',
      'Une injection tous les 3 mois seulement.',
      'Sans œstrogène, possible pendant l’allaitement.',
      'Réduit le risque de cancer de l’endomètre et de fibromes.',
    ],
    drawbacks: [
      "Saignements irréguliers puis souvent absence de règles.",
      'Prise de poids possible.',
      "Retour de la fécondité retardé de plusieurs mois après l'arrêt (en moyenne 4 mois de plus que les autres méthodes).",
      NO_STI,
    ],
    criteria: [
      "Convient à la plupart des femmes, y compris les jeunes.",
      "Le professionnel vérifie notamment : tension artérielle très élevée, cancer du sein, maladie grave du foie, saignements inexpliqués.",
      'Respecter la date de la prochaine injection.',
    ],
    efficacy: '96 % en utilisation courante (4 grossesses pour 100 femmes par an), plus de 99 % si les injections sont faites à temps',
    duration: 'Une injection tous les 3 mois',
    protects_sti: 0,
    image_url: '/images/contraception/injectable.jpg',
    image_credit: 'Photo : Ciell, CC BY-SA 2.5, Wikimedia Commons',
  },
  {
    slug: 'pilule-combinee',
    name: 'Pilule combinée',
    family: 'Hormonale',
    requires_doctor: 1,
    summary: 'Un comprimé chaque jour contenant deux hormones, un œstrogène et un progestatif.',
    description:
      "La pilule combinée empêche l'ovulation. Elle épaissit aussi la glaire du col de l'utérus.",
    how_to:
      "Après un entretien avec un professionnel de santé (antécédents, tension artérielle), prendre un comprimé chaque jour, de préférence à la même heure. Selon la plaquette, 21 comprimés puis 7 jours de pause, ou 28 comprimés sans pause. En cas d'oubli, suivre les consignes de la notice ou demander conseil.",
    advantages: [
      'Règles plus régulières, moins abondantes et moins douloureuses.',
      'Fécondité retrouvée rapidement à l’arrêt.',
      'Réduit le risque de cancer de l’ovaire et de l’endomètre.',
      "Arrêt possible à tout moment, sans l'aide d'un professionnel.",
    ],
    drawbacks: [
      'Il faut y penser chaque jour : les oublis réduisent l’efficacité.',
      'Possibles nausées, maux de tête, sensibilité des seins, petits saignements les premiers mois.',
      "Rare mais grave : risque de caillot sanguin, plus élevé chez les fumeuses de plus de 35 ans.",
      NO_STI,
    ],
    criteria: [
      "Le professionnel vérifie : tension artérielle, tabac après 35 ans, migraines avec aura, antécédent de caillot, maladie du cœur ou du foie.",
      "Déconseillée pendant les 6 premiers mois d'allaitement.",
    ],
    efficacy: '93 % en utilisation courante (7 grossesses pour 100 femmes par an), plus de 99 % sans oubli',
    duration: 'Un comprimé chaque jour',
    protects_sti: 0,
    image_url: '/images/contraception/pilule-combinee.jpg',
    image_credit: 'Photo : Béria Lima de Rodríguez, CC BY-SA 3.0, Wikimedia Commons',
  },
  {
    slug: 'pilule-progestative',
    name: 'Pilule progestative (micropilule)',
    family: 'Hormonale',
    requires_doctor: 1,
    summary: 'Un comprimé chaque jour, sans pause, contenant seulement un progestatif.',
    description:
      "La pilule progestative épaissit la glaire du col de l'utérus et, pour certaines, bloque l'ovulation. Elle ne contient pas d'œstrogène.",
    how_to:
      "Après un entretien avec un professionnel de santé, prendre un comprimé chaque jour à la même heure, sans pause entre les plaquettes. Un retard de plus de 3 heures (selon la pilule) demande les précautions indiquées sur la notice.",
    advantages: [
      'Sans œstrogène : possible pendant l’allaitement et pour les femmes qui ne peuvent pas prendre d’œstrogène.',
      'Fécondité retrouvée rapidement à l’arrêt.',
      "Arrêt possible à tout moment, sans l'aide d'un professionnel.",
    ],
    drawbacks: [
      'Prise à heure fixe chaque jour, sans pause.',
      'Saignements irréguliers fréquents.',
      'Possibles maux de tête, sensibilité des seins.',
      NO_STI,
    ],
    criteria: [
      'Convient à la plupart des femmes, y compris pendant l’allaitement.',
      "Le professionnel vérifie notamment : cancer du sein, maladie grave du foie, certains médicaments (contre l'épilepsie ou la tuberculose) qui réduisent son efficacité.",
    ],
    efficacy: '93 % en utilisation courante (7 grossesses pour 100 femmes par an)',
    duration: 'Un comprimé chaque jour, sans pause',
    protects_sti: 0,
    image_url: null,
    image_credit: null,
  },
  {
    slug: 'patch',
    name: 'Patch contraceptif',
    family: 'Hormonale',
    requires_doctor: 1,
    summary: 'Un petit timbre collé sur la peau, changé chaque semaine, qui libère deux hormones.',
    description:
      "Le patch libère un œstrogène et un progestatif à travers la peau. Il agit comme la pilule combinée : il empêche l'ovulation.",
    how_to:
      "Après un entretien avec un professionnel de santé, coller un patch sur la peau propre et sèche (fesse, ventre, haut du bras ou dos), le changer chaque semaine pendant 3 semaines, puis faire une semaine sans patch.",
    advantages: [
      'Un geste par semaine seulement.',
      'Règles plus régulières.',
      'Fécondité retrouvée rapidement à l’arrêt.',
    ],
    drawbacks: [
      'Peut irriter la peau ou se décoller.',
      'Mêmes effets possibles que la pilule combinée (nausées, maux de tête, sensibilité des seins).',
      'Même risque rare de caillot sanguin que la pilule combinée.',
      NO_STI,
    ],
    criteria: [
      'Mêmes critères que la pilule combinée : tension artérielle, tabac après 35 ans, migraines avec aura, antécédent de caillot.',
    ],
    efficacy: '93 % en utilisation courante (7 grossesses pour 100 femmes par an)',
    duration: 'Un patch par semaine, 3 semaines sur 4',
    protects_sti: 0,
    image_url: '/images/contraception/patch.jpg',
    image_credit: 'Photo : James Heilman, CC BY-SA 3.0, Wikimedia Commons',
  },
  {
    slug: 'anneau-vaginal',
    name: 'Anneau vaginal',
    family: 'Hormonale',
    requires_doctor: 1,
    summary: 'Un anneau souple placé dans le vagin pendant 3 semaines, qui libère deux hormones.',
    description:
      "L'anneau libère un œstrogène et un progestatif absorbés par la paroi du vagin. Il empêche l'ovulation, comme la pilule combinée.",
    how_to:
      "Après un entretien avec un professionnel de santé, placer soi-même l'anneau dans le vagin, le garder 3 semaines, le retirer pendant 1 semaine, puis en placer un nouveau.",
    advantages: [
      'Un geste par mois seulement.',
      'Mise en place et retrait par soi-même.',
      'Fécondité retrouvée rapidement à l’arrêt.',
    ],
    drawbacks: [
      'Possibles pertes vaginales, irritation, gêne.',
      'Mêmes effets possibles et même risque rare de caillot que la pilule combinée.',
      NO_STI,
    ],
    criteria: [
      'Mêmes critères que la pilule combinée.',
      "Être à l'aise pour placer et retirer l'anneau soi-même.",
    ],
    efficacy: '93 % en utilisation courante (7 grossesses pour 100 femmes par an)',
    duration: 'Un anneau par mois (3 semaines sur 4)',
    protects_sti: 0,
    image_url: '/images/contraception/anneau.jpg',
    image_credit: 'Photo : Sakky, domaine public, Wikimedia Commons',
  },
  {
    slug: 'ligature-des-trompes',
    name: 'Ligature des trompes (stérilisation féminine)',
    family: 'Définitive',
    requires_doctor: 1,
    summary: 'Une intervention chirurgicale qui ferme ou coupe les trompes : la protection est définitive.',
    description:
      "Les trompes sont fermées ou coupées : l'ovule ne peut plus rencontrer les spermatozoïdes. Les règles et les hormones ne changent pas.",
    how_to:
      "Après un entretien de conseil approfondi et un consentement libre et éclairé, un médecin formé réalise l'intervention par une petite incision au ventre, sous anesthésie locale ou générale. La convalescence dure quelques jours.",
    advantages: [
      'Plus de 99 % d’efficacité, de façon permanente.',
      'Rien à faire ni à penser ensuite.',
      'Aucun effet sur les hormones, les règles ou la sexualité.',
    ],
    drawbacks: [
      "Définitive : elle ne doit être choisie que par une personne sûre de ne plus vouloir d'enfant.",
      "Risques liés à toute chirurgie (infection, douleur, rares complications de l'anesthésie).",
      NO_STI,
    ],
    criteria: [
      "Décision personnelle, libre et éclairée, après un conseil complet ; le regret est plus fréquent chez les personnes jeunes.",
      'Un examen médical vérifie que l’intervention peut se faire sans risque.',
    ],
    efficacy: 'Plus de 99 % (moins de 1 grossesse pour 100 femmes la première année)',
    duration: 'Permanente',
    protects_sti: 0,
    image_url: '/images/contraception_ligature_trompes_i600.jpg',
    image_credit: null,
  },
  {
    slug: 'vasectomie',
    name: 'Vasectomie (stérilisation masculine)',
    family: 'Définitive',
    requires_doctor: 1,
    summary: 'Une petite intervention qui ferme les canaux transportant les spermatozoïdes : la protection est définitive.',
    description:
      "Les canaux déférents sont fermés ou coupés : le sperme ne contient plus de spermatozoïdes. L'éjaculation, l'érection et le désir ne changent pas.",
    how_to:
      "Après un conseil approfondi et un consentement libre et éclairé, un médecin formé réalise l'intervention sous anesthésie locale, en une vingtaine de minutes. Une autre contraception reste nécessaire pendant les 3 premiers mois.",
    advantages: [
      'Plus de 99 % d’efficacité après 3 mois, de façon permanente.',
      'Intervention courte, sous anesthésie locale.',
      'Aucun effet sur la sexualité.',
    ],
    drawbacks: [
      'Définitive.',
      'Efficace seulement après 3 mois : utiliser une autre méthode en attendant.',
      'Douleur ou gonflement passagers après l’intervention.',
      NO_STI,
    ],
    criteria: [
      "Décision personnelle, libre et éclairée, d'un homme sûr de ne plus vouloir d'enfant.",
      'Un examen médical vérifie que l’intervention peut se faire sans risque.',
    ],
    efficacy: 'Plus de 99 % après 3 mois',
    duration: 'Permanente',
    protects_sti: 0,
    image_url: null,
    image_credit: null,
  },
  {
    slug: 'preservatif-masculin',
    name: 'Préservatif masculin',
    family: 'Barrière',
    requires_doctor: 0,
    summary: 'Une gaine fine déroulée sur le pénis en érection : la seule méthode qui protège aussi des IST et du VIH, avec le préservatif féminin.',
    description:
      "Le préservatif retient le sperme : les spermatozoïdes et les germes des infections sexuellement transmissibles n'entrent pas dans le vagin, l'anus ou la bouche.",
    how_to:
      "Vérifier la date et l'emballage, l'ouvrir sans ciseaux ni dents, pincer le bout puis le dérouler sur le pénis en érection avant tout contact. Après l'éjaculation, retenir l'anneau en se retirant, puis le jeter. Un préservatif neuf à chaque rapport.",
    advantages: [
      'Protège à la fois des grossesses, des IST et du VIH.',
      'Sans hormone, sans ordonnance, sans effet sur la santé.',
      'Facile à trouver et souvent gratuit.',
    ],
    drawbacks: [
      'Il faut l’utiliser correctement à chaque rapport, du début à la fin.',
      'Peut glisser ou se rompre ; prévoir alors une contraception d’urgence.',
      'Rarement : allergie au latex (des modèles sans latex existent).',
    ],
    criteria: [
      'Convient à tout le monde, à tout âge.',
      'Seulement des lubrifiants à base d’eau ou de silicone avec le latex (pas d’huile ni de beurre).',
    ],
    efficacy: '87 % en utilisation courante (13 grossesses pour 100 femmes par an), 98 % avec une utilisation correcte à chaque rapport',
    duration: 'À chaque rapport',
    protects_sti: 1,
    image_url: '/images/contraception/preservatif-masculin.jpg',
    image_credit: 'Photo : Tomhannen, domaine public, Wikimedia Commons',
  },
  {
    slug: 'preservatif-feminin',
    name: 'Préservatif féminin',
    family: 'Barrière',
    requires_doctor: 0,
    summary: 'Une gaine souple placée dans le vagin avant le rapport, qui protège aussi des IST et du VIH.',
    description:
      "Le préservatif féminin tapisse le vagin : le sperme et les germes des infections sexuellement transmissibles restent à l'intérieur de la gaine.",
    how_to:
      "Vérifier la date, presser l'anneau intérieur et le pousser au fond du vagin ; l'anneau extérieur reste à l'extérieur. Il peut être mis jusqu'à quelques heures avant le rapport. Après, tourner l'anneau extérieur pour garder le sperme, retirer et jeter. Un préservatif neuf à chaque rapport.",
    advantages: [
      'Protège à la fois des grossesses, des IST et du VIH.',
      'Mis en place par la femme elle-même, à l’avance.',
      'Sans hormone, sans ordonnance.',
    ],
    drawbacks: [
      'Demande un peu d’entraînement pour la mise en place.',
      'Peut faire du bruit ou glisser.',
      'Moins facile à trouver que le préservatif masculin.',
    ],
    criteria: [
      'Convient à toutes les femmes.',
      'Ne pas l’utiliser en même temps qu’un préservatif masculin.',
    ],
    efficacy: '79 % en utilisation courante (21 grossesses pour 100 femmes par an), 95 % avec une utilisation correcte à chaque rapport',
    duration: 'À chaque rapport',
    protects_sti: 1,
    image_url: '/images/contraception/preservatif-feminin.jpg',
    image_credit: 'Photo : Anka Grzywacz, domaine public, Wikimedia Commons',
  },
  {
    slug: 'contraception-urgence',
    name: "Pilule de contraception d'urgence",
    family: 'Urgence',
    requires_doctor: 0,
    summary: 'Une pilule à prendre le plus tôt possible après un rapport non protégé, un oubli de pilule ou un préservatif qui a rompu.',
    description:
      "La pilule d'urgence retarde ou empêche l'ovulation. Elle n'interrompt pas une grossesse déjà commencée et n'est pas dangereuse pour elle.",
    how_to:
      "Prendre le comprimé le plus tôt possible après le rapport, au plus tard dans les 5 jours (120 heures). Elle s'obtient en pharmacie ou dans un centre de santé. Ensuite, utiliser une méthode régulière.",
    advantages: [
      'Évite la plupart des grossesses si elle est prise rapidement après le rapport.',
      'Sans danger, pour toutes les femmes, y compris les jeunes.',
      'Un seul comprimé, sans examen.',
    ],
    drawbacks: [
      'Ne remplace pas une contraception régulière : moins efficace que les méthodes régulières.',
      'Possibles nausées, maux de tête, règles en avance ou en retard.',
      'Ne protège pas des rapports suivants ni des IST.',
    ],
    criteria: [
      "Toute femme peut l'utiliser, il n'y a pas de contre-indication médicale.",
      "Si les règles ont plus de 7 jours de retard ensuite, faire un test de grossesse.",
    ],
    efficacy: 'Évite la majorité des grossesses ; plus elle est prise tôt, plus elle est efficace (jusqu’à 5 jours après le rapport)',
    duration: 'Une prise, en cas de besoin',
    protects_sti: 0,
    image_url: '/images/contraception/contraception-urgence.jpg',
    image_credit: 'Photo : Anka Grzywacz, CC BY 2.5, Wikimedia Commons',
  },
  {
    slug: 'methode-jours-fixes',
    name: 'Méthode des jours fixes (collier du cycle)',
    family: 'Connaissance de la fécondité',
    requires_doctor: 0,
    summary: 'Éviter les rapports non protégés du 8e au 19e jour du cycle, repérés avec un collier de perles.',
    description:
      "Pour les cycles réguliers de 26 à 32 jours, les jours 8 à 19 sont ceux où une grossesse est possible. Un collier de perles de couleur aide à suivre les jours.",
    how_to:
      "Avancer d'une perle chaque jour à partir du premier jour des règles. Pendant les perles blanches (jours 8 à 19), pas de rapport ou un préservatif. Les autres jours, la grossesse est peu probable.",
    advantages: [
      'Sans hormone, sans effet sur la santé.',
      'Aide à connaître son cycle.',
      'Accepté par des personnes qui souhaitent une méthode naturelle.',
    ],
    drawbacks: [
      'Demande l’accord et la coopération du partenaire pendant 12 jours par cycle.',
      'Moins efficace que les méthodes modernes réversibles.',
      'Seulement pour les cycles réguliers de 26 à 32 jours.',
      NO_STI,
    ],
    criteria: [
      'Cycles réguliers de 26 à 32 jours.',
      'Deux partenaires d’accord pour éviter les rapports non protégés pendant les jours fertiles.',
    ],
    efficacy: '88 % en utilisation courante (12 grossesses pour 100 femmes par an), 95 % avec une utilisation correcte',
    duration: 'À chaque cycle',
    protects_sti: 0,
    image_url: '/images/contraception/methode-jours-fixes.jpg',
    image_credit: 'Image : Dellex, CC BY-SA 3.0, Wikimedia Commons',
  },
  {
    slug: 'mama',
    name: "Méthode de l'allaitement maternel (MAMA)",
    family: 'Après un accouchement',
    requires_doctor: 0,
    summary: "L'allaitement exclusif protège pendant les 6 premiers mois, si les règles ne sont pas revenues.",
    description:
      "L'allaitement fréquent, jour et nuit, bloque l'ovulation. La méthode est fiable seulement si trois conditions sont réunies.",
    how_to:
      "Allaiter uniquement au sein, souvent, jour et nuit. La méthode protège tant que les trois conditions restent vraies : règles pas revenues, allaitement exclusif ou presque, bébé de moins de 6 mois. Dès qu'une condition change, passer à une autre méthode.",
    advantages: [
      'Sans coût, sans produit, sans effet indésirable.',
      'Bon pour la santé du bébé et de la mère.',
      'Commence dès l’accouchement.',
    ],
    drawbacks: [
      'Valable seulement 6 mois après l’accouchement.',
      'Demande un allaitement exclusif et fréquent.',
      NO_STI,
    ],
    criteria: [
      'Règles pas encore revenues après l’accouchement.',
      'Allaitement exclusif ou presque, jour et nuit.',
      'Bébé de moins de 6 mois.',
    ],
    efficacy: '98 % pendant les 6 premiers mois si les trois conditions sont réunies',
    duration: "Jusqu'à 6 mois après l'accouchement",
    protects_sti: 0,
    image_url: '/images/contraception/mama.jpg',
    image_credit: 'Photo : Allison Shigo, CC BY-SA 4.0, Wikimedia Commons',
  },
];
