/* Spanish overlay. Text only: the keys mirror the shape of content.js, and anything missing falls back to English. */
(window.SITE_I18N ||= {}).es = {
  title: 'waypoint-field-ops · un backend de flota para teléfonos que pierden la señal',
  loading: {
    context: 'Operaciones de flota',
    title: 'Localizando la flota',
    text: 'Leyendo las últimas posiciones, el enrutador de carreteras y el reloj.',
    foot: 'Demo local · teléfonos simulados en esta máquina',
  },
  lab: { cta: 'Entrar al laboratorio' },
  hero: {
    eyebrow: 'Operaciones de campo · tolerante a la falta de conexión, honesto sobre lo que sabe',
    lead: 'Sabe dónde está cada vehículo',
    soft: 'y con qué seguridad lo sabe.',
    text: 'Un backend de flota para teléfonos que cruzan túneles, envían una hora de posiciones de golpe y a veces tienen la hora equivocada. Las lecturas se filtran y se guardan una sola vez, las ETA dicen cómo se calcularon, el silencio levanta una alerta y una cola nunca sube a más personas de las que caben en el vehículo. Teléfonos simulados recorren una región inventada en tu portátil.',
    primary: { label: 'Abrir el laboratorio' },
    secondary: { label: 'Ver cómo funciona' },
    pilot: 'Corre en tu portátil · los teléfonos y el enrutador de carreteras son simulados, sin cuentas',
    proof: [
      { a: 'Las posiciones se guardan una vez', b: 'se envíen las veces que se envíen' },
      { a: 'Cada garantía tiene una prueba', b: 'que intenta romperla' },
    ],
    top: ['WAYPOINT', 'Posiciones que puedes defender.'],
    status: {
      small: 'Última alerta',
      strong: 'Sin señal desde hace 4 min. La abrió el worker y la cerró la siguiente posición.',
    },
  },
  principles: {
    lead: ['Hecho para', 'las zonas sin cobertura.'],
    items: [
      [null, 'Guarda una vez'],
      [null, 'Dice su método'],
      [null, 'Alerta por silencio'],
      [null, 'Cuenta personas'],
    ],
  },
  tour: {
    eyebrow: 'Un recorrido por todo',
    title: ['Cinco cosas que salen mal', 'en la carretera.'],
    text: 'Elige una pestaña. La salida de abajo está grabada de la aplicación en ejecución con datos ficticios; una prueba falla si deja de ser cierta.',
    tag: 'Salida grabada',
    tabs: [
      {
        label: 'Ingesta',
        title: 'Una hora en un túnel llega como un solo lote y se guarda una vez.',
        text: 'Una lectura sin posición GPS o con el reloj equivocado se rechaza sola; las buenas del mismo lote se conservan. Enviar el lote otra vez no cambia nada, y una lectura antigua nunca hace retroceder al vehículo.',
      },
      {
        label: 'Llegada',
        title: 'Llegar exige dos buenas posiciones y se registra una sola vez.',
        text: 'Una posición dentro del radio puede ser ruido del GPS. Una posición que admite su propio margen de error es demasiado imprecisa para contar. La llegada se marca con una actualización condicional, así que dos lotes simultáneos no pueden reclamarla los dos.',
      },
      {
        label: 'Alertas',
        title: 'El silencio levanta una alerta. Una posición la cierra.',
        text: 'Las alertas son estado, no eventos: un índice único parcial permite una alerta abierta por vehículo y tipo, y un evaluador programado las reconcilia. Ejecutarlo dos veces, o en tres workers, da la misma respuesta.',
      },
      {
        label: 'Cola',
        title: 'La unidad nunca sube a más personas de las que admite.',
        text: 'La capacidad cuenta personas. Una sola regla decide a cuántas se puede llamar, tanto con «llama a las cinco siguientes» como con «llama a esta», y la fila de la unidad queda bloqueada mientras decide.',
      },
      {
        label: 'Límites',
        title: 'El viaje de otra flota no existe. Un enrutador malo no se cree.',
        text: 'Todo se acota por la flota del token, así que el id de otra flota responde 404, no 403. Una respuesta hostil del enrutador se rechaza y la ETA dice que volvió a la línea recta.',
      },
    ],
    modulesTitle: 'Todo lo que trae la caja.',
    modulesNote: 'Cada pieza tiene su archivo de pruebas y un lugar en el laboratorio',
    modules: [
      [
        null,
        'Historial solo de añadir',
        'Particiones diarias, clave primaria de conductor y hora de captura, ON CONFLICT DO NOTHING, y retención eliminando una partición en vez de borrar filas.',
      ],
      [
        null,
        'Upsert de la última posición',
        'Gana la captura más nueva; una más antigua se guarda en el historial pero nunca mueve el vehículo, y el momento en que se movió de verdad se registra aparte.',
      ],
      [
        null,
        'ETA con método',
        'Por carretera o en línea recta, velocidad medida o por defecto, y la respuesta dice cuál. Un cortacircuitos y una caché protegen al enrutador.',
      ],
      [
        null,
        'Alertas como estado',
        'Sin señal, parada larga, llegando pronto. Un evaluador programado las reconcilia con los hechos; un índice único parcial mantiene una abierta de cada tipo.',
      ],
      [
        null,
        'Cola con capacidad',
        'Una sola regla de admisión para las dos formas de llamar, FOR UPDATE sobre la unidad, y un aviso cuando las personas a bordo superan el límite.',
      ],
      [
        null,
        'Tiempo real a través de la base de datos',
        'pg_notify dentro de la transacción, una conexión LISTEN dedicada que se reconecta, y salas tomadas del token verificado, nunca de un mensaje.',
      ],
    ],
    transparency: {
      strong: 'Honestos sobre la demo.',
      text: 'Los teléfonos y el enrutador de carreteras son programas simulados que hablan con la API real por HTTP; nada de esto se ha ejecutado con dispositivos reales ni con un motor de rutas real. La región es inventada. La lista de limitaciones del README es completa.',
    },
  },
  challenges: {
    eyebrow: 'Lo difícil',
    title: ['Vamos,', 'intenta romperlo.'],
    text: 'Son las siete cosas fáciles de afirmar y difíciles de hacer bien. Cada una tiene una receta, lo que deberías ver y un botón que abre el laboratorio justo en esa pestaña.',
    items: [
      {
        label: 'Atravesar un túnel',
        title: 'Deja un teléfono sin conexión, sigue conduciendo y luego recupéralo.',
        text: 'Los teléfonos pierden la señal. El servidor no debe perder la hora.',
      },
      {
        label: 'Enviar un lote malo',
        title: 'Mezcla lecturas buenas con una isla nula, un reloj del futuro y una antigua.',
        text: 'Una lectura mala no debe costar el resto.',
      },
      {
        label: 'Quedarse en la línea',
        title: 'Haz que un teléfono tiemble en el borde del destino.',
        text: 'Llegar es una decisión, no una coordenada.',
      },
      {
        label: 'Quedarse en silencio',
        title: 'Corta la señal de un teléfono y espera la alerta.',
        text: 'Nadie avisa de que ha dejado de avisar.',
      },
      {
        label: 'Sobrecargar la furgoneta',
        title: 'Llama a más personas de las que caben, de dos maneras distintas.',
        text: 'Una regla de capacidad que solo obedece un camino no es una regla.',
      },
      {
        label: 'Romper el enrutador',
        title: 'Haz que el enrutador de carreteras mienta, se atasque y desaparezca.',
        text: 'Una dependencia que no es tuya es una entrada, no un hecho.',
      },
      {
        label: 'Husmear en otra flota',
        title: 'Pide a una flota el viaje, el socket y la hoja de otra flota.',
        text: 'El aislamiento que se comprueba puede olvidarse. El aislamiento estructural, no.',
      },
    ],
  },
  run: {
    eyebrow: 'Ejecútalo en un minuto',
    title: ['Un comando.', 'Una flota en localhost.'],
    text: 'Necesitas Docker. No hay claves de API, ni cuentas que crear, y nada sale de tu máquina.',
    steps: [
      [null, 'Clonar', 'git clone y luego entra en la carpeta.'],
      [
        null,
        'Iniciar',
        'make demo construye la imagen, migra la base de datos y levanta la API, el worker y el campo simulado, esperando a que estén sanos.',
      ],
      [
        null,
        'Abrir',
        'http://localhost:8400 es esta página. Pulsa «Entrar al laboratorio»: los vehículos ya se están moviendo.',
      ],
      [null, 'Rómpelo', 'Usa las partes difíciles de arriba, o ejecuta make e2e para la suite de navegador.'],
    ],
  },
  under: {
    eyebrow: 'Bajo el capó',
    title: ['Una superficie pequeña,', 'bordes serios.'],
    text: 'El código interesante es corto a propósito. Las decisiones detrás están escritas, con las alternativas que perdieron.',
    stackTitle: 'Con qué está construido',
    proofTitle: 'Qué se mide, y los registros que lo respaldan',
    numbers: [
      [null, 'pruebas: 215 unitarias y 151 sobre un PostGIS real con la aplicación escuchando'],
      [null, 'reglas rotas a propósito y detectadas por una prueba, ninguna sin detectar'],
      [null, 'registros de decisión, cada uno con alternativas descartadas'],
      [null, 'errores bajo tsc --strict'],
    ],
    decisions: [
      [
        'Filtrar cada lectura, no la petición',
        'ADR 0002: por qué una coordenada mala no debe costar las otras 299.',
      ],
      [
        'Un historial al que solo se añade',
        'ADR 0003: particiones, escrituras idempotentes y retención sin DELETE.',
      ],
      ['Las alertas son estado', 'ADR 0004: por qué un reconciliador gana a un manejador de eventos.'],
      [
        'Una sola regla de admisión',
        'ADR 0005: cómo la capacidad se mantiene cierta con llamadas concurrentes.',
      ],
      [
        'Una ETA que dice su método',
        'ADR 0006: alternativas honestas y un enrutador en el que no se confía.',
      ],
      [
        'Tiempo real a través de la base de datos',
        'ADR 0007: pg_notify en la transacción y salas a partir del token.',
      ],
      [
        'Un laboratorio que no llega a producción',
        'ADR 0008: tres capas mantienen los interruptores donde deben estar.',
      ],
      [
        'Viajes por tabla, enlaces por firma',
        'ADR 0009: transiciones con comparar-y-fijar y enlaces que llevan su propio permiso.',
      ],
      [
        'Límites por construcción',
        'ADR 0010: la flota sale del token, denegar por defecto, un rol de base de datos pequeño.',
      ],
    ],
    measuredOn: 'Medido el 2026-11-05. Las cifras salen de los comandos del README, no de la memoria.',
    future: [
      ['Un motor de rutas real', 'tras el mismo adaptador protegido, con sus propios datos de tráfico.'],
      ['Notificaciones push a los conductores', 'en lugar de sondeo, a través de las mismas salas.'],
      [
        'Retención por flota',
        'porque cuánto tiempo pueden guardarse las posiciones es un término del contrato.',
      ],
    ],
  },
  about: {
    why: 'Waypoint es la parte de operaciones de campo de mi trabajo: teléfonos de los que no se puede esperar que estén conectados, tengan la hora correcta o envíen las cosas una sola vez, alimentando pantallas con las que la gente toma decisiones. Las ideas vienen de sistemas que he construido y operado; el código de este repositorio está escrito desde cero y probado.',
  },
  faq: [
    [
      '¿Hay un registro real?',
      'No, a propósito. La demo tiene dos flotas inventadas, cada una con un despachador y conductores; el laboratorio te hace entrar como cualquiera de ellos. El acceso real (scrypt, límites de intentos, JWT fijado) está en la API y probado.',
    ],
    [
      '¿Por qué PostGIS y no solo columnas de latitud y longitud?',
      'Las distancias, los radios y los recorridos son problemas de geografía. PostGIS los resuelve bien sobre una esfera, los indexa y mantiene las comprobaciones de geovalla en un solo sitio.',
    ],
    [
      '¿Por qué particionar el historial por día?',
      'Porque la forma más barata de olvidar datos personales según un calendario es eliminar una partición. El rol de la aplicación ni siquiera puede hacer DELETE sobre el historial; una función controlada elimina las particiones.',
    ],
    [
      '¿Qué pasa si dos workers evalúan las alertas a la vez?',
      'No se rompe nada. El evaluador compara los hechos con las alertas abiertas y un índice único parcial impide el duplicado, así que uno o tres workers dan el mismo resultado.',
    ],
    [
      '¿Puede el modo laboratorio llegar a producción?',
      'No. La configuración rechaza LAB_MODE y una contraseña de demo cuando NODE_ENV es production, una prueba lo fija, y las rutas del laboratorio responden 404 si no está activo y rechazan cualquier Host que no sea local.',
    ],
    [
      '¿Está listo para producción?',
      'Está construido y probado con ese nivel de exigencia: tipos estrictos, pruebas con base de datos real, comprobaciones de mutación. No ha soportado tráfico real, y lo que le falta está en las limitaciones del README.',
    ],
  ],
  closing: {
    eyebrow: 'Te toca',
    title: ['Intenta que el servidor', 'crea una posición que no debería.'],
    button: 'Abrir el laboratorio',
    fine: 'Solo local · datos ficticios · no se envía nada a ningún sitio',
  },
};
