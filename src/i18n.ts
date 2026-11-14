import type { Language } from "@sculptr/sdk";

export interface Text {
  status: {
    offline: string;
    live: string;
    lost: string;
  };
  unsupported: string;
  players: (count: number) => string;
  you: (name: string) => string;
  history: string;
  controls: string;
  chat: string;
  saves: string;
  shareSaves: string;
  noSharedSaves: string;
  /**
   * Drawn over the game rather than in the panel.
   *
   * These reach the game as pictures (see `@sculptr/text` in `index.ts`), so unlike anything the
   * game's own font would draw, they can say whatever their language needs. `say` is the exception:
   * it is the prompt of GameMaker's own input box, which the runner draws, so it travels as text.
   */
  game: {
    alone: string;
    others: (count: number) => string;
    joined: (name: string) => string;
    left: (name: string) => string;
    saved: (name: string) => string;
    outdated: string;
    full: string;
    reconnected: string;
    lost: string;
    say: string;
  };
}

const en: Text = {
  status: {
    offline: "Offline",
    live: "Connected",
    lost: "Reconnecting...",
  },
  unsupported: "Not supported",
  players: (count) => `Players (${count})`,
  you: (name) => `${name} (you)`,
  history: "History",
  controls: "Controls",
  chat: "Chat",
  saves: "Saves",
  shareSaves: "Share saves",
  noSharedSaves: "This game is not supported.",
    game: {
    alone: "Online: nobody else is playing this right now",
    others: (count) =>
      count === 1
        ? "Online: 1 other player in this game"
        : `Online: ${count} other players in this game`,
    joined: (name) => `${name} joined`,
    left: (name) => `${name} left`,
    saved: (name) => `${name} saved`,
    outdated: "Online: this mod is out of date, update it",
    full: "Online: this game's lobby is full",
    reconnected: "Online: reconnected",
    lost: "Online: connection lost, retrying...",
    say: "Say something:",
    },
};

