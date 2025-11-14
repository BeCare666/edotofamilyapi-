-- Création de la table settings
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  options JSON NOT NULL,
  language VARCHAR(10) DEFAULT 'en',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
); 
INSERT INTO settings (options, language, created_at, updated_at)
VALUES (
  '{
    "isProductReview": true,
    "useGoogleMap": false,
    "enableTerms": true,
    "seo": {
      "ogImage": null,
      "ogTitle": "EdotoFamily - Bien-être, maternité et santé naturelle",
      "metaTags": "edotofamily, fertilité, grossesse, maternité, santé féminine, produits naturels",
      "metaTitle": "EdotoFamily | Votre univers bien-être & maternité",
      "canonicalUrl": "https://edotofamily.netlify.app",
      "ogDescription": "Découvrez EdotoFamily — une boutique dédiée au bien-être, à la maternité et à la santé naturelle. Produits sûrs, efficaces et conçus pour vous accompagner à chaque étape.",
      "twitterHandle": "@edotofamily",
      "metaDescription": "EdotoFamily propose des produits naturels et de qualité pour la fertilité, la grossesse, la maternité et la santé des femmes.",
      "twitterCardType": "summary_large_image"
    },
    "logo": {
      "id": 1001,
      "original": "https://edotofamily.netlify.app/images/edotofamily6.1.png",
      "thumbnail": "https://edotofamily.netlify.app/images/edotofamily6.1.png",
      "file_name": "edotofamily-logo.png"
    },
    "collapseLogo": {
      "thumbnail": "https://edotofamily.netlify.app/images/edotofamily6.1.png",
      "original": "https://edotofamily.netlify.app/images/edotofamily6.1.png",
      "id": 1002,
      "file_name": "edotofamily-collapse-logo.png"
    },
    "dark_logo": {
      "id": 1003,
      "original": "https://edotofamily.netlify.app/images/edotofamily6.1.png",
      "thumbnail": "https://edotofamily.netlify.app/images/edotofamily6.1.png"
    },
    "siteTitle": "EdotoFamily",
    "siteSubtitle": "Votre univers bien-être, fertilité & maternité",
    "currency": "XOF",
    "taxClass": "1",
    "signupPoints": 50,
    "shippingClass": "1",
    "contactDetails": {
      "contact": "+229 00 00 00 00",
      "socials": [
        { "url": "https://www.facebook.com/edotofamily", "icon": "FacebookIcon" },
        { "url": "https://www.instagram.com/edotofamily", "icon": "InstagramIcon" },
        { "url": "https://x.com/edotofamily", "icon": "TwitterIcon" }
      ],
      "website": "https://edotofamily.netlify.app",
      "emailAddress": "contact@edotofamily.com",
      "location": {
        "lat": 6.3703,
        "lng": 2.3912,
        "zip": null,
        "city": "Cotonou",
        "state": "Atlantique",
        "country": "Bénin",
        "formattedAddress": "Cotonou, Bénin"
      }
    },
    "paymentGateway": [
      { "name": "stripe", "title": "Stripe" },
      { "name": "cash", "title": "Paiement à la livraison" }
    ],
    "currencyOptions": { "formation": "fr-FR", "fractions": 0 },
    "useEnableGateway": true,
    "useCashOnDelivery": true,
    "freeShippingAmount": 20000,
    "minimumOrderAmount": 0,
    "useMustVerifyEmail": false,
    "maximumQuestionLimit": 5,
    "currencyToWalletRatio": 3,
    "defaultPaymentGateway": "stripe",
    "StripeCardOnly": false,
    "server_info": {
      "upload_max_filesize": 2048,
      "memory_limit": "128M",
      "max_execution_time": "30",
      "max_input_time": "-1",
      "post_max_size": 8192
    },
    "useAi": false,
    "defaultAi": "edotofamily",
    "siteLink": "https://edotofamily.netlify.app",
    "copyrightText": "Copyright © EdotoFamily. Tous droits réservés.",
    "externalText": "EDOTOFAMILY",
    "externalLink": "https://edotofamily.netlify.app",
    "smsEvent": {
      "admin": { "statusChangeOrder": true },
      "vendor": { "statusChangeOrder": true },
      "customer": { "statusChangeOrder": true },
      "all": []
    },
    "emailEvent": {
      "admin": { "statusChangeOrder": true },
      "vendor": { "statusChangeOrder": true },
      "customer": { "statusChangeOrder": true },
      "all": []
    },
    "pushNotification": {
      "admin": [],
      "vendor": [],
      "customer": [],
      "all": { "order": true }
    },
    "isUnderMaintenance": false,
    "maintenance": {
      "title": "Le site est en maintenance",
      "buttonTitleOne": "Me prévenir",
      "newsLetterTitle": "S\'abonner à la newsletter",
      "buttonTitleTwo": "Nous contacter",
      "contactUsTitle": "Nous contacter",
      "aboutUsTitle": "À propos",
      "isOverlayColor": false,
      "overlayColor": null,
      "overlayColorRange": null,
      "description": "Nous améliorons actuellement EdotoFamily pour vous offrir une expérience encore plus fluide et inspirante. Merci pour votre patience et à très bientôt !",
      "newsLetterDescription": "Abonnez-vous à notre newsletter et recevez les nouveautés, conseils bien-être et offres exclusives directement par e-mail.",
      "aboutUsDescription": "EdotoFamily est une marque dédiée au bien-être féminin, à la fertilité et à la maternité. Découvrez des produits naturels, sûrs et efficaces, conçus pour vous accompagner à chaque étape de votre parcours.",
      "image": {
        "id": 1794,
        "file_name": "maintenance-bg.png",
        "original": "https://edotofamily.netlify.app/images/maintenance-bg.png",
        "thumbnail": "https://edotofamily.netlify.app/images/maintenance-bg.png"
      },
      "start": "2025-11-10T08:00:00Z",
      "until": "2025-11-15T08:00:00Z"
    },
    "app_settings": {
      "last_checking_time": "2025-11-12T08:00:00Z",
      "trust": true
    },
    "maxShopDistance": null
  }',
  'fr',
  NOW(),
  NOW()
);
