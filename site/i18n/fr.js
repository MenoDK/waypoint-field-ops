/* French overlay. Text only: the keys mirror the shape of content.js, and anything missing falls back to English. */
(window.SITE_I18N ||= {}).fr = {
  title: 'waypoint-field-ops · un backend de flotte pour des téléphones qui perdent le signal',
  loading: {
    context: 'Opérations de flotte',
    title: 'Localisation de la flotte',
    text: "Lecture des dernières positions, du routeur routier et de l'horloge.",
    foot: 'Démo locale · téléphones simulés sur cette machine',
  },
  lab: { cta: 'Entrer dans le laboratoire' },
  hero: {
    eyebrow: "Opérations de terrain · tolérant à la perte de connexion, honnête sur ce qu'il sait",
    lead: 'Sachez où est chaque véhicule',
    soft: 'et avec quelle certitude.',
    text: "Un backend de flotte pour des téléphones qui traversent des tunnels, envoient une heure de positions d'un coup et ont parfois la mauvaise heure. Les relevés sont filtrés et stockés une seule fois, les ETA disent comment elles ont été calculées, le silence déclenche une alerte, et une file n'embarque jamais plus de personnes que le véhicule n'en contient. Des téléphones simulés parcourent une région imaginaire sur votre ordinateur.",
    primary: { label: 'Ouvrir le laboratoire' },
    secondary: { label: 'Voir comment ça marche' },
    pilot: 'Tourne sur votre ordinateur · les téléphones et le routeur routier sont simulés, aucun compte',
    proof: [
      { a: 'Les positions sont stockées une fois', b: "quel que soit le nombre d'envois" },
      { a: 'Chaque garantie a un test', b: 'qui cherche à la casser' },
    ],
    top: ['WAYPOINT', "Des positions que l'on peut défendre."],
    status: {
      small: 'Dernière alerte',
      strong: 'Pas de signal depuis 4 min. Ouverte par le worker, fermée par la position suivante.',
    },
  },
  principles: {
    lead: ['Conçu pour', 'les zones blanches.'],
    items: [
      [null, 'Stocke une fois'],
      [null, 'Nomme sa méthode'],
      [null, 'Alerte sur le silence'],
      [null, 'Compte les personnes'],
    ],
  },
  tour: {
    eyebrow: "Une visite de l'ensemble",
    title: ['Cinq choses qui tournent mal', 'sur la route.'],
    text: "Choisissez un onglet. La sortie ci-dessous est enregistrée depuis l'application en marche avec des données fictives ; un test échoue si elle cesse d'être vraie.",
    tag: 'Sortie enregistrée',
    tabs: [
      {
        label: 'Ingestion',
        title: "Une heure dans un tunnel arrive en un seul lot et n'est stockée qu'une fois.",
        text: 'Un relevé sans position GPS ou avec une mauvaise horloge est refusé seul ; les bons du même lot sont conservés. Renvoyer le lot ne change rien, et un vieux relevé ne fait jamais reculer le véhicule.',
      },
      {
        label: 'Arrivée',
        title: "Arriver demande deux bonnes positions, et ne s'écrit qu'une fois.",
        text: "Une position dans le rayon peut n'être que du bruit GPS. Une position qui avoue sa propre marge d'erreur est trop imprécise pour compter. L'arrivée est marquée par une mise à jour conditionnelle : deux lots simultanés ne peuvent pas la revendiquer tous les deux.",
      },
      {
        label: 'Alertes',
        title: 'Le silence déclenche une alerte. Une position la ferme.',
        text: 'Les alertes sont un état, pas des événements : un index unique partiel autorise une alerte ouverte par véhicule et par type, et un évaluateur planifié les réconcilie. Le lancer deux fois, ou sur trois workers, donne la même réponse.',
      },
      {
        label: 'File',
        title: "L'unité n'embarque jamais plus de personnes qu'elle n'en contient.",
        text: "La capacité compte les personnes. Une seule règle décide combien peuvent être appelées, pour « appeler les cinq suivants » comme pour « appeler celle-ci », et la ligne de l'unité est verrouillée pendant qu'elle décide.",
      },
      {
        label: 'Frontières',
        title: "Le trajet d'une autre flotte n'existe pas. Un mauvais routeur n'est pas cru.",
        text: "Tout est cloisonné par la flotte du jeton : l'id d'une autre flotte répond 404, pas 403. Une réponse hostile du routeur est refusée et l'ETA indique qu'elle est revenue à la ligne droite.",
      },
    ],
    modulesTitle: "Tout ce qu'il y a dans la boîte.",
    modulesNote: 'Chacun a son fichier de tests et sa place dans le laboratoire',
    modules: [
      [
        null,
        'Historique en ajout seul',
        'Partitions quotidiennes, clé primaire conducteur + heure de capture, ON CONFLICT DO NOTHING, et rétention en supprimant une partition plutôt que des lignes.',
      ],
      [
        null,
        'Upsert de la dernière position',
        "La capture la plus récente gagne, une plus ancienne est gardée dans l'historique sans jamais déplacer le véhicule, et l'instant du dernier vrai mouvement est suivi à part.",
      ],
      [
        null,
        'ETA avec une méthode',
        'Par la route ou en ligne droite, vitesse mesurée ou par défaut, et la réponse dit laquelle. Un disjoncteur et un cache protègent le routeur.',
      ],
      [
        null,
        'Alertes comme état',
        'Pas de signal, arrêt long, arrivée proche. Un évaluateur planifié les réconcilie avec les faits ; un index unique partiel en garde une seule ouverte de chaque.',
      ],
      [
        null,
        'File tenant compte de la capacité',
        "Une seule règle d'admission pour les deux façons d'appeler, FOR UPDATE sur l'unité, et un avertissement quand les personnes à bord dépassent le plafond.",
      ],
      [
        null,
        'Temps réel via la base de données',
        "pg_notify dans la transaction, une connexion LISTEN dédiée qui se reconnecte, et des salles tirées du jeton vérifié, jamais d'un message.",
      ],
    ],
    transparency: {
      strong: 'Honnêtes sur la démo.',
      text: "Les téléphones et le routeur routier sont des programmes simulés qui parlent à la vraie API en HTTP ; rien ici n'a tourné sur de vrais appareils ni sur un vrai moteur de routage. La région est inventée. La liste des limites du README est complète.",
    },
  },
  challenges: {
    eyebrow: 'Les points difficiles',
    title: ['Allez,', 'essayez de le casser.'],
    text: 'Ce sont les sept choses faciles à affirmer et difficiles à réussir. Chacune a une recette, ce que vous devriez voir, et un bouton qui ouvre le laboratoire sur cet onglet précis.',
    items: [
      {
        label: 'Traverser un tunnel',
        title: 'Mettez un téléphone hors ligne, laissez-le rouler, puis ramenez-le.',
        text: "Les téléphones perdent le signal. Le serveur ne doit pas perdre l'heure.",
      },
      {
        label: 'Envoyer un mauvais lot',
        title: 'Mélangez de bons relevés avec une île nulle, une horloge future et un vieux relevé.',
        text: 'Un mauvais relevé ne doit pas coûter les autres.',
      },
      {
        label: 'Se tenir sur la ligne',
        title: 'Faites trembler un téléphone au bord de la destination.',
        text: 'Arriver est une décision, pas une coordonnée.',
      },
      {
        label: 'Se taire',
        title: "Coupez le signal d'un téléphone et attendez l'alerte.",
        text: "Personne ne signale qu'il ne signale plus.",
      },
      {
        label: 'Surcharger la camionnette',
        title: "Appelez plus de personnes que l'unité n'en contient, de deux façons.",
        text: "Une règle de capacité que seul un chemin respecte n'est pas une règle.",
      },
      {
        label: 'Casser le routeur',
        title: 'Faites mentir le routeur routier, ramer et disparaître.',
        text: "Une dépendance qui n'est pas à vous est une entrée, pas un fait.",
      },
      {
        label: 'Jeter un œil chez une autre flotte',
        title: "Demandez à une flotte le trajet, le socket et la feuille d'une autre.",
        text: 'Un cloisonnement vérifié peut être oublié. Un cloisonnement structurel, non.',
      },
    ],
  },
  run: {
    eyebrow: 'Lancez-le en une minute',
    title: ['Une commande.', 'Une flotte sur localhost.'],
    text: "Il vous faut Docker. Pas de clés d'API, pas de compte à créer, et rien ne quitte votre machine.",
    steps: [
      [null, 'Cloner', 'git clone, puis entrez dans le dossier.'],
      [
        null,
        'Démarrer',
        "make demo construit l'image, migre la base et démarre l'API, le worker et le terrain simulé, en attendant qu'ils soient sains.",
      ],
      [
        null,
        'Ouvrir',
        'http://localhost:8400 est cette page. Appuyez sur « Entrer dans le laboratoire » : les véhicules roulent déjà.',
      ],
      [
        null,
        'Le casser',
        'Utilisez les points difficiles ci-dessus, ou lancez make e2e pour la suite navigateur.',
      ],
    ],
  },
  under: {
    eyebrow: 'Sous le capot',
    title: ['Une petite surface,', 'des bords sérieux.'],
    text: 'Le code intéressant est court, exprès. Les décisions qui le sous-tendent sont écrites, avec les alternatives écartées.',
    stackTitle: 'Avec quoi il est construit',
    proofTitle: 'Ce qui est mesuré, et les documents derrière',
    numbers: [
      [null, "tests : 215 unitaires et 151 sur un vrai PostGIS avec l'application à l'écoute"],
      [null, 'règles cassées exprès et détectées par un test, aucune non détectée'],
      [null, 'décisions documentées, chacune avec ses alternatives écartées'],
      [null, 'erreurs sous tsc --strict'],
    ],
    decisions: [
      [
        'Filtrer chaque relevé, pas la requête',
        'ADR 0002 : pourquoi une mauvaise coordonnée ne doit pas coûter les 299 autres.',
      ],
      [
        "Un historique où l'on ne fait qu'ajouter",
        'ADR 0003 : partitions, écritures idempotentes et rétention sans DELETE.',
      ],
      [
        'Les alertes sont un état',
        "ADR 0004 : pourquoi un réconciliateur vaut mieux qu'un gestionnaire d'événements.",
      ],
      [
        "Une seule règle d'admission",
        'ADR 0005 : comment la capacité reste vraie sous des appels concurrents.',
      ],
      ['Une ETA qui nomme sa méthode', 'ADR 0006 : replis honnêtes et un routeur dont on se méfie.'],
      [
        'Temps réel via la base de données',
        'ADR 0007 : pg_notify dans la transaction et des salles tirées du jeton.',
      ],
      [
        "Un laboratoire qui n'atteint pas la production",
        'ADR 0008 : trois couches gardent les interrupteurs à leur place.',
      ],
      [
        'Trajets par table, liens par signature',
        'ADR 0009 : transitions en comparer-et-échanger et liens qui portent leur propre permission.',
      ],
      [
        'Des frontières par construction',
        'ADR 0010 : la flotte vient du jeton, refus par défaut, un petit rôle de base de données.',
      ],
    ],
    measuredOn: 'Mesuré le 2026-11-05. Les chiffres viennent des commandes du README, pas de la mémoire.',
    future: [
      [
        'Un vrai moteur de routage',
        'derrière le même adaptateur protégé, avec ses propres données de trafic.',
      ],
      ['Des notifications push pour les conducteurs', "au lieu de l'interrogation, par les mêmes salles."],
      ['Une rétention par flotte', 'car la durée de conservation des positions est une clause de contrat.'],
    ],
  },
  about: {
    why: "Waypoint est le côté opérations de terrain de mon travail : des téléphones dont on ne peut pas attendre qu'ils soient en ligne, à l'heure ou qu'ils envoient les choses une seule fois, qui alimentent des écrans sur lesquels des gens prennent des décisions. Les idées viennent de systèmes que j'ai construits et exploités ; le code de ce dépôt est écrit de zéro et testé.",
  },
  faq: [
    [
      'Y a-t-il une vraie inscription ?',
      "Non, exprès. La démo a deux flottes inventées avec chacune un régulateur et des conducteurs ; le laboratoire vous connecte comme n'importe lequel d'entre eux. La vraie connexion (scrypt, limites de tentatives, JWT épinglé) est dans l'API et testée.",
    ],
    [
      'Pourquoi PostGIS et pas de simples colonnes latitude et longitude ?',
      'Les distances, les rayons et les traces sont des problèmes de géographie. PostGIS les traite correctement sur une sphère, les indexe et garde les contrôles de géorepérage au même endroit.',
    ],
    [
      "Pourquoi partitionner l'historique par jour ?",
      "Parce que le moyen le moins cher d'oublier des données personnelles à échéance est de supprimer une partition. Le rôle de l'application ne peut même pas faire de DELETE sur l'historique ; une fonction contrôlée supprime les partitions.",
    ],
    [
      'Et si deux workers évaluent les alertes en même temps ?',
      "Rien ne casse. L'évaluateur compare les faits aux alertes ouvertes et un index unique partiel empêche le doublon : un worker ou trois donnent le même résultat.",
    ],
    [
      'Le mode laboratoire peut-il atteindre la production ?',
      "Non. La configuration refuse LAB_MODE et un mot de passe de démo quand NODE_ENV vaut production, un test le verrouille, et les routes du laboratoire répondent 404 hors laboratoire et refusent tout Host qui n'est pas local.",
    ],
    [
      'Est-il prêt pour la production ?',
      "Il est construit et testé à ce niveau d'exigence : types stricts, tests sur une vraie base, contrôles par mutation. Il n'a pas porté de trafic réel, et ce qui lui manque figure dans les limites du README.",
    ],
  ],
  closing: {
    eyebrow: 'À vous',
    title: ['Essayez de faire croire au serveur', "une position qu'il ne devrait pas croire."],
    button: 'Ouvrir le laboratoire',
    fine: "En local uniquement · données fictives · rien n'est envoyé nulle part",
  },
};