const TEXT: Record<Language, Text> = {
  en,
  "zh-CN": {
    status: {
      offline: "离线",
      live: "已连接",
      lost: "正在重连…",
    },
    unsupported: "不支持",
    players: (count) => `玩家（${count}）`,
    you: (name) => `${name}（你）`,
    history: "聊天记录",
    controls: "操作",
    chat: "聊天",
    saves: "存档",
    shareSaves: "共享存档",
    noSharedSaves: "此游戏不支持。",
    game: {
    alone: "Online：现在没有别人在玩这个游戏",
    others: (count) => `Online：这个游戏里还有 ${count} 名玩家`,
    joined: (name) => `${name} 加入了`,
    left: (name) => `${name} 离开了`,
    saved: (name) => `${name} 存档了`,
    outdated: "Online：这个模组版本过旧，请更新",
    full: "Online：这个游戏的房间已满",
    reconnected: "Online：已重新连接",
    lost: "Online：连接断开，正在重试…",
    say: "说点什么：",
    },
  },
  ja: {
    status: {
      offline: "オフライン",
      live: "接続中",
      lost: "再接続中…",
    },
    unsupported: "非対応",
    players: (count) => `プレイヤー（${count}）`,
    you: (name) => `${name}（あなた）`,
    history: "履歴",
    controls: "操作キー",
    chat: "チャット",
    saves: "セーブ",
    shareSaves: "セーブを共有",
    noSharedSaves: "このゲームは非対応です。",
    game: {
    alone: "Online: いま他に遊んでいる人はいません",
    others: (count) => `Online: このゲームには他に${count}人います`,
    joined: (name) => `${name} が参加しました`,
    left: (name) => `${name} が退出しました`,
    saved: (name) => `${name} がセーブしました`,
    outdated: "Online: このMODは古いので更新してください",
    full: "Online: このゲームのロビーは満員です",
    reconnected: "Online: 再接続しました",
    lost: "Online: 接続が切れました。再試行中…",
    say: "なにか話す：",
    },
  },
  ko: {
    status: {
      offline: "오프라인",
      live: "연결됨",
      lost: "다시 연결 중…",
    },
    unsupported: "지원하지 않아요",
    players: (count) => `플레이어 (${count})`,
    you: (name) => `${name} (나)`,
    history: "기록",
    controls: "조작 키",
    chat: "채팅",
    saves: "세이브",
    shareSaves: "세이브 공유",
    noSharedSaves: "이 게임은 지원하지 않아요.",
    game: {
    alone: "Online: 지금 이 게임을 하는 다른 사람이 없어요",
    others: (count) => `Online: 이 게임에 다른 플레이어 ${count}명`,
    joined: (name) => `${name} 님이 들어왔어요`,
    left: (name) => `${name} 님이 나갔어요`,
    saved: (name) => `${name} 님이 세이브했어요`,
    outdated: "Online: 이 모드가 오래됐어요. 업데이트해 주세요",
    full: "Online: 이 게임의 로비가 가득 찼어요",
    reconnected: "Online: 다시 연결됐어요",
    lost: "Online: 연결이 끊겼어요. 다시 시도 중…",
    say: "할 말을 입력하세요:",
    },
  },
  es: {
    status: {
      offline: "Sin conexión",
      live: "Conectado",
      lost: "Reconectando...",
    },
    unsupported: "No compatible",
    players: (count) => `Jugadores (${count})`,
    you: (name) => `${name} (tú)`,
    history: "Historial",
    controls: "Controles",
    chat: "Chat",
    saves: "Guardados",
    shareSaves: "Compartir guardados",
    noSharedSaves: "Este juego no es compatible.",
    game: {
    alone: "Online: ahora mismo no hay nadie más jugando a esto",
    others: (count) =>
      count === 1
        ? "Online: hay 1 jugador más en este juego"
        : `Online: hay ${count} jugadores más en este juego`,
    joined: (name) => `${name} se ha unido`,
    left: (name) => `${name} se ha ido`,
    saved: (name) => `${name} ha guardado`,
    outdated: "Online: este mod está desactualizado, actualízalo",
    full: "Online: la sala de este juego está llena",
    reconnected: "Online: reconectado",
    lost: "Online: conexión perdida, reintentando...",
    say: "Di algo:",
    },
  },
  "pt-BR": {
    status: {
      offline: "Offline",
      live: "Conectado",
      lost: "Reconectando...",
    },
    unsupported: "Sem suporte",
    players: (count) => `Jogadores (${count})`,
    you: (name) => `${name} (você)`,
    history: "Histórico",
    controls: "Controles",
    chat: "Chat",
    saves: "Saves",
    shareSaves: "Compartilhar saves",
    noSharedSaves: "Este jogo não tem suporte.",
    game: {
    alone: "Online: ninguém mais está jogando isto agora",
    others: (count) =>
      count === 1
        ? "Online: mais 1 jogador neste jogo"
        : `Online: mais ${count} jogadores neste jogo`,
    joined: (name) => `${name} entrou`,
    left: (name) => `${name} saiu`,
    saved: (name) => `${name} salvou`,
    outdated: "Online: este mod está desatualizado, atualize-o",
    full: "Online: a sala deste jogo está cheia",
    reconnected: "Online: reconectado",
    lost: "Online: conexão perdida, tentando de novo...",
    say: "Diga algo:",
    },
  },
  de: {
    status: {
      offline: "Offline",
      live: "Verbunden",
      lost: "Neuverbindung...",
    },
    unsupported: "Nicht unterstützt",
    players: (count) => `Spieler (${count})`,
    you: (name) => `${name} (du)`,
    history: "Verlauf",
    controls: "Steuerung",
    chat: "Chat",
    saves: "Speicherpunkte",
    shareSaves: "Speicherpunkte teilen",
    noSharedSaves: "Dieses Spiel wird nicht unterstützt.",
    game: {
    alone: "Online: gerade spielt sonst niemand dieses Spiel",
    others: (count) =>
      count === 1
        ? "Online: 1 weiterer Spieler in diesem Spiel"
        : `Online: ${count} weitere Spieler in diesem Spiel`,
    joined: (name) => `${name} ist beigetreten`,
    left: (name) => `${name} hat das Spiel verlassen`,
    saved: (name) => `${name} hat gespeichert`,
    outdated: "Online: dieses Mod ist veraltet, bitte aktualisieren",
    full: "Online: die Lobby dieses Spiels ist voll",
    reconnected: "Online: wieder verbunden",
    lost: "Online: Verbindung verloren, neuer Versuch...",
    say: "Sag etwas:",
    },
  },
  fr: {
    status: {
      offline: "Hors ligne",
      live: "Connecté",
      lost: "Reconnexion...",
    },
    unsupported: "Non pris en charge",
    players: (count) => `Joueurs (${count})`,
    you: (name) => `${name} (toi)`,
    history: "Historique",
    controls: "Commandes",
    chat: "Chat",
    saves: "Sauvegardes",
    shareSaves: "Partager les sauvegardes",
    noSharedSaves: "Ce jeu n'est pas pris en charge.",
    game: {
    alone: "Online : personne d'autre ne joue à ce jeu pour le moment",
    others: (count) =>
      count === 1
        ? "Online : 1 autre joueur dans ce jeu"
        : `Online : ${count} autres joueurs dans ce jeu`,
    joined: (name) => `${name} a rejoint`,
    left: (name) => `${name} a quitté`,
    saved: (name) => `${name} a sauvegardé`,
    outdated: "Online : ce mod n'est pas à jour, mets-le à jour",
    full: "Online : le salon de ce jeu est plein",
    reconnected: "Online : reconnecté",
    lost: "Online : connexion perdue, nouvelle tentative...",
    say: "Dis quelque chose :",
    },
  },
  it: {
    status: {
      offline: "Offline",
      live: "Connesso",
      lost: "Riconnessione...",
    },
    unsupported: "Non supportato",
    players: (count) => `Giocatori (${count})`,
    you: (name) => `${name} (tu)`,
    history: "Cronologia",
    controls: "Comandi",
    chat: "Chat",
    saves: "Salvataggi",
    shareSaves: "Condividi i salvataggi",
    noSharedSaves: "Questo gioco non è supportato.",
    game: {
    alone: "Online: adesso non ci sta giocando nessun altro",
    others: (count) =>
      count === 1
        ? "Online: 1 altro giocatore in questo gioco"
        : `Online: ${count} altri giocatori in questo gioco`,
    joined: (name) => `${name} entra`,
    left: (name) => `${name} esce`,
    saved: (name) => `${name} ha salvato`,
    outdated: "Online: questa mod è obsoleta, aggiornala",
    full: "Online: la lobby di questo gioco è piena",
    reconnected: "Online: riconnesso",
    lost: "Online: connessione perduta, nuovo tentativo...",
    say: "Di' qualcosa:",
    },
  },
  ru: {
    status: {
      offline: "Не подключено",
      live: "Подключено",
      lost: "Переподключение...",
    },
    unsupported: "Не поддерживается",
    players: (count) => `Игроки (${count})`,
    you: (name) => `${name} (вы)`,
    history: "История",
    controls: "Управление",
    chat: "Чат",
    saves: "Сохранения",
    shareSaves: "Делиться сохранениями",
    noSharedSaves: "Эта игра не поддерживается.",
    game: {
    alone: "Online: сейчас больше никто не играет в эту игру",
    others: (count) => `Online: других игроков в этой игре: ${count}`,
    joined: (name) => `${name}: вход в игру`,
    left: (name) => `${name}: выход из игры`,
    saved: (name) => `${name}: сохранение`,
    outdated: "Online: этот мод устарел, обновите его",
    full: "Online: лобби этой игры заполнено",
    reconnected: "Online: соединение восстановлено",
    lost: "Online: соединение потеряно, повторная попытка…",
    say: "Скажите что-нибудь:",
    },
  },
  pl: {
    status: {
      offline: "Offline",
      live: "Połączono",
      lost: "Ponowne łączenie...",
    },
    unsupported: "Nieobsługiwane",
    players: (count) => `Gracze (${count})`,
    you: (name) => `${name} (ty)`,
    history: "Historia",
    controls: "Sterowanie",
    chat: "Czat",
    saves: "Zapisy",
    shareSaves: "Udostępnianie zapisów",
    noSharedSaves: "Ta gra nie jest obsługiwana.",
    game: {
    alone: "Online: nikt inny teraz w to nie gra",
    others: (count) =>
      count === 1
        ? "Online: w tej grze jest jeszcze 1 gracz"
        : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
          ? `Online: w tej grze jest jeszcze ${count} gracze`
          : `Online: w tej grze jest jeszcze ${count} graczy`,
    joined: (name) => `${name} dołączył(a)`,
    left: (name) => `${name} opuścił(a) grę`,
    saved: (name) => `${name} zapisał(a)`,
    outdated: "Online: ten mod jest przestarzały, zaktualizuj go",
    full: "Online: lobby tej gry jest pełne",
    reconnected: "Online: połączono ponownie",
    lost: "Online: połączenie utracone, ponawiam...",
    say: "Powiedz coś:",
    },
  },
};

export function text(language: Language): Text {
  return (TEXT as Partial<Record<string, Text>>)[language] ?? en;
}
