import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createDeck, shuffleDeck, type Card as CardType } from "./cards";

type Player = {
  id: number;
  name: string;
  hand: CardType[];
};

type Direction = 1 | -1;
type Suit = CardType["suit"];

type RoundScoreEntry = {
  round: number;
  playerId: number;
  roundScore: number;
  totalScore: number;
  isDobonWinner: boolean;
  isVictim: boolean;
};

type GameState = {
  players: Player[];
  deck: CardType[];
  fieldCards: CardType[];
  fieldStack: CardType[];
  fieldValue: number;
  discardPile: CardType[];
  currentTurnIndex: number;
  direction: Direction;
  pendingDrawCount: number;
  requestedSuits: Suit[] | null;
  waitingForSuitSelect: boolean;
  dobonPlayerIds: number[];
  dobonTimeLeft: number;
  message: string;
  roundNumber: number;
  scores: number[];
  scoreHistory: RoundScoreEntry[];
  roundOver: boolean;
  gameOver: boolean;
  roundResultMessage: string;
  lastPlayedByIndex: number | null;
};

type PlayerPosition = "you" | "left" | "top" | "right" | "bottom";

type ActionAnimation = {
  kind: "play" | "draw";
  label: string;
  from: PlayerPosition;
  to: PlayerPosition;
  isRed: boolean;
};

const allSuits: Suit[] = ["spade", "heart", "diamond", "club"];
const maxRounds = 10;
const dobonLimitSeconds = 5;

const cpuNamePool = [
  "ハル", "ミナト", "ソラ", "ユイ", "アオイ", "レン", "ナギ", "リク",
  "カイ", "ミオ", "ユズ", "レイ", "ヒナ", "コウ", "サナ", "トワ",
];

function createRandomCpuNames(): string[] {
  const shuffled = [...cpuNamePool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3).map((name) => `${name}（CPU）`);
}

