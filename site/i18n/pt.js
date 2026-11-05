/* Portuguese overlay. Text only: the keys mirror the shape of content.js, and anything missing falls back to English. */
(window.SITE_I18N ||= {}).pt = {
  title: 'waypoint-field-ops · um backend de frota para celulares que perdem o sinal',
  loading: {
    context: 'Operações de frota',
    title: 'Localizando a frota',
    text: 'Lendo as últimas posições, o roteador de estradas e o relógio.',
    foot: 'Demo local · celulares simulados nesta máquina',
  },
  lab: { cta: 'Entrar no laboratório' },
  hero: {
    eyebrow: 'Operações de campo · tolerante à falta de conexão, honesto sobre o que sabe',
    lead: 'Saiba onde está cada veículo',
    soft: 'e com que certeza.',
    text: 'Um backend de frota para celulares que passam por túneis, enviam uma hora de posições de uma vez e às vezes estão com o horário errado. As leituras são filtradas e guardadas uma única vez, as ETAs dizem como foram calculadas, o silêncio dispara um alerta e uma fila nunca embarca mais pessoas do que o veículo comporta. Celulares simulados percorrem uma região inventada no seu notebook.',
    primary: { label: 'Abrir o laboratório' },
    secondary: { label: 'Ver como funciona' },
    pilot: 'Roda no seu notebook · os celulares e o roteador de estradas são simulados, sem contas',
    proof: [
      { a: 'As posições são guardadas uma vez', b: 'não importa quantas vezes sejam enviadas' },
      { a: 'Cada garantia tem um teste', b: 'que tenta quebrá-la' },
    ],
    top: ['WAYPOINT', 'Posições que você consegue defender.'],
    status: {
      small: 'Último alerta',
      strong: 'Sem sinal há 4 min. Aberto pelo worker, fechado pela posição seguinte.',
    },
  },
  principles: {
    lead: ['Feito para', 'as zonas sem sinal.'],
    items: [
      [null, 'Guarda uma vez'],
      [null, 'Diz o seu método'],
      [null, 'Alerta pelo silêncio'],
      [null, 'Conta pessoas'],
    ],
  },
  tour: {
    eyebrow: 'Um tour por tudo',
    title: ['Cinco coisas que dão errado', 'na estrada.'],
    text: 'Escolha uma aba. A saída abaixo é gravada da aplicação em execução com dados fictícios; um teste falha se ela deixar de ser verdadeira.',
    tag: 'Saída gravada',
    tabs: [
      {
        label: 'Ingestão',
        title: 'Uma hora num túnel chega como um único lote e é guardada uma vez.',
        text: 'Uma leitura sem posição de GPS ou com o relógio errado é recusada sozinha; as boas do mesmo lote ficam. Enviar o lote de novo não muda nada, e uma leitura antiga nunca faz o veículo voltar.',
      },
      {
        label: 'Chegada',
        title: 'Chegar exige duas boas posições e é registrado uma única vez.',
        text: 'Uma posição dentro do raio pode ser ruído de GPS. Uma posição que admite a própria margem de erro é imprecisa demais para contar. A chegada é marcada com uma atualização condicional, então dois lotes simultâneos não podem reivindicá-la os dois.',
      },
      {
        label: 'Alertas',
        title: 'O silêncio dispara um alerta. Uma posição o encerra.',
        text: 'Alertas são estado, não eventos: um índice único parcial permite um alerta aberto por veículo e tipo, e um avaliador agendado os reconcilia. Rodá-lo duas vezes, ou em três workers, dá a mesma resposta.',
      },
      {
        label: 'Fila',
        title: 'A unidade nunca embarca mais pessoas do que comporta.',
        text: 'A capacidade conta pessoas. Uma única regra decide quantas podem ser chamadas, tanto em «chamar as cinco próximas» quanto em «chamar esta», e a linha da unidade fica travada enquanto ela decide.',
      },
      {
        label: 'Limites',
        title: 'A viagem de outra frota não existe. Um roteador ruim não é levado a sério.',
        text: 'Tudo é delimitado pela frota do token, então o id de outra frota responde 404, não 403. Uma resposta hostil do roteador é recusada e a ETA diz que voltou para a linha reta.',
      },
    ],
    modulesTitle: 'Tudo o que vem na caixa.',
    modulesNote: 'Cada peça tem um arquivo de testes e um lugar no laboratório',
    modules: [
      [
        null,
        'Histórico só de acréscimo',
        'Partições diárias, chave primária de motorista e hora da captura, ON CONFLICT DO NOTHING, e retenção descartando uma partição em vez de apagar linhas.',
      ],
      [
        null,
        'Upsert da última posição',
        'A captura mais nova vence, uma mais antiga fica no histórico mas nunca move o veículo, e o momento em que ele se moveu de verdade é registrado à parte.',
      ],
      [
        null,
        'ETA com método',
        'Por estrada ou em linha reta, velocidade medida ou padrão, e a resposta diz qual. Um disjuntor e um cache ficam na frente do roteador.',
      ],
      [
        null,
        'Alertas como estado',
        'Sem sinal, parada longa, chegando em breve. Um avaliador agendado os reconcilia com os fatos; um índice único parcial mantém um aberto de cada.',
      ],
      [
        null,
        'Fila ciente da capacidade',
        'Uma regra de admissão para as duas formas de chamar, FOR UPDATE na unidade, e um aviso quando as pessoas a bordo passam do limite.',
      ],
      [
        null,
        'Tempo real pelo banco de dados',
        'pg_notify dentro da transação, uma conexão LISTEN dedicada que se reconecta, e salas tiradas do token verificado, nunca de uma mensagem.',
      ],
    ],
    transparency: {
      strong: 'Honestos sobre a demo.',
      text: 'Os celulares e o roteador de estradas são programas simulados que falam com a API real por HTTP; nada aqui rodou com dispositivos reais nem com um motor de rotas real. A região é inventada. A lista de limitações do README é completa.',
    },
  },
  challenges: {
    eyebrow: 'As partes difíceis',
    title: ['Vamos,', 'tente quebrar.'],
    text: 'São as sete coisas fáceis de afirmar e difíceis de acertar. Cada uma tem uma receita, o que você deve ver e um botão que abre o laboratório exatamente naquela aba.',
    items: [
      {
        label: 'Passar por um túnel',
        title: 'Deixe um celular offline, continue dirigindo e depois traga-o de volta.',
        text: 'Celulares perdem o sinal. O servidor não pode perder a hora.',
      },
      {
        label: 'Enviar um lote ruim',
        title: 'Misture leituras boas com uma ilha nula, um relógio do futuro e uma antiga.',
        text: 'Uma leitura ruim não pode custar as outras.',
      },
      {
        label: 'Ficar em cima da linha',
        title: 'Faça um celular oscilar na borda do destino.',
        text: 'Chegar é uma decisão, não uma coordenada.',
      },
      {
        label: 'Ficar mudo',
        title: 'Corte o sinal de um celular e espere o alerta.',
        text: 'Ninguém avisa que parou de avisar.',
      },
      {
        label: 'Superlotar a van',
        title: 'Chame mais pessoas do que a unidade comporta, de duas formas diferentes.',
        text: 'Uma regra de capacidade que só um caminho obedece não é uma regra.',
      },
      {
        label: 'Quebrar o roteador',
        title: 'Faça o roteador de estradas mentir, travar e sumir.',
        text: 'Uma dependência que não é sua é uma entrada, não um fato.',
      },
      {
        label: 'Espiar outra frota',
        title: 'Peça a uma frota a viagem, o socket e a folha de outra frota.',
        text: 'Isolamento que é verificado pode ser esquecido. Isolamento estrutural, não.',
      },
    ],
  },
  run: {
    eyebrow: 'Rode em um minuto',
    title: ['Um comando.', 'Uma frota no localhost.'],
    text: 'Você precisa do Docker. Não há chaves de API, nem contas para criar, e nada sai da sua máquina.',
    steps: [
      [null, 'Clonar', 'git clone e depois entre na pasta.'],
      [
        null,
        'Iniciar',
        'make demo constrói a imagem, migra o banco e sobe a API, o worker e o campo simulado, aguardando ficarem saudáveis.',
      ],
      [
        null,
        'Abrir',
        'http://localhost:8400 é esta página. Clique em «Entrar no laboratório»: os veículos já estão se movendo.',
      ],
      [null, 'Quebrar', 'Use as partes difíceis acima, ou rode make e2e para a suíte de navegador.'],
    ],
  },
  under: {
    eyebrow: 'Por baixo do capô',
    title: ['Uma superfície pequena,', 'bordas sérias.'],
    text: 'O código interessante é curto de propósito. As decisões por trás dele estão escritas, com as alternativas que perderam.',
    stackTitle: 'Com o que é construído',
    proofTitle: 'O que é medido, e os registros por trás',
    numbers: [
      [null, 'testes: 215 unitários e 151 contra um PostGIS real com a aplicação escutando'],
      [null, 'regras quebradas de propósito e detectadas por um teste, nenhuma sem detecção'],
      [null, 'registros de decisão, cada um com alternativas descartadas'],
      [null, 'erros sob tsc --strict'],
    ],
    decisions: [
      [
        'Filtrar cada leitura, não a requisição',
        'ADR 0002: por que uma coordenada ruim não pode custar as outras 299.',
      ],
      [
        'Um histórico em que só se acrescenta',
        'ADR 0003: partições, escritas idempotentes e retenção sem DELETE.',
      ],
      ['Alertas são estado', 'ADR 0004: por que um reconciliador vence um tratador de eventos.'],
      ['Uma regra de admissão', 'ADR 0005: como a capacidade continua verdadeira sob chamadas concorrentes.'],
      ['Uma ETA que diz seu método', 'ADR 0006: fallbacks honestos e um roteador em que não se confia.'],
      ['Tempo real pelo banco de dados', 'ADR 0007: pg_notify na transação e salas a partir do token.'],
      [
        'Um laboratório que não chega à produção',
        'ADR 0008: três camadas mantêm os interruptores onde devem ficar.',
      ],
      [
        'Viagens por tabela, links por assinatura',
        'ADR 0009: transições com comparar-e-trocar e links que carregam a própria permissão.',
      ],
      [
        'Limites por construção',
        'ADR 0010: a frota vem do token, negar por padrão, um papel de banco pequeno.',
      ],
    ],
    measuredOn: 'Medido em 2026-11-05. Os números vêm dos comandos do README, não da memória.',
    future: [
      ['Um motor de rotas real', 'atrás do mesmo adaptador protegido, com seus próprios dados de tráfego.'],
      ['Push para os motoristas', 'em vez de consulta periódica, pelas mesmas salas.'],
      [
        'Retenção por frota',
        'porque por quanto tempo as posições podem ser guardadas é um termo de contrato.',
      ],
    ],
  },
  about: {
    why: 'Waypoint é o lado de operações de campo do meu trabalho: celulares dos quais não se pode esperar que estejam online, com a hora certa ou que enviem as coisas uma só vez, alimentando telas nas quais pessoas tomam decisões. As ideias vêm de sistemas que construí e operei; o código deste repositório foi escrito do zero e testado.',
  },
  faq: [
    [
      'Existe um cadastro de verdade?',
      'Não, de propósito. A demo tem duas frotas inventadas, cada uma com um despachante e motoristas; o laboratório entra como qualquer um deles. O login real (scrypt, limite de tentativas, JWT fixado) está na API e testado.',
    ],
    [
      'Por que PostGIS e não só colunas de latitude e longitude?',
      'Distâncias, raios e trajetos são problemas de geografia. O PostGIS os resolve corretamente numa esfera, os indexa e mantém as verificações de geofence num só lugar.',
    ],
    [
      'Por que particionar o histórico por dia?',
      'Porque a forma mais barata de esquecer dados pessoais em dia é descartar uma partição. O papel da aplicação nem consegue dar DELETE no histórico; uma função controlada descarta as partições.',
    ],
    [
      'E se dois workers avaliarem os alertas ao mesmo tempo?',
      'Nada quebra. O avaliador compara os fatos com os alertas abertos e um índice único parcial impede a duplicata, então um worker ou três dão o mesmo resultado.',
    ],
    [
      'O modo laboratório pode chegar à produção?',
      'Não. A configuração recusa LAB_MODE e uma senha de demo quando NODE_ENV é production, um teste garante isso, e as rotas do laboratório respondem 404 se ele não estiver ligado e recusam qualquer Host que não seja local.',
    ],
    [
      'Está pronto para produção?',
      'Foi construído e testado nesse padrão: tipos estritos, testes com banco de dados real, verificações de mutação. Não carregou tráfego real, e o que falta está nas limitações do README.',
    ],
  ],
  closing: {
    eyebrow: 'Sua vez',
    title: ['Tente fazer o servidor', 'acreditar numa posição em que não deveria.'],
    button: 'Abrir o laboratório',
    fine: 'Só local · dados fictícios · nada é enviado a lugar nenhum',
  },
};