function App() {
  const [gameStarted, setGameStarted] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [cpuNames, setCpuNames] = useState<string[]>(() => createRandomCpuNames());
  const [selectedSuits, setSelectedSuits] = useState<Suit[]>([]);
  const [selectedCardIndexes, setSelectedCardIndexes] = useState<number[]>([]);
  const [topCardIndex, setTopCardIndex] = useState<number | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [showScoreTable, setShowScoreTable] = useState(false);
  const [showScoreRules, setShowScoreRules] = useState(false);
  const [showSettingsHelp, setShowSettingsHelp] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [bgmSoundEnabled, setBgmSoundEnabled] = useState(true);
  const [cardSoundEnabled, setCardSoundEnabled] = useState(true);
  const [actionSoundEnabled, setActionSoundEnabled] = useState(true);
  const [dobonSoundEnabled, setDobonSoundEnabled] = useState(true);
  const [failedDobonPenaltyCount, setFailedDobonPenaltyCount] = useState(0);
  const [showDealAnimation, setShowDealAnimation] = useState(false);
  const [actionAnimation, setActionAnimation] = useState<ActionAnimation | null>(null);
  const [showExplosion, setShowExplosion] = useState(false);
  const [showDobonMissEffect, setShowDobonMissEffect] = useState(false);
  const [visualTurnIndex, setVisualTurnIndex] = useState(0);
  const [bgmEnabled, setBgmEnabled] = useState(false);
  const [expertMode, setExpertMode] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const bgmNodesRef = useRef<{
    gain: GainNode;
    intervalId: number;
  } | null>(null);

  useEffect(() => {
    const updateIsMobile = () => {
      setIsMobile(window.innerWidth <= 700);
    };

    updateIsMobile();
    window.addEventListener("resize", updateIsMobile);

    return () => window.removeEventListener("resize", updateIsMobile);
  }, []);

  const [game, setGame] = useState<GameState>(() =>
    createRoundState({
      roundNumber: 1,
      scores: [0, 0, 0, 0],
      scoreHistory: [],
      starterIndex: 0,
      message: "1ラウンド目です。あなたの番です。",
      cpuNames,
    })
  );

  const currentPlayer = game.players[game.currentTurnIndex];
  const visualCurrentPlayer = game.players[visualTurnIndex];
  const yourPlayer = game.players[0];
  const bottomCpuPlayer = game.players[1];
  const leftCpuPlayer = game.players[2];
  const topCpuPlayer = game.players[3];
  const isYourTurn = game.currentTurnIndex === 0;
  const yourHand = yourPlayer.hand;
  const yourHandTotal = handTotal(yourHand);
  const canDobon = game.dobonPlayerIds.includes(game.players[0].id);
  const isLastCardState = yourHand.length === 1;
  const isDobonReception = game.dobonPlayerIds.length > 0 && !game.roundOver;
  const isOverlayOpen = showScoreTable || showScoreRules || showSettingsHelp || showDobonMissEffect;
  const isPenaltyPending = failedDobonPenaltyCount > 0;

  const selectedCards = selectedCardIndexes.map((index) => yourHand[index]);
  const needsTopCardSelect = selectedCardIndexes.length >= 2;
  const canPlaySelectedCards =
    isYourTurn &&
    selectedCards.length > 0 &&
    canPlayCards(selectedCards) &&
    (!needsTopCardSelect || topCardIndex !== null);

  const playerHasPlayableCard = yourHand.some((card) => canPlayCards([card]));

  const canDrawFromSomewhere =
    game.deck.length > 0 || game.discardPile.length > 0;

  const shouldDraw = isPenaltyPending
    ? !game.roundOver && !isOverlayOpen && canDrawFromSomewhere
    : isYourTurn &&
      !game.roundOver &&
      !isOverlayOpen &&
      !isDobonReception &&
      !game.waitingForSuitSelect &&
      canDrawFromSomewhere &&
      (game.pendingDrawCount > 0
        ? !playerHasPlayableCard
        : isLastCardState || !playerHasPlayableCard);

  useEffect(() => {
    if (!isDobonReception) return;
    if (isPenaltyPending) return;
    if (isOverlayOpen) return;

    const timer = setInterval(() => {
      setGame((currentGame) => {
        if (currentGame.roundOver) return currentGame;
        if (currentGame.dobonPlayerIds.length === 0) return currentGame;

        const nextTime = currentGame.dobonTimeLeft - 1;

        if (nextTime <= 0) {
          return {
            ...currentGame,
            dobonPlayerIds: [],
            dobonTimeLeft: 0,
            message: "ドボン受付時間が終了しました。",
          };
        }

        return {
          ...currentGame,
          dobonTimeLeft: nextTime,
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isDobonReception, isOverlayOpen]);

  useEffect(() => {
    if (isYourTurn) return;
    if (actionAnimation) return;
    if (isOverlayOpen) return;
    if (isPenaltyPending) return;
    if (game.waitingForSuitSelect) return;
    if (game.roundOver) return;
    if (game.dobonPlayerIds.length > 0) return;

    const timer = setTimeout(() => {
      cpuAction();
    }, 2000);

    return () => clearTimeout(timer);
  }, [
    game.currentTurnIndex,
    game.waitingForSuitSelect,
    game.roundOver,
    game.dobonPlayerIds.length,
    isOverlayOpen,
    actionAnimation,
  ]);

  useEffect(() => {
    if (actionAnimation) return;

    setVisualTurnIndex(game.currentTurnIndex);
  }, [game.currentTurnIndex, actionAnimation]);

  useEffect(() => {
    if (!actionAnimation) return;

    const timer = window.setTimeout(() => {
      setActionAnimation(null);
    }, 760);

    return () => window.clearTimeout(timer);
  }, [actionAnimation]);

  useEffect(() => {
    if (!showExplosion) return;

    const timer = window.setTimeout(() => {
      setShowExplosion(false);
    }, 1350);

    return () => window.clearTimeout(timer);
  }, [showExplosion]);

  useEffect(() => {
    // ドボン失敗エフェクトは自動では閉じない。
    // 右上の×を押して閉じた後、山札から2枚引けるようにする。
  }, [showDobonMissEffect]);

  function showDealMotion() {
    setShowDealAnimation(true);
    window.setTimeout(() => {
      setShowDealAnimation(false);
    }, 2300);
  }

  function getAudioContext(): AudioContext | null {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }

  function playTone({
    frequency,
    duration,
    type = "sine",
    volume = 0.08,
    slideTo,
  }: {
    frequency: number;
    duration: number;
    type?: OscillatorType;
    volume?: number;
    slideTo?: number;
  }) {
    const audioContext = getAudioContext();
    if (!audioContext) return;

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);

    if (slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  function playCardSound() {
    if (!soundEnabled || !cardSoundEnabled) return;
    playTone({ frequency: 900, slideTo: 420, duration: 0.12, type: "triangle", volume: 0.06 });
    window.setTimeout(() => {
      playTone({ frequency: 520, slideTo: 780, duration: 0.07, type: "square", volume: 0.025 });
    }, 45);
  }

  function playActionCardSound() {
    if (!soundEnabled || !actionSoundEnabled) return;
    playTone({ frequency: 740, duration: 0.1, type: "square", volume: 0.07 });
    window.setTimeout(() => {
      playTone({ frequency: 980, duration: 0.12, type: "square", volume: 0.06 });
    }, 110);
  }

  function playDobonMissSound() {
    if (!soundEnabled || !dobonSoundEnabled) return;

    playTone({ frequency: 180, slideTo: 110, duration: 0.22, type: "sawtooth", volume: 0.16 });
    window.setTimeout(() => {
      playTone({ frequency: 150, slideTo: 90, duration: 0.25, type: "sawtooth", volume: 0.16 });
    }, 190);
  }

  function playDobonExplosionSound() {
    if (!soundEnabled || !dobonSoundEnabled) return;
    const audioContext = getAudioContext();
    if (!audioContext) return;

    const now = audioContext.currentTime;
    const bufferSize = audioContext.sampleRate * 0.45;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      const decay = 1 - i / bufferSize;
      output[i] = (Math.random() * 2 - 1) * decay * decay;
    }

    const noise = audioContext.createBufferSource();
    const noiseGain = audioContext.createGain();
    const lowpass = audioContext.createBiquadFilter();

    noise.buffer = buffer;
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(900, now);
    lowpass.frequency.exponentialRampToValueAtTime(90, now + 0.45);
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    noise.connect(lowpass);
    lowpass.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    noise.start(now);

    playTone({ frequency: 90, slideTo: 36, duration: 0.45, type: "sawtooth", volume: 0.22 });
    window.setTimeout(() => {
      playTone({ frequency: 220, slideTo: 70, duration: 0.28, type: "square", volume: 0.12 });
    }, 65);
  }

  function startBgm() {
    if (!soundEnabled || !bgmSoundEnabled) return;

    const audioContext = getAudioContext();
    if (!audioContext || bgmNodesRef.current) return;

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.115, audioContext.currentTime);
    gain.connect(audioContext.destination);

    const melody = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23];
    let noteIndex = 0;

    const playBgmNote = () => {
      const currentContext = audioContextRef.current;
      const nodes = bgmNodesRef.current;

      if (!currentContext || !nodes) return;

      const now = currentContext.currentTime;
      const oscillator = currentContext.createOscillator();
      const noteGain = currentContext.createGain();
      const frequency = melody[noteIndex % melody.length];

      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, now);

      noteGain.gain.setValueAtTime(0.0001, now);
      noteGain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

      oscillator.connect(noteGain);
      noteGain.connect(nodes.gain);

      oscillator.start(now);
      oscillator.stop(now + 0.42);

      noteIndex += 1;
    };

    const intervalId = window.setInterval(playBgmNote, 480);

    bgmNodesRef.current = { gain, intervalId };

    playBgmNote();
  }

  function stopBgm() {
    const nodes = bgmNodesRef.current;
    if (!nodes) return;

    window.clearInterval(nodes.intervalId);

    const audioContext = audioContextRef.current;

    if (audioContext) {
      try {
        nodes.gain.gain.exponentialRampToValueAtTime(
          0.0001,
          audioContext.currentTime + 0.2
        );
      } catch {
        // 停止中なら何もしない
      }
    }

    window.setTimeout(() => {
      try {
        nodes.gain.disconnect();
      } catch {
        // すでに切断済みなら何もしない
      }
    }, 240);

    bgmNodesRef.current = null;
  }

  async function toggleBgm() {
    const audioContext = getAudioContext();

    if (audioContext?.state === "suspended") {
      await audioContext.resume();
    }

    if (bgmEnabled) {
      stopBgm();
      setBgmEnabled(false);
      return;
    }

    if (!soundEnabled || !bgmSoundEnabled) {
      setBgmEnabled(false);
      return;
    }

    setBgmEnabled(true);
    startBgm();
  }

  useEffect(() => {
    if (!gameStarted) {
      stopBgm();
      setBgmEnabled(false);
      return;
    }

    if (soundEnabled && bgmSoundEnabled) {
      startBgm();
      setBgmEnabled(true);
    } else {
      stopBgm();
      setBgmEnabled(false);
    }
  }, [soundEnabled, bgmSoundEnabled, gameStarted]);

  useEffect(() => {
    return () => {
      stopBgm();
    };
  }, []);

  function canPlayCards(cards: CardType[]): boolean {
    if (isPenaltyPending) return false;
    if (game.roundOver) return false;
    if (game.dobonPlayerIds.length > 0) return false;
    if (isOverlayOpen) return false;
    if (game.waitingForSuitSelect) return false;
    if (cards.length === 0) return false;

    const firstRank = cards[0].rank;
    const sameRank = cards.every((card) => card.rank === firstRank);

    if (!sameRank) return false;

    if (game.pendingDrawCount > 0) {
      return cards.every((card) => card.rank === 2);
    }

    if (yourHand.length === 1) return false;

    if (game.requestedSuits) {
      return cards.every(
        (card) =>
          game.requestedSuits!.includes(card.suit) ||
          card.rank === game.fieldCards[0].rank
      );
    }

    return cards.every(
      (card) =>
        card.rank === game.fieldCards[0].rank ||
        card.suit === game.fieldCards[0].suit
    );
  }

  function toggleCard(index: number) {
    if (isPenaltyPending) return;
    if (!isYourTurn) return;
    if (isOverlayOpen) return;
    if (game.waitingForSuitSelect) return;
    if (game.roundOver) return;
    if (isDobonReception) return;

    const card = yourHand[index];

    if (!canPlayCards([card])) return;

    if (!multiSelectMode) {
      playCards([index], index);
      return;
    }

    setSelectedCardIndexes((current) => {
      if (current.includes(index)) {
        const next = current.filter((item) => item !== index);

        if (topCardIndex === index) {
          setTopCardIndex(next.length >= 2 ? next[0] : null);
        }

        return next;
      }

      const next = [...current, index];
      const nextCards = next.map((cardIndex) => yourHand[cardIndex]);

      if (!canPlayCards(nextCards)) {
        return current;
      }

      if (next.length >= 2 && topCardIndex === null) {
        setTopCardIndex(next[0]);
      }

      return next;
    });
  }

  function nextTurnIndex(currentIndex: number, direction: Direction): number {
    return (currentIndex + direction + 4) % 4;
  }

  function playerPosition(index: number): PlayerPosition {
    if (index === 0) return "you";

    if (isMobile) {
      if (index === 1) return "left";
      if (index === 2) return "top";
      return "right";
    }

    if (index === 1) return "bottom";
    if (index === 2) return "left";
    return "top";
  }

  function getDobonPlayerIds(
    players: Player[],
    playedByIndex: number,
    fieldValue: number
  ): number[] {
    return players
      .filter((_, index) => index !== playedByIndex)
      .filter((player) => handTotal(player.hand) === fieldValue)
      .map((player) => player.id);
  }

  function applyDobonReception(nextGame: GameState): GameState {
    if (nextGame.dobonPlayerIds.length === 0) {
      return {
        ...nextGame,
        dobonTimeLeft: 0,
      };
    }

    return {
      ...nextGame,
      dobonTimeLeft: dobonLimitSeconds,
    };
  }

  function finishRound(
    currentGame: GameState,
    dobonPlayerIds: number[]
  ): GameState {
    const victimIndex =
      currentGame.lastPlayedByIndex ?? currentGame.currentTurnIndex;
    const victim = currentGame.players[victimIndex];
    const dobonCount = dobonPlayerIds.length;

    const roundScores = currentGame.players.map((player, index) => {
      if (dobonPlayerIds.includes(player.id)) return 0;

      const baseScore = handScore(player.hand);

      if (index === victimIndex) {
        return baseScore * (dobonCount >= 2 ? 4 : 2);
      }

      return baseScore;
    });

    const nextScores = currentGame.scores.map(
      (score, index) => score + roundScores[index]
    );

    const roundEntries: RoundScoreEntry[] = currentGame.players.map(
      (player, index) => ({
        round: currentGame.roundNumber,
        playerId: player.id,
        roundScore: roundScores[index],
        totalScore: nextScores[index],
        isDobonWinner: dobonPlayerIds.includes(player.id),
        isVictim: index === victimIndex,
      })
    );

    const dobonNames = currentGame.players
      .filter((player) => dobonPlayerIds.includes(player.id))
      .map((player) => player.name)
      .join("、");

    const isGameOver = currentGame.roundNumber >= maxRounds;

    return {
      ...currentGame,
      scores: nextScores,
      scoreHistory: [...currentGame.scoreHistory, ...roundEntries],
      roundOver: true,
      gameOver: isGameOver,
      dobonPlayerIds: [],
      dobonTimeLeft: 0,
      roundResultMessage: `${dobonNames} がドボン！ ${victim.name} がドボンされました。`,
      message: isGameOver
        ? "10ラウンドが終了しました。最終結果を確認してください。"
        : "ラウンド終了です。「次のラウンドへ」を押してください。",
    };
  }

  function startNextRound() {
    if (!game.roundOver) return;
    if (game.gameOver) return;

    const starterIndex = game.lastPlayedByIndex ?? 0;

    setSelectedCardIndexes([]);
    setTopCardIndex(null);
    setSelectedSuits([]);
    setMultiSelectMode(false);
    setShowScoreTable(false);
    setShowScoreRules(false);
    showDealMotion();

    setGame(
      createRoundState({
        roundNumber: game.roundNumber + 1,
        scores: game.scores,
        scoreHistory: game.scoreHistory,
        starterIndex,
        message: `${game.roundNumber + 1}ラウンド目です。${
          game.players[starterIndex].name
        } から開始します。`,
        cpuNames,
      })
    );
  }

  function backToTitle() {
    setGameStarted(false);
    setShowScoreTable(false);
    setShowScoreRules(false);
    setShowSettingsHelp(false);
    setFailedDobonPenaltyCount(0);
    setShowRules(false);
    setSelectedCardIndexes([]);
    setTopCardIndex(null);
    setSelectedSuits([]);
    setMultiSelectMode(false);
  }

  function restartGame() {
    const newCpuNames = createRandomCpuNames();

    setCpuNames(newCpuNames);
    setSelectedCardIndexes([]);
    setTopCardIndex(null);
    setSelectedSuits([]);
    setMultiSelectMode(false);
    setShowScoreTable(false);
    setShowScoreRules(false);
    setShowSettingsHelp(false);
    setFailedDobonPenaltyCount(0);
    setGameStarted(true);
    showDealMotion();

    setGame(
      createRoundState({
        roundNumber: 1,
        scores: [0, 0, 0, 0],
        scoreHistory: [],
        starterIndex: 0,
        message: "新しいゲームを開始しました。1ラウンド目です。あなたの番です。",
        cpuNames: newCpuNames,
      })
    );
  }

  function startGame() {
    const newCpuNames = createRandomCpuNames();

    setCpuNames(newCpuNames);
    setSelectedCardIndexes([]);
    setTopCardIndex(null);
    setSelectedSuits([]);
    setMultiSelectMode(false);
    setShowScoreTable(false);
    setShowScoreRules(false);
    setShowSettingsHelp(false);
    setFailedDobonPenaltyCount(0);
    setGameStarted(true);
    showDealMotion();

    setGame(
      createRoundState({
        roundNumber: 1,
        scores: [0, 0, 0, 0],
        scoreHistory: [],
        starterIndex: 0,
        message: "ゲーム開始！1ラウンド目です。あなたの番です。",
        cpuNames: newCpuNames,
      })
    );
  }

  function turnAfterCards(
    currentGame: GameState,
    playedCards: CardType[]
  ): {
    nextIndex: number;
    nextDirection: Direction;
    effectMessage: string;
  } {
    let nextDirection = currentGame.direction;
    let effectMessage = "";

    const rank = playedCards[0].rank;
    const count = playedCards.length;

    if (rank === 7 && count % 2 === 1) {
      nextDirection = currentGame.direction === 1 ? -1 : 1;
      effectMessage += "リバース！ ";
    }

    if (rank === 3) {
      let nextIndex = currentGame.currentTurnIndex;
      const skippedNames: string[] = [];

      // 3の効果は「今回一度に出した3の枚数分だけ」スキップ。
      // 前の人が3を出していても効果は累積しない。
      for (let i = 0; i < count; i++) {
        nextIndex = nextTurnIndex(nextIndex, nextDirection);
        skippedNames.push(currentGame.players[nextIndex].name);
      }

      const afterSkipIndex = nextTurnIndex(nextIndex, nextDirection);

      return {
        nextIndex: afterSkipIndex,
        nextDirection,
        effectMessage: `${effectMessage}${skippedNames.join(
          "、"
        )} はスキップされました。`,
      };
    }

    return {
      nextIndex: nextTurnIndex(currentGame.currentTurnIndex, nextDirection),
      nextDirection,
      effectMessage,
    };
  }

  function drawOneCard(currentGame: GameState) {
    if (currentGame.deck.length > 0) {
      return {
        card: currentGame.deck[0],
        deck: currentGame.deck.slice(1),
        discardPile: currentGame.discardPile,
        refilled: false,
      };
    }

    if (currentGame.discardPile.length > 0) {
      const newDeck = shuffleDeck(currentGame.discardPile);

      return {
        card: newDeck[0],
        deck: newDeck.slice(1),
        discardPile: [],
        refilled: true,
      };
    }

    return {
      card: null,
      deck: [],
      discardPile: [],
      refilled: false,
    };
  }

  function drawMultipleCards(currentGame: GameState, count: number) {
    let tempGame = currentGame;
    const drawnCards: CardType[] = [];
    let refilled = false;

    for (let i = 0; i < count; i++) {
      const result = drawOneCard(tempGame);

      if (!result.card) break;

      drawnCards.push(result.card);
      refilled = refilled || result.refilled;

      tempGame = {
        ...tempGame,
        deck: result.deck,
        discardPile: result.discardPile,
      };
    }

    return {
      cards: drawnCards,
      deck: tempGame.deck,
      discardPile: tempGame.discardPile,
      refilled,
    };
  }

  function playSelectedCards() {
    if (isPenaltyPending) return;
    if (!isYourTurn) return;
    if (isOverlayOpen) return;
    if (!canPlaySelectedCards) return;

    playCards(selectedCardIndexes, topCardIndex);
  }

  function orderPlayedCards(
    cardIndexes: number[],
    selectedTopIndex: number | null
  ) {
    const sortedIndexes = cardIndexes.slice().sort((a, b) => a - b);

    if (selectedTopIndex === null || !sortedIndexes.includes(selectedTopIndex)) {
      return sortedIndexes.map((index) => yourHand[index]);
    }

    const orderedIndexes = [
      selectedTopIndex,
      ...sortedIndexes.filter((index) => index !== selectedTopIndex),
    ];

    return orderedIndexes.map((index) => yourHand[index]);
  }

  function playCards(cardIndexes: number[], selectedTopIndex: number | null) {
    if (isPenaltyPending) return;
    if (!isYourTurn) return;
    if (isOverlayOpen) return;
    if (cardIndexes.length === 0) return;
    if (isDobonReception) return;

    const playedCards = orderPlayedCards(cardIndexes, selectedTopIndex);

    if (!canPlayCards(playedCards)) return;

    setActionAnimation({
      kind: "play",
      label: cardsLabel(playedCards),
      from: "you",
      to: "you",
      isRed: isRedSuit(playedCards[0].suit),
    });
    playCardSound();
    if ([2, 3, 7, 8].includes(playedCards[0].rank)) {
      playActionCardSound();
    }

    const playedRank = playedCards[0].rank;
    const playedValue = playedCards.reduce(
      (total, card) => total + cardDobonValue(card),
      0
    );

    const newPlayers = [...game.players];

    newPlayers[0] = {
      ...newPlayers[0],
      hand: yourHand.filter((_, index) => !cardIndexes.includes(index)),
    };

    const turnResult = turnAfterCards(game, playedCards);

    const nextPendingDrawCount =
      playedRank === 2 ? game.pendingDrawCount + playedCards.length * 2 : 0;

    const nextDobonPlayerIds = getDobonPlayerIds(newPlayers, 0, playedValue);
    const cpuDobonPlayerIds = nextDobonPlayerIds.filter((id) => id !== 1);

    setSelectedCardIndexes([]);
    setTopCardIndex(null);
    setMultiSelectMode(false);

    let nextGame: GameState;

    if (playedRank === 8) {
      setSelectedSuits([]);

      nextGame = {
        ...game,
        players: newPlayers,
        discardPile: [...game.discardPile, ...game.fieldCards],
        fieldCards: playedCards,
        fieldStack: [...playedCards, ...game.fieldStack],
        fieldValue: playedValue,
        direction: turnResult.nextDirection,
        pendingDrawCount: 0,
        requestedSuits: null,
        waitingForSuitSelect: true,
        dobonPlayerIds: nextDobonPlayerIds,
        dobonTimeLeft: 0,
        lastPlayedByIndex: 0,
        message: `${cardsLabel(
          playedCards
        )} を出しました。次に出せるスート条件を選んでください。`,
      };
    } else {
      nextGame = {
        ...game,
        players: newPlayers,
        discardPile: [...game.discardPile, ...game.fieldCards],
        fieldCards: playedCards,
        fieldStack: [...playedCards, ...game.fieldStack],
        fieldValue: playedValue,
        currentTurnIndex: turnResult.nextIndex,
        direction: turnResult.nextDirection,
        pendingDrawCount: nextPendingDrawCount,
        requestedSuits: null,
        waitingForSuitSelect: false,
        dobonPlayerIds: nextDobonPlayerIds,
        dobonTimeLeft: 0,
        lastPlayedByIndex: 0,
        message:
          playedRank === 2
            ? `${cardsLabel(
                playedCards
              )} を出しました。次の人は ${nextPendingDrawCount}枚ドローです。2を持っていれば重ねられます。`
            : `${cardsLabel(playedCards)} を出しました。${
                turnResult.effectMessage
              } 次は ${game.players[turnResult.nextIndex].name} の番です。`,
      };
    }

    if (cpuDobonPlayerIds.length > 0) {
      setGame(finishRound(nextGame, nextDobonPlayerIds));
      return;
    }

    setGame(applyDobonReception(nextGame));
  }

  function toggleSuit(suit: Suit) {
    setSelectedSuits((current) =>
      current.includes(suit)
        ? current.filter((item) => item !== suit)
        : [...current, suit]
    );
  }

  function confirmSuitSelect() {
    if (!game.waitingForSuitSelect) return;
    if (isOverlayOpen) return;
    if (!isYourTurn) return;
    if (selectedSuits.length === 0) return;
    if (isDobonReception) return;

    const nextIndex = nextTurnIndex(game.currentTurnIndex, game.direction);

    setGame({
      ...game,
      requestedSuits: selectedSuits,
      waitingForSuitSelect: false,
      currentTurnIndex: nextIndex,
      message: `${requestedSuitsLabel(selectedSuits)} を指定しました。次は ${
        game.players[nextIndex].name
      } の番です。`,
    });
  }

  function drawCard() {
    if (!isYourTurn && !isPenaltyPending) return;
    if (isOverlayOpen) return;
    if (game.waitingForSuitSelect) return;
    if (game.roundOver) return;
    if (isDobonReception && !isPenaltyPending) return;

    const drawCount = isPenaltyPending
      ? failedDobonPenaltyCount
      : game.pendingDrawCount > 0
      ? game.pendingDrawCount
      : 1;

    const result = drawMultipleCards(game, drawCount);

    setActionAnimation({
      kind: "draw",
      label: "",
      from: "you",
      to: "you",
      isRed: false,
    });
    playCardSound();

    if (result.cards.length === 0) {
      setGame({
        ...game,
        dobonPlayerIds: [],
        dobonTimeLeft: 0,
        message: isPenaltyPending
          ? "ペナルティですが、山札がありません。"
          : "山札も戻せる場札もありません。",
      });
      setFailedDobonPenaltyCount(0);
      return;
    }

    const newPlayers = [...game.players];

    newPlayers[0] = {
      ...newPlayers[0],
      hand: [...yourHand, ...result.cards],
    };

    const nextIndex = nextTurnIndex(game.currentTurnIndex, game.direction);

    setSelectedCardIndexes([]);
    setTopCardIndex(null);
    setMultiSelectMode(false);

    setGame({
      ...game,
      players: newPlayers,
      deck: result.deck,
      discardPile: result.discardPile,
      currentTurnIndex: isPenaltyPending ? game.currentTurnIndex : nextIndex,
      pendingDrawCount: isPenaltyPending ? game.pendingDrawCount : 0,
      requestedSuits: game.requestedSuits,
      dobonPlayerIds: isPenaltyPending ? game.dobonPlayerIds : [],
      dobonTimeLeft: isPenaltyPending ? game.dobonTimeLeft : 0,
      message: isPenaltyPending
        ? `ペナルティで${result.cards.length}枚引きました。ゲームを再開します。`
        : `${
            result.refilled ? "場札をシャッフルして山札を補充しました。" : ""
          }${
            game.pendingDrawCount > 0
              ? `${result.cards.length}枚引きました。このターンは出せません。`
              : `${cardLabel(result.cards[0])} を引きました。このターンは出せません。`
          } 次は ${game.players[nextIndex].name} の番です。`,
    });

    if (isPenaltyPending) {
      setFailedDobonPenaltyCount(0);
    }
  }

  function dobon() {
    if (isOverlayOpen) return;
    if (game.roundOver) return;

    if (!canDobon) {
      if (!expertMode) return;

      playDobonMissSound();
      setShowDobonMissEffect(true);
      setSelectedCardIndexes([]);
      setTopCardIndex(null);
      setMultiSelectMode(false);
      setFailedDobonPenaltyCount(2);

      setGame({
        ...game,
        message: "ドボン失敗！山札をクリックしてペナルティ2枚を引いてください。",
      });
      return;
    }

    setShowExplosion(true);
    playDobonExplosionSound();
    setGame(finishRound(game, [1]));
  }

  function cpuAction() {
    setGame((currentGame) => {
      if (currentGame.dobonPlayerIds.length > 0) return currentGame;

      const cpu = currentGame.players[currentGame.currentTurnIndex];

      const normalNextIndex = nextTurnIndex(
        currentGame.currentTurnIndex,
        currentGame.direction
      );
      const normalNextPlayer = currentGame.players[normalNextIndex];

      const cpuCanPlayCards = (cards: CardType[]) => {
        if (cards.length === 0) return false;

        const firstRank = cards[0].rank;
        const sameRank = cards.every((card) => card.rank === firstRank);

        if (!sameRank) return false;

        if (currentGame.pendingDrawCount > 0) {
          return cards.every((card) => card.rank === 2);
        }

        if (cpu.hand.length === 1) return false;

        if (currentGame.requestedSuits) {
          return cards.every(
            (card) =>
              currentGame.requestedSuits!.includes(card.suit) ||
              card.rank === currentGame.fieldCards[0].rank
          );
        }

        return cards.every(
          (card) =>
            card.rank === currentGame.fieldCards[0].rank ||
            card.suit === currentGame.fieldCards[0].suit
        );
      };

      if (cpu.hand.length === 1 && currentGame.pendingDrawCount === 0) {
        const result = drawOneCard(currentGame);

        setActionAnimation({
          kind: "draw",
          label: "",
          from: playerPosition(currentGame.currentTurnIndex),
          to: playerPosition(currentGame.currentTurnIndex),
          isRed: false,
        });
        playCardSound();

        if (!result.card) {
          return {
            ...currentGame,
            currentTurnIndex: normalNextIndex,
            dobonPlayerIds: [],
            dobonTimeLeft: 0,
            message: `${cpu.name} は最後の1枚ですが、山札がありません。次は ${normalNextPlayer.name} の番です。`,
          };
        }

        const newPlayers = [...currentGame.players];

        newPlayers[currentGame.currentTurnIndex] = {
          ...cpu,
          hand: [...cpu.hand, result.card],
        };

        return {
          ...currentGame,
          players: newPlayers,
          deck: result.deck,
          discardPile: result.discardPile,
          currentTurnIndex: normalNextIndex,
          dobonPlayerIds: [],
          dobonTimeLeft: 0,
          message: `${
            result.refilled ? "場札をシャッフルして山札を補充しました。" : ""
          }${cpu.name} は最後の1枚だったため山札から引きました。このターンは出せません。次は ${
            normalNextPlayer.name
          } の番です。`,
        };
      }

      const playableGroups = getPlayableGroups(cpu.hand, cpuCanPlayCards);
      const playedCards = playableGroups[0];

      if (playedCards) {
        setActionAnimation({
          kind: "play",
          label: cardsLabel(playedCards),
          from: playerPosition(currentGame.currentTurnIndex),
          to: playerPosition(currentGame.currentTurnIndex),
          isRed: isRedSuit(playedCards[0].suit),
        });
        playCardSound();
        if ([2, 3, 7, 8].includes(playedCards[0].rank)) {
          playActionCardSound();
        }

        const playedRank = playedCards[0].rank;
        const playedValue = playedCards.reduce(
          (total, card) => total + cardDobonValue(card),
          0
        );

        const usedIndexes: number[] = [];

        for (const playedCard of playedCards) {
          const index = cpu.hand.findIndex(
            (card, cardIndex) =>
              !usedIndexes.includes(cardIndex) &&
              card.suit === playedCard.suit &&
              card.rank === playedCard.rank
          );

          if (index >= 0) {
            usedIndexes.push(index);
          }
        }

        const newPlayers = [...currentGame.players];

        newPlayers[currentGame.currentTurnIndex] = {
          ...cpu,
          hand: cpu.hand.filter((_, index) => !usedIndexes.includes(index)),
        };

        const turnResult = turnAfterCards(currentGame, playedCards);

        const nextPendingDrawCount =
          playedRank === 2
            ? currentGame.pendingDrawCount + playedCards.length * 2
            : 0;

        const nextDobonPlayerIds = getDobonPlayerIds(
          newPlayers,
          currentGame.currentTurnIndex,
          playedValue
        );

        const cpuDobonPlayerIds = nextDobonPlayerIds.filter((id) => id !== 1);

        let nextGame: GameState;

        if (playedRank === 8) {
          const selectedCpuSuits = chooseBestSuits(
            newPlayers[currentGame.currentTurnIndex].hand
          );

          const nextIndex = nextTurnIndex(
            currentGame.currentTurnIndex,
            turnResult.nextDirection
          );

          nextGame = {
            ...currentGame,
            players: newPlayers,
            discardPile: [...currentGame.discardPile, ...currentGame.fieldCards],
            fieldCards: playedCards,
            fieldStack: [...playedCards, ...currentGame.fieldStack],
            fieldValue: playedValue,
            currentTurnIndex: nextIndex,
            direction: turnResult.nextDirection,
            pendingDrawCount: 0,
            requestedSuits: selectedCpuSuits,
            waitingForSuitSelect: false,
            dobonPlayerIds: nextDobonPlayerIds,
            dobonTimeLeft: 0,
            lastPlayedByIndex: currentGame.currentTurnIndex,
            message: `${cpu.name} が ${cardsLabel(
              playedCards
            )} を出しました。一番上は ${cardLabel(
              playedCards[0]
            )} です。${requestedSuitsLabel(selectedCpuSuits)} を指定しました。次は ${
              currentGame.players[nextIndex].name
            } の番です。`,
          };
        } else {
          nextGame = {
            ...currentGame,
            players: newPlayers,
            discardPile: [...currentGame.discardPile, ...currentGame.fieldCards],
            fieldCards: playedCards,
            fieldStack: [...playedCards, ...currentGame.fieldStack],
            fieldValue: playedValue,
            currentTurnIndex: turnResult.nextIndex,
            direction: turnResult.nextDirection,
            pendingDrawCount: nextPendingDrawCount,
            requestedSuits: null,
            waitingForSuitSelect: false,
            dobonPlayerIds: nextDobonPlayerIds,
            dobonTimeLeft: 0,
            lastPlayedByIndex: currentGame.currentTurnIndex,
            message:
              playedRank === 2
                ? `${cpu.name} が ${cardsLabel(
                    playedCards
                  )} を出しました。一番上は ${cardLabel(
                    playedCards[0]
                  )} です。次の人は ${nextPendingDrawCount}枚ドローです。`
                : `${cpu.name} が ${cardsLabel(
                    playedCards
                  )} を出しました。一番上は ${cardLabel(playedCards[0])} です。${
                    turnResult.effectMessage
                  } 次は ${
                    currentGame.players[turnResult.nextIndex].name
                  } の番です。`,
          };
        }

        if (cpuDobonPlayerIds.length > 0) {
          setShowExplosion(true);
          playDobonExplosionSound();
          return finishRound(nextGame, nextDobonPlayerIds);
        }

        return applyDobonReception(nextGame);
      }

      const drawCount =
        currentGame.pendingDrawCount > 0 ? currentGame.pendingDrawCount : 1;

      const result = drawMultipleCards(currentGame, drawCount);

      setActionAnimation({
        kind: "draw",
        label: "",
        from: playerPosition(currentGame.currentTurnIndex),
        to: playerPosition(currentGame.currentTurnIndex),
        isRed: false,
      });
      playCardSound();

      if (result.cards.length === 0) {
        return {
          ...currentGame,
          pendingDrawCount: 0,
          currentTurnIndex: normalNextIndex,
          dobonPlayerIds: [],
          dobonTimeLeft: 0,
          message: `${cpu.name} は何もできませんでした。次は ${normalNextPlayer.name} の番です。`,
        };
      }

      const newPlayers = [...currentGame.players];

      newPlayers[currentGame.currentTurnIndex] = {
        ...cpu,
        hand: [...cpu.hand, ...result.cards],
      };

      return {
        ...currentGame,
        players: newPlayers,
        deck: result.deck,
        discardPile: result.discardPile,
        pendingDrawCount: 0,
        requestedSuits: currentGame.requestedSuits,
        currentTurnIndex: normalNextIndex,
        dobonPlayerIds: [],
        dobonTimeLeft: 0,
        message: `${
          result.refilled ? "場札をシャッフルして山札を補充しました。" : ""
        }${
          currentGame.pendingDrawCount > 0
            ? `${cpu.name} は ${result.cards.length}枚引きました。このターンは出せません。`
            : `${cpu.name} はカードを1枚引きました。このターンは出せません。`
        } 次は ${normalNextPlayer.name} の番です。`,
      };
    });
  }

  if (!gameStarted) {
    return (
      <div style={titlePageStyle}>
        <div style={titleCardStyle}>
          <div style={titleBadgeStyle}>トランプゲーム</div>
          <DobonLogo large />
          <p style={titleLeadStyle}>ひらめき一発、逆転ドボン！</p>

          <button onClick={startGame} style={startGameButtonStyle}>
            ゲーム開始
          </button>

          <button
            onClick={() => setShowRules((current) => !current)}
            style={ruleToggleButtonStyle}
          >
            {showRules ? "ルールを閉じる" : "ルールを見る"}
          </button>

          {showRules && (
            <div style={ruleBoxStyle}>
              <div>・同じ数字または同じスートのカードを出せます。</div>
              <div>・手札合計が場の数字と一致したらドボンできます。</div>
              <div>・2はドロー、3はスキップ、7はリバース、8はスート指定です。</div>
              <div>・10ラウンド終了時、合計点が一番少ない人の勝ちです。</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={isMobile ? mobilePageStyle : pageStyle}>
      <AnimationStyles />
      {showDealAnimation && <DealAnimationOverlay />}
      {actionAnimation && <ActionAnimationOverlay animation={actionAnimation} />}
      {showExplosion && <DobonExplosion />}
      {showDobonMissEffect && (
        <DobonMissEffect onClose={() => setShowDobonMissEffect(false)} />
      )}
      <div style={isMobile ? mobileFixedButtonAreaStyle : fixedButtonAreaStyle}>
        <button
          onClick={() => {
            setShowScoreRules(false);
            setShowScoreTable(true);
          }}
          style={scoreToggleButtonStyle}
        >
          スコア
        </button>

        <button
          onClick={() => {
            setShowScoreTable(false);
            setShowScoreRules(true);
          }}
          style={scoreRuleToggleButtonStyle}
        >
          得点ルール
        </button>

        <button onClick={() => setShowSettingsHelp(true)} style={scoreRuleToggleButtonStyle}>
          設定・ヘルプ
        </button>

        <button
          onClick={() => setExpertMode((current) => !current)}
          style={modeToggleButtonStyle(expertMode)}
        >
          {expertMode ? "初心者モードに変更" : "上級者モードに変更"}
        </button>
      </div>

      <div style={isMobile ? mobileContainerStyle : containerStyle}>
        <div style={{ margin: "0" }}>
          <div style={gameHeaderStyle}>
            <DobonLogo />

            <button onClick={backToTitle} style={backToTitleButtonStyle}>
              最初から
            </button>
          </div>
        </div>

        <div style={scoreBoardStyle}>
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
            {game.roundNumber} / {maxRounds} ラウンド
          </div>

          <div
            style={{
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {game.players.map((player, index) => (
              <div key={player.id}>
                {player.name}: {game.scores[index]}点
              </div>
            ))}
          </div>
        </div>

        {showScoreTable && (
          <ScoreHistoryTable
            players={game.players}
            scoreHistory={game.scoreHistory}
            scores={game.scores}
            onClose={() => setShowScoreTable(false)}
          />
        )}

        {showScoreRules && (
          <ScoreRulesTable onClose={() => setShowScoreRules(false)} />
        )}

        {showSettingsHelp && (
          <SettingsHelpPanel
            onClose={() => setShowSettingsHelp(false)}
            soundEnabled={soundEnabled}
            setSoundEnabled={setSoundEnabled}
            bgmSoundEnabled={bgmSoundEnabled}
            setBgmSoundEnabled={setBgmSoundEnabled}
            cardSoundEnabled={cardSoundEnabled}
            setCardSoundEnabled={setCardSoundEnabled}
            actionSoundEnabled={actionSoundEnabled}
            setActionSoundEnabled={setActionSoundEnabled}
            dobonSoundEnabled={dobonSoundEnabled}
            setDobonSoundEnabled={setDobonSoundEnabled}
          />
        )}

        {isDobonReception && !expertMode && (
          <div style={dobonTimerBoxStyle}>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>
              ドボン受付中！
            </div>

            <div style={{ fontSize: "32px", fontWeight: "bold", color: "#facc15" }}>
              {game.dobonTimeLeft}
            </div>

            <div style={timerBarOuterStyle}>
              <div
                style={{
                  ...timerBarInnerStyle,
                  width: `${(game.dobonTimeLeft / dobonLimitSeconds) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        

        {game.pendingDrawCount > 0 && (
          <div style={statusRedStyle}>現在 {game.pendingDrawCount}枚ドロー状態</div>
        )}

        {game.roundOver && (
          <div style={roundResultStyle}>
            <div style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "6px" }}>
              {game.roundResultMessage}
            </div>

            <div style={{ marginBottom: "8px" }}>{game.message}</div>

            {game.gameOver ? (
              <>
                <div style={{ fontSize: "27px", fontWeight: "bold", color: "#facc15" }}>
                  優勝：{winnerNames(game.players, game.scores)}
                </div>

                <button onClick={restartGame} style={restartButtonStyle}>
                  もう一度遊ぶ
                </button>
              </>
            ) : (
              <button onClick={startNextRound} style={nextRoundButtonStyle}>
                次のラウンドへ
              </button>
            )}
          </div>
        )}

        {isMobile ? (
          <div style={mobileGameBoardStyle}>
            <div style={mobileTopCpuAreaStyle}>
              <TurnFrame active={!game.roundOver && visualCurrentPlayer.id === leftCpuPlayer.id}>
                <CpuHand
                  name={leftCpuPlayer.name}
                  hand={leftCpuPlayer.hand}
                  reveal={game.roundOver}
                />
              </TurnFrame>
            </div>

            <div style={mobileLeftCpuAreaStyle}>
              <TurnFrame active={!game.roundOver && visualCurrentPlayer.id === bottomCpuPlayer.id}>
                <CpuHand
                  name={bottomCpuPlayer.name}
                  hand={bottomCpuPlayer.hand}
                  reveal={game.roundOver}
                />
              </TurnFrame>
            </div>

            <div style={mobileCenterTableStyle}>
              <div style={{ textAlign: "center" }}>
                <p style={{ margin: "4px 0" }}>山札</p>

                <button
                  onClick={drawCard}
                  disabled={!shouldDraw}
                  style={{
                    background: "none",
                    border: shouldDraw ? "4px solid #facc15" : "none",
                    borderRadius: "14px",
                    padding: shouldDraw ? "4px" : 0,
                    cursor: shouldDraw ? "pointer" : "not-allowed",
                    opacity: shouldDraw ? 1 : 0.45,
                    boxShadow: shouldDraw ? "0 0 18px rgba(250,204,21,0.9)" : "none",
                  }}
                >
                  <CardBack large extraLarge />
                </button>

                <p style={{ margin: "4px 0" }}>{game.deck.length}枚</p>
              </div>

              <div>
                <p style={{ textAlign: "center", margin: "4px 0" }}>場札</p>
                <FieldStack cards={game.fieldStack.slice(0, 3)} />
                <p style={{ textAlign: "center", margin: "4px 0" }}>
                  場の数字：{game.fieldValue}
                </p>

                <div style={messageBoxStyle(shouldDraw || (isDobonReception && !expertMode) || isPenaltyPending)}>
                  {game.roundOver
                    ? game.message
                    : isPenaltyPending
                    ? "ドボン失敗のペナルティで2枚ドローしてください。"
                    : isDobonReception && !expertMode
                    ? `あと ${game.dobonTimeLeft} 秒、ドボンできます。`
                    : game.waitingForSuitSelect && isYourTurn
                    ? "8の効果です。条件を選んでから「スートを指定する」を押してください。"
                    : game.pendingDrawCount > 0 && isYourTurn
                    ? playerHasPlayableCard
                      ? `2を出して重ねるか、山札から${game.pendingDrawCount}枚引いてください。`
                      : `2がないので山札から${game.pendingDrawCount}枚引いてください。`
                    : game.requestedSuits && isYourTurn
                    ? `指定条件は ${requestedSuitsLabel(game.requestedSuits)} です。8は数字が同じなので出せます。`
                    : isLastCardState
                    ? "最後の1枚は出せません。山札から引いてください。"
                    : shouldDraw
                    ? "出せるカードがありません。山札から引いてください。"
                    : game.message}
                </div>
              </div>
            </div>

            <div style={mobileRightCpuAreaStyle}>
              <TurnFrame active={!game.roundOver && visualCurrentPlayer.id === topCpuPlayer.id}>
                <CpuHand
                  name={topCpuPlayer.name}
                  hand={topCpuPlayer.hand}
                  reveal={game.roundOver}
                />
              </TurnFrame>
            </div>

            <div style={mobilePlayerPanelStyle}>
              <div style={playerControlBoxStyle(isYourTurn && !game.roundOver)}>
                <DirectionIndicator direction={game.direction} />

                {game.requestedSuits && (
                  <div style={requestedSuitPlayerNoticeStyle}>
                    指定条件：{requestedSuitsLabel(game.requestedSuits)}
                  </div>
                )}

                {game.waitingForSuitSelect && isYourTurn && (
                  <div style={suitSelectAreaInHandStyle}>
                    <div style={{ marginBottom: "8px", fontWeight: "bold" }}>
                      出せるスート条件を選んでください
                    </div>

                    <SuitSelectPanel
                      selectedSuits={selectedSuits}
                      toggleSuit={toggleSuit}
                      setSelectedSuits={setSelectedSuits}
                    />

                    <button
                      onClick={confirmSuitSelect}
                      disabled={selectedSuits.length === 0}
                      style={{
                        marginTop: "10px",
                        padding: "8px 18px",
                        borderRadius: "999px",
                        border: "2px solid white",
                        backgroundColor:
                          selectedSuits.length > 0 ? "#facc15" : "#6b7280",
                        color: selectedSuits.length > 0 ? "#111827" : "#d1d5db",
                        fontWeight: "bold",
                        cursor: selectedSuits.length > 0 ? "pointer" : "not-allowed",
                      }}
                    >
                      スートを指定する
                    </button>
                  </div>
                )}

                <div style={beginnerBoxStyle}>
                  <div style={{ fontSize: "14px" }}>
                    {expertMode ? "上級者モード" : "初心者モード"}
                  </div>
                  {!expertMode && (
                    <div style={{ fontSize: "18px", marginTop: "2px" }}>
                      手札合計：{yourHandTotal}
                    </div>
                  )}
                  {expertMode && (
                    <div style={{ fontSize: "13px", marginTop: "2px", opacity: 0.85 }}>
                      手札合計は自分で計算！失敗ドボンは2枚ドロー
                    </div>
                  )}
                  <button
                    onClick={dobon}
                    disabled={(!expertMode && !canDobon) || isOverlayOpen || game.roundOver}
                    style={dobonButtonStyle((canDobon || expertMode) && !isOverlayOpen && !game.roundOver)}
                    aria-label="ドボン"
                  >
                    <img
                      src="/images/dobon_logo.png"
                      alt="ドボン"
                      style={dobonButtonLogoStyle((canDobon || expertMode) && !isOverlayOpen && !game.roundOver)}
                    />
                  </button>
                  <button
                    onClick={() => {
                      if (isOverlayOpen) return;
                      setMultiSelectMode((current) => !current);
                      setSelectedCardIndexes([]);
                      setTopCardIndex(null);
                    }}
                    disabled={game.roundOver || isDobonReception || isOverlayOpen}
                    style={{
                      marginTop: "8px",
                      padding: "6px 16px",
                      borderRadius: "999px",
                      border: "2px solid white",
                      backgroundColor: multiSelectMode ? "#22c55e" : "#374151",
                      color: "white",
                      fontWeight: "bold",
                      cursor: game.roundOver || isDobonReception || isOverlayOpen ? "not-allowed" : "pointer",
                      opacity: game.roundOver || isDobonReception || isOverlayOpen ? 0.45 : 1,
                    }}
                  >
                    {multiSelectMode ? "複数枚選択中" : "複数枚出しモード"}
                  </button>

                  {multiSelectMode && selectedCardIndexes.length >= 2 && (
                    <div style={topCardSelectBoxStyle}>
                      <div style={{ fontSize: "12px", marginBottom: "6px" }}>
                        上にするカードを選んでください
                      </div>
                      <div style={{ display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap" }}>
                        {selectedCardIndexes.map((index) => {
                          const card = yourHand[index];
                          const selected = topCardIndex === index;
                          return (
                            <button
                              key={index}
                              onClick={() => setTopCardIndex(index)}
                              style={{
                                padding: "6px 10px",
                                borderRadius: "999px",
                                border: selected ? "3px solid #facc15" : "2px solid white",
                                backgroundColor: selected ? "#facc15" : "white",
                                color: isRedSuit(card.suit) ? "#dc2626" : "black",
                                fontWeight: "bold",
                                cursor: "pointer",
                              }}
                            >
                              {cardLabel(card)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {multiSelectMode && (
                    <button
                      onClick={playSelectedCards}
                      disabled={!canPlaySelectedCards}
                      style={{
                        marginTop: "8px",
                        padding: "8px 20px",
                        borderRadius: "999px",
                        border: canPlaySelectedCards ? "3px solid white" : "2px solid #777",
                        backgroundColor: canPlaySelectedCards ? "#22c55e" : "#4b5563",
                        color: canPlaySelectedCards ? "white" : "#d1d5db",
                        fontSize: "18px",
                        fontWeight: "bold",
                        cursor: canPlaySelectedCards ? "pointer" : "not-allowed",
                      }}
                    >
                      選んだカードを出す
                    </button>
                  )}
                </div>

                <div style={handAreaStyle}>
                  {yourHand.map((card, index) => {
                    const playable = isYourTurn && canPlayCards([card]);
                    const selected = selectedCardIndexes.includes(index);
                    const center = (yourHand.length - 1) / 2;
                    const rotate = Math.max(-10, Math.min(10, (index - center) * 2.6));
                    const overlap =
                      yourHand.length >= 14
                        ? "-57px"
                        : yourHand.length >= 12
                        ? "-54px"
                        : yourHand.length >= 10
                        ? "-50px"
                        : yourHand.length >= 8
                        ? "-43px"
                        : yourHand.length >= 6
                        ? "-32px"
                        : "-20px";

                    return (
                      <button
                        key={`${card.suit}-${card.rank}-${index}`}
                        onClick={() => toggleCard(index)}
                        style={{
                          background: "none",
                          border: selected
                            ? topCardIndex === index
                              ? "4px solid #facc15"
                              : "4px solid #22c55e"
                            : playable
                            ? "3px solid #facc15"
                            : "3px solid transparent",
                          borderRadius: "14px",
                          padding: selected ? "2px" : "3px",
                          marginLeft: index === 0 ? 0 : overlap,
                          marginTop: `${Math.abs(index - center) * 2}px`,
                          cursor: playable ? "pointer" : "not-allowed",
                          opacity: playable ? 1 : 0.35,
                          transform: selected
                            ? "translateY(-14px) scale(1.04)"
                            : `rotate(${rotate}deg)`,
                          transformOrigin: "50% 110%",
                          transition: "transform 0.15s, margin 0.15s, box-shadow 0.15s",
                          zIndex: selected ? 30 : index,
                          boxShadow: selected
                            ? topCardIndex === index
                              ? "0 0 18px rgba(250,204,21,0.9)"
                              : "0 0 18px rgba(34,197,94,0.9)"
                            : playable
                            ? "0 0 14px rgba(250,204,21,0.8)"
                            : "none",
                        }}
                      >
                        <PlayingCard card={card} />
                      </button>
                    );
                  })}
                </div>
                <p style={{ marginTop: "10px", fontSize: "20px" }}>あなたの手札</p>
              </div>
            </div>
          </div>
        ) : (
          <div style={gameBoardStyle}>
            <div style={leftCpuAreaStyle}>
              <TurnFrame active={!game.roundOver && visualCurrentPlayer.id === leftCpuPlayer.id}>
                <CpuHand
                  name={leftCpuPlayer.name}
                  hand={leftCpuPlayer.hand}
                  reveal={game.roundOver}
                />
              </TurnFrame>
            </div>

            <div style={centerBoardAreaStyle}>
              <TurnFrame active={!game.roundOver && visualCurrentPlayer.id === topCpuPlayer.id}>
                <CpuHand
                  name={topCpuPlayer.name}
                  hand={topCpuPlayer.hand}
                  reveal={game.roundOver}
                />
              </TurnFrame>

              <div style={centerTableStyle}>
                <div style={{ textAlign: "center" }}>
                  <p style={{ margin: "4px 0" }}>山札</p>

                  <button
                    onClick={drawCard}
                    disabled={!shouldDraw}
                    style={{
                      background: "none",
                      border: shouldDraw ? "4px solid #facc15" : "none",
                      borderRadius: "14px",
                      padding: shouldDraw ? "4px" : 0,
                      cursor: shouldDraw ? "pointer" : "not-allowed",
                      opacity: shouldDraw ? 1 : 0.45,
                      boxShadow: shouldDraw ? "0 0 18px rgba(250,204,21,0.9)" : "none",
                    }}
                  >
                    <CardBack large extraLarge />
                  </button>

                  <p style={{ margin: "4px 0" }}>{game.deck.length}枚</p>
                </div>

                <div>
                  <p style={{ textAlign: "center", margin: "4px 0" }}>場札</p>
                  <FieldStack cards={game.fieldStack.slice(0, 3)} />
                  <p style={{ textAlign: "center", margin: "4px 0" }}>
                    場の数字：{game.fieldValue}
                  </p>

                  <div style={messageBoxStyle(shouldDraw || (isDobonReception && !expertMode) || isPenaltyPending)}>
                    {game.roundOver
                      ? game.message
                      : isPenaltyPending
                      ? "ドボン失敗のペナルティで2枚ドローしてください。"
                      : isDobonReception && !expertMode
                      ? `あと ${game.dobonTimeLeft} 秒、ドボンできます。`
                      : game.waitingForSuitSelect && isYourTurn
                      ? "8の効果です。条件を選んでから「スートを指定する」を押してください。"
                      : game.pendingDrawCount > 0 && isYourTurn
                      ? playerHasPlayableCard
                        ? `2を出して重ねるか、山札から${game.pendingDrawCount}枚引いてください。`
                        : `2がないので山札から${game.pendingDrawCount}枚引いてください。`
                      : game.requestedSuits && isYourTurn
                      ? `指定条件は ${requestedSuitsLabel(game.requestedSuits)} です。8は数字が同じなので出せます。`
                      : isLastCardState
                      ? "最後の1枚は出せません。山札から引いてください。"
                      : shouldDraw
                      ? "出せるカードがありません。山札から引いてください。"
                      : game.message}
                  </div>
                </div>
              </div>

              <TurnFrame active={!game.roundOver && visualCurrentPlayer.id === bottomCpuPlayer.id}>
                <CpuHand
                  name={bottomCpuPlayer.name}
                  hand={bottomCpuPlayer.hand}
                  reveal={game.roundOver}
                />
              </TurnFrame>
            </div>

            <div style={playerPanelStyle}>
              <div style={playerControlBoxStyle(isYourTurn && !game.roundOver)}>
                <DirectionIndicator direction={game.direction} />

                {game.requestedSuits && (
                  <div style={requestedSuitPlayerNoticeStyle}>
                    指定条件：{requestedSuitsLabel(game.requestedSuits)}
                  </div>
                )}

                {game.waitingForSuitSelect && isYourTurn && (
                  <div style={suitSelectAreaInHandStyle}>
                    <div style={{ marginBottom: "8px", fontWeight: "bold" }}>
                      出せるスート条件を選んでください
                    </div>

                    <SuitSelectPanel
                      selectedSuits={selectedSuits}
                      toggleSuit={toggleSuit}
                      setSelectedSuits={setSelectedSuits}
                    />

                    <button
                      onClick={confirmSuitSelect}
                      disabled={selectedSuits.length === 0}
                      style={{
                        marginTop: "10px",
                        padding: "8px 18px",
                        borderRadius: "999px",
                        border: "2px solid white",
                        backgroundColor:
                          selectedSuits.length > 0 ? "#facc15" : "#6b7280",
                        color: selectedSuits.length > 0 ? "#111827" : "#d1d5db",
                        fontWeight: "bold",
                        cursor: selectedSuits.length > 0 ? "pointer" : "not-allowed",
                      }}
                    >
                      スートを指定する
                    </button>
                  </div>
                )}

                <div style={beginnerBoxStyle}>
                  <div style={{ fontSize: "14px" }}>
                    {expertMode ? "上級者モード" : "初心者モード"}
                  </div>
                  {!expertMode && (
                    <div style={{ fontSize: "18px", marginTop: "2px" }}>
                      手札合計：{yourHandTotal}
                    </div>
                  )}
                  {expertMode && (
                    <div style={{ fontSize: "13px", marginTop: "2px", opacity: 0.85 }}>
                      手札合計は自分で計算！失敗ドボンは2枚ドロー
                    </div>
                  )}
                  <button
                    onClick={dobon}
                    disabled={(!expertMode && !canDobon) || isOverlayOpen || game.roundOver}
                    style={dobonButtonStyle((canDobon || expertMode) && !isOverlayOpen && !game.roundOver)}
                    aria-label="ドボン"
                  >
                    <img
                      src="/images/dobon_logo.png"
                      alt="ドボン"
                      style={dobonButtonLogoStyle((canDobon || expertMode) && !isOverlayOpen && !game.roundOver)}
                    />
                  </button>
                  <button
                    onClick={() => {
                      if (isOverlayOpen) return;
                      setMultiSelectMode((current) => !current);
                      setSelectedCardIndexes([]);
                      setTopCardIndex(null);
                    }}
                    disabled={game.roundOver || isDobonReception || isOverlayOpen}
                    style={{
                      marginTop: "8px",
                      padding: "6px 16px",
                      borderRadius: "999px",
                      border: "2px solid white",
                      backgroundColor: multiSelectMode ? "#22c55e" : "#374151",
                      color: "white",
                      fontWeight: "bold",
                      cursor: game.roundOver || isDobonReception || isOverlayOpen ? "not-allowed" : "pointer",
                      opacity: game.roundOver || isDobonReception || isOverlayOpen ? 0.45 : 1,
                    }}
                  >
                    {multiSelectMode ? "複数枚選択中" : "複数枚出しモード"}
                  </button>

                  {multiSelectMode && selectedCardIndexes.length >= 2 && (
                    <div style={topCardSelectBoxStyle}>
                      <div style={{ fontSize: "12px", marginBottom: "6px" }}>
                        上にするカードを選んでください
                      </div>
                      <div style={{ display: "flex", gap: "6px", justifyContent: "center", flexWrap: "wrap" }}>
                        {selectedCardIndexes.map((index) => {
                          const card = yourHand[index];
                          const selected = topCardIndex === index;
                          return (
                            <button
                              key={index}
                              onClick={() => setTopCardIndex(index)}
                              style={{
                                padding: "6px 10px",
                                borderRadius: "999px",
                                border: selected ? "3px solid #facc15" : "2px solid white",
                                backgroundColor: selected ? "#facc15" : "white",
                                color: isRedSuit(card.suit) ? "#dc2626" : "black",
                                fontWeight: "bold",
                                cursor: "pointer",
                              }}
                            >
                              {cardLabel(card)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {multiSelectMode && (
                    <button
                      onClick={playSelectedCards}
                      disabled={!canPlaySelectedCards}
                      style={{
                        marginTop: "8px",
                        padding: "8px 20px",
                        borderRadius: "999px",
                        border: canPlaySelectedCards ? "3px solid white" : "2px solid #777",
                        backgroundColor: canPlaySelectedCards ? "#22c55e" : "#4b5563",
                        color: canPlaySelectedCards ? "white" : "#d1d5db",
                        fontSize: "18px",
                        fontWeight: "bold",
                        cursor: canPlaySelectedCards ? "pointer" : "not-allowed",
                      }}
                    >
                      選んだカードを出す
                    </button>
                  )}
                </div>

                <div style={handAreaStyle}>
                  {yourHand.map((card, index) => {
                    const playable = isYourTurn && canPlayCards([card]);
                    const selected = selectedCardIndexes.includes(index);
                    const center = (yourHand.length - 1) / 2;
                    const rotate = Math.max(-10, Math.min(10, (index - center) * 2.6));
                    const overlap =
                      yourHand.length >= 14
                        ? "-57px"
                        : yourHand.length >= 12
                        ? "-54px"
                        : yourHand.length >= 10
                        ? "-50px"
                        : yourHand.length >= 8
                        ? "-43px"
                        : yourHand.length >= 6
                        ? "-32px"
                        : "-20px";

                    return (
                      <button
                        key={`${card.suit}-${card.rank}-${index}`}
                        onClick={() => toggleCard(index)}
                        style={{
                          background: "none",
                          border: selected
                            ? topCardIndex === index
                              ? "4px solid #facc15"
                              : "4px solid #22c55e"
                            : playable
                            ? "3px solid #facc15"
                            : "3px solid transparent",
                          borderRadius: "14px",
                          padding: selected ? "2px" : "3px",
                          marginLeft: index === 0 ? 0 : overlap,
                          marginTop: `${Math.abs(index - center) * 2}px`,
                          cursor: playable ? "pointer" : "not-allowed",
                          opacity: playable ? 1 : 0.35,
                          transform: selected
                            ? "translateY(-14px) scale(1.04)"
                            : `rotate(${rotate}deg)`,
                          transformOrigin: "50% 110%",
                          transition: "transform 0.15s, margin 0.15s, box-shadow 0.15s",
                          zIndex: selected ? 30 : index,
                          boxShadow: selected
                            ? topCardIndex === index
                              ? "0 0 18px rgba(250,204,21,0.9)"
                              : "0 0 18px rgba(34,197,94,0.9)"
                            : playable
                            ? "0 0 14px rgba(250,204,21,0.8)"
                            : "none",
                        }}
                      >
                        <PlayingCard card={card} />
                      </button>
                    );
                  })}
                </div>
                <p style={{ marginTop: "10px", fontSize: "20px" }}>あなたの手札</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnimationStyles() {
  return (
    <style>{`
      @keyframes dealToLeft {
        0% { transform: translate(0, 0) scale(0.8) rotate(0deg); opacity: 0; }
        15% { opacity: 1; }
        100% { transform: translate(-265px, -18px) scale(0.55) rotate(-12deg); opacity: 0; }
      }
      @keyframes dealToTop {
        0% { transform: translate(0, 0) scale(0.8) rotate(0deg); opacity: 0; }
        15% { opacity: 1; }
        100% { transform: translate(-20px, -190px) scale(0.55) rotate(7deg); opacity: 0; }
      }
      @keyframes dealToYou {
        0% { transform: translate(0, 0) scale(0.8) rotate(0deg); opacity: 0; }
        15% { opacity: 1; }
        100% { transform: translate(285px, 130px) scale(0.65) rotate(10deg); opacity: 0; }
      }
      @keyframes dealToBottom {
        0% { transform: translate(0, 0) scale(0.8) rotate(0deg); opacity: 0; }
        15% { opacity: 1; }
        100% { transform: translate(0, 195px) scale(0.55) rotate(-5deg); opacity: 0; }
      }
      @keyframes dealToField {
        0% { transform: translate(0, 0) scale(0.9); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(105px, 0) scale(0.8); opacity: 0; }
      }
      @keyframes flyPlayYou {
        0% { transform: translate(265px, 145px) scale(0.88) rotate(10deg); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 0; }
      }
      @keyframes flyPlayLeft {
        0% { transform: translate(-245px, -10px) scale(0.78) rotate(-12deg); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 0; }
      }
      @keyframes flyPlayTop {
        0% { transform: translate(-20px, -180px) scale(0.78) rotate(7deg); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 0; }
      }
      @keyframes flyPlayRight {
        0% { transform: translate(245px, -10px) scale(0.78) rotate(12deg); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 0; }
      }
      @keyframes flyPlayBottom {
        0% { transform: translate(0, 190px) scale(0.78) rotate(-6deg); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 0; }
      }
      @keyframes flyDrawYou {
        0% { transform: translate(-75px, 0) scale(0.9); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(245px, 140px) scale(0.75) rotate(12deg); opacity: 0; }
      }
      @keyframes flyDrawLeft {
        0% { transform: translate(-75px, 0) scale(0.9); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(-260px, -15px) scale(0.62) rotate(-12deg); opacity: 0; }
      }
      @keyframes flyDrawTop {
        0% { transform: translate(-75px, 0) scale(0.9); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(-25px, -190px) scale(0.62) rotate(7deg); opacity: 0; }
      }
      @keyframes flyDrawRight {
        0% { transform: translate(-75px, 0) scale(0.9); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(260px, -15px) scale(0.62) rotate(12deg); opacity: 0; }
      }
      @keyframes flyDrawBottom {
        0% { transform: translate(-75px, 0) scale(0.9); opacity: 0; }
        20% { opacity: 1; }
        100% { transform: translate(0, 195px) scale(0.62) rotate(-6deg); opacity: 0; }
      }
      @keyframes dobonExplosion {
        0% { transform: scale(0.2); opacity: 0; filter: blur(0px); }
        18% { opacity: 1; }
        70% { transform: scale(2.9); opacity: 0.95; filter: blur(1px); }
        100% { transform: scale(4.2); opacity: 0; filter: blur(8px); }
      }
      @keyframes dobonShake {
        0%, 100% { transform: translate(0, 0); }
        20% { transform: translate(-10px, 6px); }
        40% { transform: translate(9px, -7px); }
        60% { transform: translate(-7px, -5px); }
        80% { transform: translate(8px, 5px); }
      }
      @keyframes dobonTextPop {
        0% { transform: scale(0.4) rotate(-8deg); opacity: 0; }
        25% { transform: scale(1.25) rotate(4deg); opacity: 1; }
        80% { transform: scale(1) rotate(0deg); opacity: 1; }
        100% { transform: scale(1.8); opacity: 0; }
      }
      @keyframes missPop {
        0% { transform: scale(0.5) rotate(-8deg); opacity: 0; }
        18% { transform: scale(1.12) rotate(3deg); opacity: 1; }
        75% { transform: scale(1) rotate(0deg); opacity: 1; }
        100% { transform: scale(0.92); opacity: 0; }
      }
      @keyframes missStay {
        0% { transform: scale(0.5) rotate(-8deg); opacity: 0; }
        70% { transform: scale(1.08) rotate(2deg); opacity: 1; }
        100% { transform: scale(1) rotate(0deg); opacity: 1; }
      }
      @keyframes missShake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-12px); }
        40% { transform: translateX(12px); }
        60% { transform: translateX(-8px); }
        80% { transform: translateX(8px); }
      }
    `}</style>
  );
}

function DealAnimationOverlay() {
  const targets = ["dealToLeft", "dealToTop", "dealToYou", "dealToBottom"];
  const dealCards = Array.from({ length: 20 });

  return (
    <div style={animationOverlayStyle}>
      <div style={dealDeckStyle}>
        <CardBack large />
      </div>

      {dealCards.map((_, index) => {
        const target = targets[index % targets.length];
        const delay = index * 0.06;

        return (
          <div
            key={index}
            style={{
              ...flyingCardBaseStyle,
              animation: `${target} 0.95s ease-in-out ${delay}s both`,
            }}
          >
            <CardBack large />
          </div>
        );
      })}

      <div
        style={{
          ...flyingCardBaseStyle,
          animation: `dealToField 0.9s ease-in-out 1.45s both`,
        }}
      >
        <CardBack large />
      </div>
    </div>
  );
}

function ActionAnimationOverlay({ animation }: { animation: ActionAnimation }) {
  const playNames: Record<PlayerPosition, string> = {
    you: "flyPlayYou",
    left: "flyPlayLeft",
    top: "flyPlayTop",
    right: "flyPlayRight",
    bottom: "flyPlayBottom",
  };

  const drawNames: Record<PlayerPosition, string> = {
    you: "flyDrawYou",
    left: "flyDrawLeft",
    top: "flyDrawTop",
    right: "flyDrawRight",
    bottom: "flyDrawBottom",
  };

  const animationName =
    animation.kind === "draw" ? drawNames[animation.to] : playNames[animation.from];

  return (
    <div style={animationOverlayStyle}>
      <div
        style={{
          ...actionFlyingCardStyle,
          animation: `${animationName} 0.72s ease-in-out both`,
        }}
      >
        {animation.kind === "draw" ? (
          <CardBack large />
        ) : (
          <div
            style={{
              ...actionCardFaceStyle,
              color: animation.isRed ? "#dc2626" : "#111827",
            }}
          >
            {animation.label}
          </div>
        )}
      </div>
    </div>
  );
}

function DobonExplosion() {
  return (
    <div style={explosionScreenStyle}>
      <div style={explosionShakeStyle}>
        <div style={explosionFlashStyle} />
        <div style={explosionCircleStyle} />
        <div style={explosionCircleSecondStyle} />
        <div style={explosionRingStyle} />
        <div style={explosionParticleStyle(0)} />
        <div style={explosionParticleStyle(1)} />
        <div style={explosionParticleStyle(2)} />
        <div style={explosionParticleStyle(3)} />
        <div style={explosionLogoWrapStyle}>
          <DobonLogo large />
        </div>
      </div>
    </div>
  );
}

function DobonMissEffect({ onClose }: { onClose: () => void }) {
  return (
    <div style={dobonMissScreenStyle}>
      <div style={dobonMissBoxStyle}>
        <button onClick={onClose} style={dobonMissCloseButtonStyle}>×</button>
        <div style={dobonMissMarkStyle}>×</div>
        <div style={dobonMissTitleStyle}>ドボン失敗！</div>
        <div style={dobonMissTextStyle}>ペナルティで2枚ドローしてください</div>
      </div>
    </div>
  );
}

function DobonLogo({ large = false }: { large?: boolean }) {
  return (
    <img
      src="/images/dobon_logo.png"
      alt="DOBON!"
      style={{
        width: large ? "320px" : "132px",
        maxWidth: "90vw",
        height: "auto",
        display: "block",
        margin: large ? "0 auto 18px" : "2px auto 4px",
      }}
    />
  );
}

function DirectionIndicator({ direction }: { direction: Direction }) {
  return (
    <div
      style={{
        ...directionIndicatorStyle,
        borderColor: direction === 1 ? "#22c55e" : "#38bdf8",
        boxShadow:
          direction === 1
            ? "0 0 14px rgba(34,197,94,0.75)"
            : "0 0 14px rgba(56,189,248,0.75)",
      }}
    >
      <div
        style={{
          fontSize: "38px",
          lineHeight: 1,
          transform: direction === 1 ? "none" : "scaleX(-1)",
        }}
      >
        ↻
      </div>
      <div style={{ fontSize: "12px", fontWeight: "bold" }}>
        {direction === 1 ? "時計回り" : "反時計回り"}
      </div>
    </div>
  );
}

function SuitSelectPanel({
  selectedSuits,
  toggleSuit,
  setSelectedSuits,
}: {
  selectedSuits: Suit[];
  toggleSuit: (suit: Suit) => void;
  setSelectedSuits: (suits: Suit[]) => void;
}) {
  return (
    <div style={suitSelectPanelStyle}>
      <div style={suitSelectRowStyle}>
        {allSuits.map((suit) => (
          <button
            key={suit}
            onClick={() => toggleSuit(suit)}
            style={suitSelectButtonStyle(
              selectedSuits.includes(suit),
              isRedSuit(suit)
            )}
          >
            {suitLabel(suit)}
          </button>
        ))}
      </div>

      <div style={suitSelectRowStyle}>
        <button
          onClick={() => setSelectedSuits(["spade", "club"])}
          style={wideSuitButtonStyle(
            selectedSuits.length === 2 &&
              selectedSuits.includes("spade") &&
              selectedSuits.includes("club")
          )}
        >
          Black
        </button>

        <button
          onClick={() => setSelectedSuits(["heart", "diamond"])}
          style={wideSuitButtonStyle(
            selectedSuits.length === 2 &&
              selectedSuits.includes("heart") &&
              selectedSuits.includes("diamond"),
            true
          )}
        >
          Red
        </button>

        <button
          onClick={() => setSelectedSuits(allSuits)}
          style={wideSuitButtonStyle(selectedSuits.length === 4)}
        >
          All
        </button>
      </div>
    </div>
  );
}

function FieldStack({ cards }: { cards: CardType[] }) {
  return (
    <div style={fieldStackWrapStyle}>
      {cards.map((card, index) => (
        <div
          key={`${card.suit}-${card.rank}-${index}`}
          style={{
            position: "absolute",
            top: index * 7,
            left: index * 32,
            zIndex: cards.length - index,
          }}
        >
          {index === 0 ? (
            <div style={topFieldCardHighlightStyle}>
              <PlayingCard card={card} />
            </div>
          ) : (
            <SidePeekCard card={card} />
          )}
        </div>
      ))}
    </div>
  );
}

function SidePeekCard({ card }: { card: CardType }) {
  return (
    <div
      style={{
        width: "70px",
        height: "100px",
        backgroundColor: "white",
        color: isRedSuit(card.suit) ? "#dc2626" : "black",
        borderRadius: "9px",
        border: "1px solid #ddd",
        boxShadow: "0 4px 10px rgba(0,0,0,0.25)",
        boxSizing: "border-box",
        padding: "6px",
        overflow: "hidden",
      }}
    >
      <div style={{ marginLeft: "39px", fontSize: "18px", fontWeight: "bold" }}>
        {rankLabel(card.rank)}
      </div>
      <div style={{ marginLeft: "39px", fontSize: "21px", fontWeight: "bold" }}>
        {suitLabel(card.suit)}
      </div>
    </div>
  );
}

function ScoreHistoryTable({
  players,
  scoreHistory,
  scores,
  onClose,
}: {
  players: Player[];
  scoreHistory: RoundScoreEntry[];
  scores: number[];
  onClose: () => void;
}) {
  return (
    <div style={scoreTableWrapStyle}>
      <button onClick={onClose} style={modalCloseButtonStyle}>×</button>
      <div style={{ fontWeight: "bold", marginBottom: "8px", color: "#facc15" }}>
        スコア表
      </div>

      <div style={{ overflowX: "auto", width: "100%" }}>
        <table style={scoreTableStyle}>
          <thead>
            <tr>
              <th style={scoreHeaderCellStyle}>プレイヤー</th>

              {Array.from({ length: maxRounds }).map((_, index) => (
                <th key={index} style={scoreHeaderCellStyle}>
                  {index + 1}
                </th>
              ))}

              <th style={scoreTotalHeaderCellStyle}>合計</th>
            </tr>
          </thead>

          <tbody>
            {players.map((player, playerIndex) => (
              <tr key={player.id}>
                <th style={scorePlayerCellStyle}>{player.name}</th>

                {Array.from({ length: maxRounds }).map((_, index) => {
                  const round = index + 1;
                  const entry = scoreHistory.find(
                    (item) => item.playerId === player.id && item.round === round
                  );

                  return (
                    <td key={round} style={scoreBodyCellStyle}>
                      {entry ? (
                        <div style={scoreCellInnerStyle}>
                          <div
                            style={{
                              fontSize: entry.isDobonWinner ? "26px" : "22px",
                              fontWeight: "bold",
                              color: entry.isDobonWinner
                                ? "#facc15"
                                : entry.isVictim
                                ? "#f87171"
                                : "white",
                              lineHeight: 1,
                            }}
                          >
                            {entry.isDobonWinner ? "★" : entry.roundScore}
                          </div>

                          <div
                            style={{
                              fontSize: "11px",
                              color: "#d1d5db",
                              alignSelf: "flex-end",
                              lineHeight: 1,
                            }}
                          >
                            / {entry.totalScore}
                          </div>
                        </div>
                      ) : (
                        <span style={{ opacity: 0.35 }}>-</span>
                      )}
                    </td>
                  );
                })}

                <td style={scoreTotalCellStyle}>{scores[playerIndex]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: "12px", opacity: 0.85, marginTop: "6px" }}>
        ★ = ドボン成功、赤字 = ドボンされた人の加算点
      </div>
    </div>
  );
}

function ScoreRulesTable({ onClose }: { onClose: () => void }) {
  return (
    <div style={scoreRulesWrapStyle}>
      <button onClick={onClose} style={modalCloseButtonStyle}>×</button>
      <div style={{ fontWeight: "bold", color: "#facc15", marginBottom: "8px" }}>
        得点ルール
      </div>

      <table style={scoreRulesTableStyle}>
        <tbody>
          <tr>
            <th style={scoreRulesHeaderStyle}>カード</th>
            <th style={scoreRulesHeaderStyle}>ドボン判定</th>
            <th style={scoreRulesHeaderStyle}>スコア計算</th>
          </tr>
          <tr>
            <td style={scoreRulesCellStyle}>A</td>
            <td style={scoreRulesCellStyle}>1</td>
            <td style={scoreRulesCellStyle}>1点</td>
          </tr>
          <tr>
            <td style={scoreRulesCellStyle}>2</td>
            <td style={scoreRulesCellStyle}>2</td>
            <td style={scoreRulesCellStyle}>20点</td>
          </tr>
          <tr>
            <td style={scoreRulesCellStyle}>3〜7 / 9 / 10</td>
            <td style={scoreRulesCellStyle}>数字通り</td>
            <td style={scoreRulesCellStyle}>数字通り</td>
          </tr>
          <tr>
            <td style={scoreRulesCellStyle}>8</td>
            <td style={scoreRulesCellStyle}>8</td>
            <td style={scoreRulesCellStyle}>20点</td>
          </tr>
          <tr>
            <td style={scoreRulesCellStyle}>J / Q / K</td>
            <td style={scoreRulesCellStyle}>11 / 12 / 13</td>
            <td style={scoreRulesCellStyle}>各10点</td>
          </tr>
          <tr>
            <td style={scoreRulesCellStyle}>ドボン成功</td>
            <td style={scoreRulesCellStyle}>手札合計一致</td>
            <td style={scoreRulesCellStyle}>0点</td>
          </tr>
          <tr>
            <td style={scoreRulesCellStyle}>ドボンされた人</td>
            <td style={scoreRulesCellStyle}>出した人</td>
            <td style={scoreRulesCellStyle}>手札点 ×2</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SettingsHelpPanel({
  onClose,
  soundEnabled,
  setSoundEnabled,
  bgmSoundEnabled,
  setBgmSoundEnabled,
  cardSoundEnabled,
  setCardSoundEnabled,
  actionSoundEnabled,
  setActionSoundEnabled,
  dobonSoundEnabled,
  setDobonSoundEnabled,
}: {
  onClose: () => void;
  soundEnabled: boolean;
  setSoundEnabled: (value: boolean) => void;
  bgmSoundEnabled: boolean;
  setBgmSoundEnabled: (value: boolean) => void;
  cardSoundEnabled: boolean;
  setCardSoundEnabled: (value: boolean) => void;
  actionSoundEnabled: boolean;
  setActionSoundEnabled: (value: boolean) => void;
  dobonSoundEnabled: boolean;
  setDobonSoundEnabled: (value: boolean) => void;
}) {
  return (
    <div style={settingsHelpWrapStyle}>
      <button onClick={onClose} style={modalCloseButtonStyle}>×</button>
      <div style={{ fontWeight: "bold", color: "#facc15", marginBottom: "12px", fontSize: "22px" }}>
        設定・ヘルプ
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>サウンド設定</div>
        <label style={settingsRowStyle}>
          <input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} />
          音全般
        </label>
        <label style={settingsRowStyle}>
          <input type="checkbox" checked={bgmSoundEnabled} onChange={(e) => setBgmSoundEnabled(e.target.checked)} />
          BGM
        </label>
        <label style={settingsRowStyle}>
          <input type="checkbox" checked={cardSoundEnabled} onChange={(e) => setCardSoundEnabled(e.target.checked)} />
          トランプの音
        </label>
        <label style={settingsRowStyle}>
          <input type="checkbox" checked={actionSoundEnabled} onChange={(e) => setActionSoundEnabled(e.target.checked)} />
          役カードの音
        </label>
        <label style={settingsRowStyle}>
          <input type="checkbox" checked={dobonSoundEnabled} onChange={(e) => setDobonSoundEnabled(e.target.checked)} />
          ドボンの音
        </label>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>ゲーム開始</div>
        <div>・4人で遊びます。あなた以外はCPUです。</div>
        <div>・各プレイヤーに最初に5枚ずつ配られます。</div>
        <div>・山札から1枚が場札になります。</div>
        <div>・最初の場札には2 / 3 / 7 / 8 / J / Q / Kを使わないようにしています。</div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>カードの出し方</div>
        <div>・場札と同じ数字、または同じスートのカードを出せます。</div>
        <div>・同じ数字なら複数枚まとめて出せます。</div>
        <div>・複数枚出す時は、どのカードを一番上にするか選べます。</div>
        <div>・山札から引いたカードは、そのターンには出せません。</div>
        <div>・最後の1枚は出せません。山札から引く必要があります。</div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>役カード</div>
        <div>・2：次の人が2枚ドロー。2を重ねるとドロー枚数が増えます。</div>
        <div>・3：出した枚数分だけ次の人をスキップします。</div>
        <div>・7：進行方向が逆になります。偶数枚なら元の向きのままです。</div>
        <div>・8：次に出せるスート条件を指定できます。</div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>ドボンと得点</div>
        <div>・場の数字と自分の手札合計が一致したらドボンできます。</div>
        <div>・ドボン成功者は0点です。</div>
        <div>・ドボンされた人は手札点が2倍です。</div>
        <div>・J / Q / Kはドボン判定では11 / 12 / 13、得点計算では各10点です。</div>
        <div>・2と8は得点計算では20点です。</div>
        <div>・上級者モードでドボンに失敗すると、山札から2枚引くペナルティです。</div>
      </div>
    </div>
  );
}

function createRoundState({
  roundNumber,
  scores,
  scoreHistory,
  starterIndex,
  message,
  cpuNames,
}: {
  roundNumber: number;
  scores: number[];
  scoreHistory: RoundScoreEntry[];
  starterIndex: number;
  message: string;
  cpuNames: string[];
}): GameState {
  const initialDeck = shuffleDeck(createDeck());

  const players = [
    { id: 1, name: "あなた", hand: initialDeck.slice(0, 5) },
    // 内部の進行順は「あなた → 下 → 左 → 上」。
    // そのため、左 → 上 → あなた → 下 の順番でターンが回ります。
    { id: 2, name: cpuNames[0] ?? "ハル（CPU）", hand: initialDeck.slice(5, 10) },
    { id: 3, name: cpuNames[1] ?? "ミナト（CPU）", hand: initialDeck.slice(10, 15) },
    { id: 4, name: cpuNames[2] ?? "ソラ（CPU）", hand: initialDeck.slice(15, 20) },
  ];

  const restCards = initialDeck.slice(20);
  const fieldIndex = restCards.findIndex((card) => !isActionCard(card.rank));
  const safeFieldIndex = fieldIndex >= 0 ? fieldIndex : 0;
  const firstFieldCard = restCards[safeFieldIndex];

  const deck = restCards.filter((_, index) => index !== safeFieldIndex);

  return {
    players,
    fieldCards: [firstFieldCard],
    fieldStack: [firstFieldCard],
    fieldValue: cardDobonValue(firstFieldCard),
    discardPile: [],
    deck,
    currentTurnIndex: starterIndex,
    direction: 1,
    pendingDrawCount: 0,
    requestedSuits: null,
    waitingForSuitSelect: false,
    dobonPlayerIds: [],
    dobonTimeLeft: 0,
    message,
    roundNumber,
    scores,
    scoreHistory,
    roundOver: false,
    gameOver: false,
    roundResultMessage: "",
    lastPlayedByIndex: null,
  };
}

function getPlayableGroups(
  hand: CardType[],
  canPlayCards: (cards: CardType[]) => boolean
): CardType[][] {
  const groups: CardType[][] = [];

  for (const card of hand) {
    const sameRankCards = hand.filter((item) => item.rank === card.rank);

    if (
      sameRankCards.length > 1 &&
      canPlayCards(sameRankCards) &&
      !groups.some((group) => group[0].rank === card.rank)
    ) {
      groups.push(sameRankCards);
    }
  }

  for (const card of hand) {
    if (canPlayCards([card]) && !groups.some((group) => group.includes(card))) {
      groups.push([card]);
    }
  }

  return groups;
}

function TurnFrame({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        border: active ? "3px solid #facc15" : "3px solid transparent",
        borderRadius: "16px",
        padding: "6px",
      }}
    >
      {children}
    </div>
  );
}

function handTotal(hand: CardType[]): number {
  return hand.reduce((total, card) => total + cardDobonValue(card), 0);
}

function handScore(hand: CardType[]): number {
  return hand.reduce((total, card) => total + cardScoreValue(card), 0);
}

function cardDobonValue(card: CardType): number {
  return card.rank;
}

function cardScoreValue(card: CardType): number {
  if (card.rank === 2) return 20;
  if (card.rank === 8) return 20;
  if (card.rank === 11) return 10;
  if (card.rank === 12) return 10;
  if (card.rank === 13) return 10;

  return card.rank;
}

function isActionCard(rank: number): boolean {
  return [2, 3, 7, 8, 11, 12, 13].includes(rank);
}

function chooseBestSuits(hand: CardType[]): Suit[] {
  const suitsWithCount = allSuits.map((suit) => ({
    suit,
    count: hand.filter((card) => card.suit === suit).length,
  }));

  suitsWithCount.sort((a, b) => b.count - a.count);

  const bestCount = suitsWithCount[0].count;

  if (bestCount === 0) {
    return allSuits;
  }

  return suitsWithCount
    .filter((item) => item.count === bestCount)
    .map((item) => item.suit);
}

function requestedSuitsLabel(suits: Suit[]): string {
  if (suits.length === 4) return "なんでもよい";

  if (
    suits.length === 2 &&
    suits.includes("spade") &&
    suits.includes("club")
  ) {
    return "黒";
  }

  if (
    suits.length === 2 &&
    suits.includes("heart") &&
    suits.includes("diamond")
  ) {
    return "赤";
  }

  return suits.map((suit) => suitLabel(suit)).join(" / ");
}

function winnerNames(players: Player[], scores: number[]): string {
  const minScore = Math.min(...scores);

  return players
    .filter((_, index) => scores[index] === minScore)
    .map((player) => player.name)
    .join("、");
}

function cardsLabel(cards: CardType[]): string {
  return cards.map((card) => cardLabel(card)).join(" + ");
}

function cardLabel(card: CardType): string {
  return `${suitLabel(card.suit)}${rankLabel(card.rank)}`;
}

type CpuHandProps = {
  name: string;
  hand: CardType[];
  reveal: boolean;
};

function CpuHand({ name, hand, reveal }: CpuHandProps) {
  return (
    <div style={cpuHandWrapStyle}>
      <div
        style={{
          backgroundColor: "rgba(255,255,255,0.15)",
          padding: "4px 10px",
          borderRadius: "20px",
          fontSize: "14px",
          marginBottom: "4px",
          whiteSpace: "nowrap",
        }}
      >
        {name}：{hand.length}枚
      </div>

      {reveal ? (
        <div style={cpuRevealCardsWrapStyle}>
          {hand.map((card, index) => (
            <MiniPlayingCard key={`${card.suit}-${card.rank}-${index}`} card={card} />
          ))}
        </div>
      ) : (
        <CpuBackStack count={hand.length} />
      )}
    </div>
  );
}

function CpuBackStack({ count }: { count: number }) {
  const visibleCount = Math.min(count, 12);

  return (
    <div style={cpuBackStackStyle}>
      {Array.from({ length: visibleCount }).map((_, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            left: index * 9,
            top: index % 2 === 0 ? 0 : 3,
            zIndex: index,
          }}
        >
          <CardBack />
        </div>
      ))}

      {count > visibleCount && (
        <div style={cpuExtraCountStyle}>+{count - visibleCount}</div>
      )}
    </div>
  );
}

function CardBack({
  large = false,
  extraLarge = false,
}: {
  large?: boolean;
  extraLarge?: boolean;
}) {
  const width = extraLarge ? "88px" : large ? "54px" : "25px";
  const height = extraLarge ? "126px" : large ? "78px" : "37px";

  return (
    <div
      style={{
        width,
        height,
        backgroundColor: "#0f172a",
        backgroundImage: "url('/images/dobon_card_back.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        border: "2px solid #facc15",
        borderRadius: extraLarge ? "12px" : large ? "8px" : "5px",
        boxShadow: "0 3px 8px rgba(0,0,0,0.35)",
      }}
    />
  );
}

function MiniPlayingCard({ card }: { card: CardType }) {
  return (
    <div
      style={{
        width: "32px",
        height: "46px",
        backgroundColor: "white",
        color: isRedSuit(card.suit) ? "#dc2626" : "black",
        borderRadius: "8px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "17px",
        fontWeight: "bold",
        boxShadow: "0 3px 8px rgba(0,0,0,0.3)",
      }}
    >
      <div>{rankLabel(card.rank)}</div>
      <div>{suitLabel(card.suit)}</div>
    </div>
  );
}

function PlayingCard({ card }: { card: CardType }) {
  return (
    <div
      style={{
        width: "70px",
        height: "100px",
        backgroundColor: "white",
        color: isRedSuit(card.suit) ? "#dc2626" : "black",
        borderRadius: "9px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "8px",
        fontSize: "16px",
        fontWeight: "bold",
        boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
        boxSizing: "border-box",
      }}
    >
      <div>{rankLabel(card.rank)}</div>
      <div style={{ textAlign: "center", fontSize: "24px" }}>
        {suitLabel(card.suit)}
      </div>
      <div style={{ alignSelf: "flex-end" }}>{rankLabel(card.rank)}</div>
    </div>
  );
}

function rankLabel(rank: number): string {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";

  return String(rank);
}

function suitLabel(suit: CardType["suit"]): string {
  if (suit === "spade") return "♠";
  if (suit === "heart") return "♥";
  if (suit === "diamond") return "♦";

  return "♣";
}

function isRedSuit(suit: CardType["suit"]): boolean {
  return suit === "heart" || suit === "diamond";
}

function suitSelectButtonStyle(selected: boolean, red: boolean): CSSProperties {
  return {
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    border: selected ? "3px solid #facc15" : "2px solid white",
    backgroundColor: selected ? "#facc15" : "white",
    color: red ? "#dc2626" : "black",
    fontSize: "24px",
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: selected ? "0 0 12px rgba(250,204,21,0.9)" : "none",
  };
}

function wideSuitButtonStyle(selected: boolean, red = false): CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: "999px",
    border: selected ? "3px solid #facc15" : "2px solid white",
    backgroundColor: selected ? "#facc15" : "white",
    color: red ? "#dc2626" : "#111827",
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: selected ? "0 0 12px rgba(250,204,21,0.9)" : "none",
  };
}

function messageBoxStyle(active: boolean): CSSProperties {
  return {
    backgroundColor: active ? "rgba(250,204,21,0.22)" : "rgba(0,0,0,0.25)",
    border: active ? "2px solid #facc15" : "none",
    padding: "8px 12px",
    borderRadius: "14px",
    marginTop: "8px",
    textAlign: "center",
    fontSize: "14px",
    maxWidth: "280px",
  };
}

function dobonButtonStyle(canDobon: boolean): CSSProperties {
  return {
    marginTop: "6px",
    padding: canDobon ? "6px 16px" : "6px 16px",
    borderRadius: "999px",
    border: canDobon ? "3px solid #fff" : "2px solid #777",
    backgroundColor: canDobon ? "#facc15" : "#4b5563",
    color: canDobon ? "#111827" : "#d1d5db",
    cursor: canDobon ? "pointer" : "not-allowed",
    boxShadow: canDobon
      ? "0 0 18px #facc15, 0 0 36px rgba(250,204,21,0.8)"
      : "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "132px",
    minHeight: "54px",
    overflow: "hidden",
  };
}

function dobonButtonLogoStyle(active: boolean): CSSProperties {
  return {
    width: "138px",
    height: "auto",
    display: "block",
    opacity: active ? 1 : 0.45,
    filter: active ? "drop-shadow(0 2px 4px rgba(0,0,0,0.45))" : "grayscale(1)",
  };
}

const animationOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  pointerEvents: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const flyingCardBaseStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  marginLeft: "-27px",
  marginTop: "-39px",
};

const dealDeckStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  marginLeft: "-27px",
  marginTop: "-39px",
  opacity: 0.55,
};

const actionFlyingCardStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  marginLeft: "-35px",
  marginTop: "-50px",
};

const actionCardFaceStyle: CSSProperties = {
  width: "78px",
  height: "108px",
  backgroundColor: "white",
  color: "#111827",
  borderRadius: "10px",
  border: "3px solid #facc15",
  boxShadow: "0 8px 18px rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "20px",
  fontWeight: "bold",
  padding: "6px",
  boxSizing: "border-box",
  textAlign: "center",
};

const dobonMissScreenStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 125,
  pointerEvents: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(0,0,0,0.38)",
};

const dobonMissCloseButtonStyle: CSSProperties = {
  position: "absolute",
  top: "10px",
  right: "10px",
  width: "34px",
  height: "34px",
  borderRadius: "50%",
  border: "2px solid white",
  backgroundColor: "#111827",
  color: "white",
  fontSize: "22px",
  fontWeight: "bold",
  cursor: "pointer",
  lineHeight: 1,
  zIndex: 2,
};

const dobonMissBoxStyle: CSSProperties = {
  position: "relative",
  width: "360px",
  maxWidth: "88vw",
  padding: "22px 18px",
  borderRadius: "24px",
  background: "linear-gradient(135deg, rgba(127,29,29,0.96), rgba(30,41,59,0.94))",
  border: "4px solid #f87171",
  boxShadow: "0 0 24px rgba(248,113,113,0.85), 0 8px 28px rgba(0,0,0,0.6)",
  textAlign: "center",
  animation: "missStay 0.28s ease-out both, missShake 0.35s ease-in-out 0.08s both",
};

const dobonMissMarkStyle: CSSProperties = {
  width: "72px",
  height: "72px",
  margin: "0 auto 8px",
  borderRadius: "50%",
  backgroundColor: "#dc2626",
  border: "4px solid white",
  color: "white",
  fontSize: "56px",
  lineHeight: "62px",
  fontWeight: 900,
};

const dobonMissTitleStyle: CSSProperties = {
  color: "#fecaca",
  fontSize: "30px",
  fontWeight: 900,
  textShadow: "0 2px 8px rgba(0,0,0,0.7)",
  marginBottom: "6px",
};

const dobonMissTextStyle: CSSProperties = {
  color: "white",
  fontSize: "18px",
  fontWeight: "bold",
};

const explosionScreenStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 120,
  pointerEvents: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(0,0,0,0.28)",
};

const explosionShakeStyle: CSSProperties = {
  position: "relative",
  width: "100vw",
  height: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  animation: "dobonShake 0.55s ease-in-out both",
};

const explosionFlashStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(circle, rgba(250,204,21,0.34) 0%, rgba(249,115,22,0.18) 30%, rgba(0,0,0,0) 62%)",
  animation: "dobonExplosion 0.72s ease-out both",
};

const explosionCircleStyle: CSSProperties = {
  position: "absolute",
  width: "210px",
  height: "210px",
  borderRadius: "50%",
  background:
    "radial-gradient(circle, rgba(255,247,237,0.72) 0%, rgba(250,204,21,0.72) 24%, rgba(249,115,22,0.68) 48%, rgba(220,38,38,0.55) 68%, transparent 72%)",
  animation: "dobonExplosion 1.15s ease-out both",
};

const explosionCircleSecondStyle: CSSProperties = {
  position: "absolute",
  width: "160px",
  height: "160px",
  borderRadius: "50%",
  background:
    "radial-gradient(circle, rgba(255,255,255,0.55) 0%, rgba(253,230,138,0.62) 22%, rgba(251,113,133,0.48) 54%, transparent 70%)",
  animation: "dobonExplosion 1.05s ease-out 0.12s both",
};

const explosionRingStyle: CSSProperties = {
  position: "absolute",
  width: "260px",
  height: "260px",
  borderRadius: "50%",
  border: "10px solid rgba(250,204,21,0.78)",
  boxShadow: "0 0 32px rgba(249,115,22,0.9), inset 0 0 28px rgba(220,38,38,0.65)",
  animation: "dobonExplosion 1.25s ease-out 0.04s both",
};

function explosionParticleStyle(index: number): CSSProperties {
  const positions = [
    { x: -150, y: -110, r: -18 },
    { x: 155, y: -95, r: 22 },
    { x: -135, y: 115, r: 16 },
    { x: 140, y: 125, r: -24 },
  ];

  const pos = positions[index];

  return {
    position: "absolute",
    width: "72px",
    height: "28px",
    borderRadius: "999px",
    background: "linear-gradient(90deg, #facc15, #f97316, #dc2626)",
    boxShadow: "0 0 18px rgba(250,204,21,0.95)",
    transform: `translate(${pos.x}px, ${pos.y}px) rotate(${pos.r}deg)`,
    animation: `dobonTextPop 0.95s ease-out ${index * 0.07}s both`,
  };
}

const explosionLogoWrapStyle: CSSProperties = {
  position: "relative",
  padding: "16px 22px",
  borderRadius: "28px",
  background:
    "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(30,41,59,0.92))",
  border: "3px solid rgba(250,204,21,0.9)",
  boxShadow:
    "0 0 18px rgba(250,204,21,0.75), 0 0 42px rgba(249,115,22,0.45), 0 8px 24px rgba(0,0,0,0.55)",
  animation: "dobonTextPop 1.2s ease-out both",
  overflow: "hidden",
};

const mobilePageStyle: CSSProperties = {
  backgroundColor: "#064e3b",
  width: "100vw",
  minHeight: "100svh",
  color: "white",
  fontFamily: "sans-serif",
  overflowX: "hidden",
  overflowY: "auto",
  boxSizing: "border-box",
  padding: "6px 4px 18px",
};

const pageStyle: CSSProperties = {
  backgroundColor: "#064e3b",
  width: "100vw",
  minHeight: "100vh",
  height: "100svh",
  color: "white",
  fontFamily: "sans-serif",
  overflow: "hidden",
  boxSizing: "border-box",
  padding: "4px",
};

const mobileContainerStyle: CSSProperties = {
  width: "100%",
  maxWidth: "430px",
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  minHeight: "100svh",
  overflow: "visible",
};

const containerStyle: CSSProperties = {
  maxWidth: "1180px",
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  height: "100%",
  overflow: "hidden",
};

const mobileFixedButtonAreaStyle: CSSProperties = {
  position: "static",
  zIndex: 30,
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "6px",
  width: "100%",
  maxWidth: "420px",
  margin: "0 auto 6px",
  padding: "0 6px",
  boxSizing: "border-box",
};

const fixedButtonAreaStyle: CSSProperties = {
  position: "fixed",
  top: "12px",
  right: "12px",
  zIndex: 30,
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  alignItems: "stretch",
};

const scoreToggleButtonStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "999px",
  border: "3px solid white",
  backgroundColor: "#facc15",
  color: "#111827",
  fontWeight: "bold",
  cursor: "pointer",
  boxShadow: "0 0 14px rgba(250,204,21,0.8)",
};

const scoreRuleToggleButtonStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: "999px",
  border: "2px solid white",
  backgroundColor: "#1f2937",
  color: "white",
  fontWeight: "bold",
  cursor: "pointer",
  boxShadow: "0 0 10px rgba(0,0,0,0.35)",
};

function bgmToggleButtonStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: "999px",
    border: active ? "3px solid #facc15" : "2px solid white",
    backgroundColor: active ? "#22c55e" : "#374151",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: active ? "0 0 14px rgba(34,197,94,0.75)" : "0 0 10px rgba(0,0,0,0.35)",
  };
}

function modeToggleButtonStyle(active: boolean): CSSProperties {
  return {
    padding: "7px 10px",
    borderRadius: "999px",
    border: active ? "3px solid #facc15" : "2px solid white",
    backgroundColor: active ? "#7c3aed" : "#0f766e",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: active ? "0 0 14px rgba(124,58,237,0.85)" : "0 0 10px rgba(0,0,0,0.35)",
  };
}

const gameHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
  marginTop: "4px",
};

const backToTitleButtonStyle: CSSProperties = {
  padding: "7px 12px",
  borderRadius: "999px",
  border: "2px solid white",
  backgroundColor: "#374151",
  color: "white",
  fontWeight: "bold",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const scoreBoardStyle: CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.12)",
  padding: "5px 12px",
  borderRadius: "14px",
  marginBottom: "4px",
  textAlign: "center",
  fontSize: "13px",
};

const dobonTimerBoxStyle: CSSProperties = {
  backgroundColor: "rgba(220,38,38,0.35)",
  border: "3px solid #facc15",
  borderRadius: "18px",
  padding: "7px 12px",
  marginBottom: "10px",
  textAlign: "center",
  width: "210px",
  boxShadow: "0 0 22px rgba(250,204,21,0.8)",
};

const timerBarOuterStyle: CSSProperties = {
  width: "100%",
  height: "12px",
  backgroundColor: "rgba(255,255,255,0.25)",
  borderRadius: "999px",
  overflow: "hidden",
  marginTop: "6px",
};

const timerBarInnerStyle: CSSProperties = {
  height: "100%",
  backgroundColor: "#facc15",
  borderRadius: "999px",
  transition: "width 0.25s linear",
};

const topFieldCardHighlightStyle: CSSProperties = {
  border: "4px solid #facc15",
  borderRadius: "14px",
  padding: "3px",
  boxShadow: "0 0 18px rgba(250,204,21,0.95)",
  backgroundColor: "rgba(250,204,21,0.18)",
};

const fieldStackWrapStyle: CSSProperties = {
  position: "relative",
  width: "146px",
  height: "118px",
  margin: "0 auto",
};

const modalCloseButtonStyle: CSSProperties = {
  position: "absolute",
  top: "10px",
  right: "10px",
  width: "32px",
  height: "32px",
  borderRadius: "50%",
  border: "2px solid white",
  backgroundColor: "#dc2626",
  color: "white",
  fontSize: "20px",
  fontWeight: "bold",
  cursor: "pointer",
  lineHeight: 1,
};

const scoreRulesWrapStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: "560px",
  backgroundColor: "rgba(0,0,0,0.35)",
  border: "2px solid rgba(250,204,21,0.45)",
  borderRadius: "16px",
  padding: "10px",
  marginBottom: "10px",
  boxSizing: "border-box",
  textAlign: "center",
};

const scoreRulesTableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const scoreRulesHeaderStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.25)",
  backgroundColor: "rgba(255,255,255,0.14)",
  padding: "6px",
  color: "#facc15",
};

const scoreRulesCellStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.25)",
  padding: "6px",
};

const scoreTableWrapStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: "920px",
  backgroundColor: "rgba(0,0,0,0.35)",
  border: "2px solid rgba(255,255,255,0.25)",
  borderRadius: "16px",
  padding: "10px",
  marginBottom: "10px",
  boxSizing: "border-box",
  textAlign: "center",
};

const scoreTableStyle: CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  minWidth: "830px",
};

const scoreHeaderCellStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.25)",
  padding: "6px",
  backgroundColor: "rgba(255,255,255,0.14)",
  fontSize: "13px",
  whiteSpace: "nowrap",
};

const scoreTotalHeaderCellStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.25)",
  padding: "6px",
  backgroundColor: "rgba(250,204,21,0.35)",
  color: "#facc15",
  fontSize: "13px",
  whiteSpace: "nowrap",
};

const scorePlayerCellStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.25)",
  padding: "6px",
  backgroundColor: "rgba(255,255,255,0.12)",
  fontSize: "13px",
  whiteSpace: "nowrap",
};

const scoreBodyCellStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.25)",
  padding: "4px",
  minWidth: "58px",
  height: "42px",
  textAlign: "center",
};

const scoreCellInnerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  gap: "2px",
};

const scoreTotalCellStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.25)",
  padding: "6px",
  minWidth: "64px",
  height: "42px",
  textAlign: "center",
  fontSize: "24px",
  fontWeight: "bold",
  color: "#facc15",
  backgroundColor: "rgba(250,204,21,0.12)",
};

const statusBlueStyle: CSSProperties = {
  backgroundColor: "#2563eb",
  color: "white",
  fontWeight: "bold",
  padding: "5px 14px",
  borderRadius: "999px",
  marginBottom: "4px",
  boxShadow: "0 0 14px rgba(37,99,235,0.8)",
  fontSize: "13px",
};

const statusRedStyle: CSSProperties = {
  backgroundColor: "#dc2626",
  color: "white",
  fontWeight: "bold",
  padding: "5px 14px",
  borderRadius: "999px",
  marginBottom: "4px",
  boxShadow: "0 0 14px rgba(220,38,38,0.8)",
  fontSize: "13px",
};

const roundResultStyle: CSSProperties = {
  backgroundColor: "rgba(0,0,0,0.45)",
  border: "3px solid #facc15",
  borderRadius: "18px",
  padding: "8px 12px",
  marginBottom: "4px",
  textAlign: "center",
  maxWidth: "520px",
  fontSize: "14px",
};

const nextRoundButtonStyle: CSSProperties = {
  padding: "10px 24px",
  borderRadius: "999px",
  border: "3px solid white",
  backgroundColor: "#facc15",
  color: "#111827",
  fontSize: "18px",
  fontWeight: "bold",
  cursor: "pointer",
};

const restartButtonStyle: CSSProperties = {
  marginTop: "10px",
  padding: "10px 24px",
  borderRadius: "999px",
  border: "3px solid white",
  backgroundColor: "#22c55e",
  color: "white",
  fontSize: "18px",
  fontWeight: "bold",
  cursor: "pointer",
};

const tableAreaStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: "28px",
  marginTop: "14px",
  flexWrap: "wrap",
  width: "100%",
};

const mobileGameBoardStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "96px minmax(170px, 1fr) 96px",
  gridTemplateRows: "auto auto auto",
  gridTemplateAreas: `
    "top top top"
    "left table right"
    "player player player"
  `,
  gap: "6px",
  alignItems: "center",
  justifyItems: "center",
  width: "100%",
  maxWidth: "420px",
  marginTop: "0",
  flex: "none",
  minHeight: 0,
};

const mobileLeftCpuAreaStyle: CSSProperties = {
  gridArea: "left",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  transform: "scale(0.82)",
  transformOrigin: "center",
};

const mobileTopCpuAreaStyle: CSSProperties = {
  gridArea: "top",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  transform: "scale(0.86)",
  transformOrigin: "center",
};

const mobileRightCpuAreaStyle: CSSProperties = {
  gridArea: "right",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  transform: "scale(0.82)",
  transformOrigin: "center",
};

const mobileCenterBoardAreaStyle: CSSProperties = {
  display: "contents",
};

const mobileCenterTableStyle: CSSProperties = {
  gridArea: "table",
  display: "flex",
  gap: "8px",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px",
  borderRadius: "18px",
  backgroundColor: "rgba(0,0,0,0.18)",
  border: "1px solid rgba(255,255,255,0.14)",
  transform: "scale(0.9)",
  transformOrigin: "center",
};

const mobilePlayerPanelStyle: CSSProperties = {
  gridArea: "player",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  width: "100%",
};

const gameBoardStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "160px minmax(250px, 1fr) 330px",
  gap: "8px",
  alignItems: "center",
  width: "100%",
  maxWidth: "1040px",
  marginTop: "0",
  flex: 1,
  minHeight: 0,
};

const leftCpuAreaStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

const centerBoardAreaStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "5px",
};

const centerTableStyle: CSSProperties = {
  display: "flex",
  gap: "18px",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px",
  borderRadius: "20px",
  backgroundColor: "rgba(0,0,0,0.18)",
  border: "1px solid rgba(255,255,255,0.14)",
};

const playerPanelStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

function playerControlBoxStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    border: active ? "3px solid #facc15" : "3px solid transparent",
    borderRadius: "18px",
    padding: "6px",
    width: "100%",
    boxSizing: "border-box",
    backgroundColor: "rgba(0,0,0,0.16)",
  };
}

const homeLogoButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
};

const requestedSuitPlayerNoticeStyle: CSSProperties = {
  backgroundColor: "#2563eb",
  color: "white",
  fontWeight: "bold",
  padding: "8px 18px",
  borderRadius: "999px",
  marginBottom: "6px",
  boxShadow: "0 0 16px rgba(37,99,235,0.9)",
  fontSize: "16px",
  border: "2px solid rgba(255,255,255,0.75)",
};

const suitSelectAreaStyle: CSSProperties = {
  marginTop: "6px",
  backgroundColor: "rgba(250,204,21,0.2)",
  border: "2px solid #facc15",
  borderRadius: "14px",
  padding: "8px",
  textAlign: "center",
  maxWidth: "260px",
};

const suitSelectAreaInHandStyle: CSSProperties = {
  backgroundColor: "rgba(250,204,21,0.2)",
  border: "2px solid #facc15",
  borderRadius: "14px",
  padding: "8px",
  textAlign: "center",
  maxWidth: "318px",
  marginBottom: "6px",
};

const suitButtonWrapStyle: CSSProperties = {
  display: "flex",
  gap: "6px",
  justifyContent: "center",
  flexWrap: "wrap",
};

const suitSelectPanelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  alignItems: "center",
};

const suitSelectRowStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  justifyContent: "center",
  flexWrap: "wrap",
};

const directionIndicatorStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 10px",
  border: "3px solid #22c55e",
  borderRadius: "999px",
  backgroundColor: "rgba(0,0,0,0.28)",
  marginBottom: "4px",
};

const cpuHandWrapStyle: CSSProperties = {
  textAlign: "center",
  width: "145px",
  minHeight: "58px",
};

const cpuCardsWrapStyle: CSSProperties = {
  display: "flex",
  gap: "4px",
  justifyContent: "center",
  flexWrap: "wrap",
  maxWidth: "160px",
  margin: "0 auto",
};

const cpuRevealCardsWrapStyle: CSSProperties = {
  display: "flex",
  gap: "3px",
  justifyContent: "center",
  flexWrap: "wrap",
  maxWidth: "160px",
  margin: "0 auto",
};

const cpuBackStackStyle: CSSProperties = {
  position: "relative",
  height: "42px",
  width: "126px",
  margin: "0 auto",
};

const cpuExtraCountStyle: CSSProperties = {
  position: "absolute",
  right: "0",
  bottom: "-4px",
  backgroundColor: "#facc15",
  color: "#111827",
  borderRadius: "999px",
  padding: "1px 6px",
  fontSize: "12px",
  fontWeight: "bold",
};

const beginnerBoxStyle: CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.12)",
  padding: "5px 9px",
  borderRadius: "16px",
  marginBottom: "4px",
  textAlign: "center",
};

const topCardSelectBoxStyle: CSSProperties = {
  marginTop: "8px",
  padding: "8px",
  borderRadius: "14px",
  backgroundColor: "rgba(0,0,0,0.25)",
  border: "2px solid rgba(250,204,21,0.65)",
};

const handAreaStyle: CSSProperties = {
  display: "flex",
  flexWrap: "nowrap",
  justifyContent: "center",
  alignItems: "flex-end",
  width: "300px",
  height: "122px",
  overflow: "visible",
  paddingLeft: "56px",
  paddingRight: "8px",
};

const titlePageStyle: CSSProperties = {
  width: "100vw",
  minHeight: "100vh",
  backgroundColor: "#064e3b",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px",
  boxSizing: "border-box",
  fontFamily: "sans-serif",
};

const titleCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: "520px",
  background:
    "radial-gradient(circle at center 22%, rgba(30,64,175,0.95), rgba(15,23,42,0.98) 52%, rgba(2,6,23,1) 100%)",
  color: "#f8fafc",
  border: "3px solid rgba(250,204,21,0.9)",
  borderRadius: "24px",
  padding: "30px 18px",
  textAlign: "center",
  boxShadow: "0 0 34px rgba(15,23,42,0.85), 0 0 22px rgba(250,204,21,0.35)",
};

const titleBadgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "6px 14px",
  borderRadius: "999px",
  backgroundColor: "rgba(255,255,255,0.14)",
  color: "#f8fafc",
  fontSize: "13px",
  fontWeight: "bold",
  marginBottom: "14px",
  border: "1px solid rgba(255,255,255,0.2)",
};

const titleLeadStyle: CSSProperties = {
  margin: "0 auto 18px",
  maxWidth: "380px",
  lineHeight: 1.6,
  color: "#f8fafc",
  fontWeight: "bold",
  textShadow: "0 2px 8px rgba(0,0,0,0.75)",
};

const startGameButtonStyle: CSSProperties = {
  display: "block",
  width: "220px",
  margin: "0 auto 10px",
  padding: "12px 18px",
  borderRadius: "999px",
  border: "3px solid white",
  backgroundColor: "#facc15",
  color: "#111827",
  fontSize: "20px",
  fontWeight: "bold",
  cursor: "pointer",
  boxShadow: "0 0 18px rgba(250,204,21,0.75)",
};

const ruleToggleButtonStyle: CSSProperties = {
  padding: "8px 16px",
  borderRadius: "999px",
  border: "2px solid white",
  backgroundColor: "#374151",
  color: "white",
  fontWeight: "bold",
  cursor: "pointer",
};

const settingsHelpWrapStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: "720px",
  maxHeight: "72vh",
  overflowY: "auto",
  backgroundColor: "rgba(0,0,0,0.42)",
  border: "2px solid rgba(250,204,21,0.45)",
  borderRadius: "16px",
  padding: "14px",
  marginBottom: "10px",
  boxSizing: "border-box",
  textAlign: "left",
  lineHeight: 1.65,
};

const settingsSectionStyle: CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "14px",
  padding: "10px",
  marginBottom: "10px",
};

const settingsSectionTitleStyle: CSSProperties = {
  fontWeight: "bold",
  color: "#facc15",
  marginBottom: "6px",
  fontSize: "16px",
};

const settingsRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontSize: "16px",
  fontWeight: "bold",
  marginBottom: "6px",
};

const ruleBoxStyle: CSSProperties = {
  marginTop: "14px",
  padding: "12px",
  borderRadius: "14px",
  backgroundColor: "rgba(255,255,255,0.12)",
  color: "#f8fafc",
  textAlign: "left",
  lineHeight: 1.7,
};

export default App;
