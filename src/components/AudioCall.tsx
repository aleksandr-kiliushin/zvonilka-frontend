import { useState, useEffect, useRef, useCallback } from "react";
import Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import "./AudioCall.css";

interface CallState {
  isConnected: boolean;
  isCalling: boolean;
  isMuted: boolean;
  isReceivingCall: boolean;
  incomingCallId: string | null;
}

const AudioCall = () => {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [myId, setMyId] = useState<string>("");
  const [remoteId, setRemoteId] = useState<string>("");
  const [callState, setCallState] = useState<CallState>({
    isConnected: false,
    isCalling: false,
    isMuted: false,
    isReceivingCall: false,
    incomingCallId: null,
  });
  const [status, setStatus] = useState<string>("Инициализация...");
  const [audioLevel, setAudioLevel] = useState<number>(0);

  const localStreamRef = useRef<MediaStream | null>(null);
  const currentCallRef = useRef<MediaConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  const [isPeerLoading, setIsPeerLoading] = useState(true);

  useEffect(() => {
    const initPeer = async () => {
      try {
        // Проверяем поддержку WebRTC
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setStatus("❌ WebRTC не поддерживается в этом браузере");
          return;
        }

        // Проверяем, что мы на HTTPS (кроме localhost)
        if (
          location.protocol === "http:" &&
          location.hostname !== "localhost"
        ) {
          setStatus("⚠️ Требуется HTTPS для работы WebRTC");
          return;
        }

        setStatus("🔄 Инициализация P2P соединения...");

        // Даем время на загрузку PeerJS
        await new Promise((resolve) => setTimeout(resolve, 100));

        // @ts-ignore
        const peerInstance = new Peer(undefined, {
          debug: 1, // Уменьшили логирование
          config: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
            ],
          },
        });

        // Устанавливаем обработчики ПЕРЕД установкой peer в state
        peerInstance.on("open", (id: string) => {
          console.log("✅ Peer ID:", id);
          setMyId(id);
          setIsPeerLoading(false); // Убираем загрузку
          setStatus("🟢 Готов к звонкам");
        });

        peerInstance.on("call", handleIncomingCall);

        peerInstance.on("error", (error) => {
          console.error("❌ PeerJS Error:", error);
          setStatus(`Ошибка P2P: ${error.message}`);
          // Переинициализация через 3 секунды
          setTimeout(() => {
            if (!peer) initPeer();
          }, 3000);
        });

        peerInstance.on("disconnected", () => {
          console.log("🔌 Peer disconnected");
          setStatus("Соединение потеряно, переподключение...");
          // Попробовать переподключиться
          setTimeout(() => {
            if (peerInstance && !peerInstance.destroyed) {
              peerInstance.reconnect();
            }
          }, 1000);
        });

        // Устанавливаем peer в state только после настройки обработчиков
        setPeer(peerInstance);
      } catch (error) {
        console.error("❌ Failed to initialize peer:", error);
        setStatus("Ошибка инициализации P2P");
      }
    };

    initPeer();

    return () => {
      if (peer && !peer.destroyed) {
        peer.destroy();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []); // Убираем peer из зависимостей

  // Обработка входящего звонка
  const handleIncomingCall = useCallback((call: MediaConnection) => {
    // Проверяем, что call существует
    if (!call || !call.peer) {
      console.error("❌ Invalid incoming call");
      return;
    }

    console.log("📞 Incoming call from:", call.peer);
    setCallState((prev) => ({
      ...prev,
      isReceivingCall: true,
      incomingCallId: call.peer,
    }));
    setStatus(`📞 Входящий звонок от ${call.peer.substring(0, 8)}...`);

    const timer = setTimeout(() => {
      // Проверяем, что call все еще валиден
      if (call && !call.open) {
        answerCall(call);
      }
    }, 2000);

    // Очищаем таймер при закрытии звонка
    call.on("close", () => {
      clearTimeout(timer);
      handleCallEnd();
    });
  }, []);

  // Получение медиа потока с улучшенными настройками
  const getLocalStream = async (): Promise<MediaStream> => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
        video: false,
      });

      localStreamRef.current = stream;
      console.log("🎤 Local stream obtained with enhanced settings");

      // Настройка анализатора аудио для визуализации
      setupAudioAnalyser(stream);

      return stream;
    } catch (error) {
      console.error("❌ Error getting user media:", error);
      throw new Error("Не удалось получить доступ к микрофону");
    }
  };

  // Настройка анализатора аудио
  const setupAudioAnalyser = (stream: MediaStream) => {
    try {
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      startAudioLevelMonitoring();
    } catch (error) {
      console.warn("⚠️ Could not setup audio analyser:", error);
    }
  };

  // Мониторинг уровня аудио
  const startAudioLevelMonitoring = () => {
    const updateLevel = () => {
      if (analyserRef.current && callState.isConnected) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        const average =
          dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        setAudioLevel(average / 255); // Нормализуем до 0-1
      }

      animationRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  };

  const startCall = async () => {
    // Проверяем, что peer инициализирован
    if (!peer || peer.destroyed) {
      setStatus("❌ P2P соединение не готово");
      return;
    }

    if (!remoteId.trim()) {
      alert("Введите ID собеседника");
      return;
    }

    try {
      setCallState((prev) => ({ ...prev, isCalling: true }));
      setStatus("🎤 Получение доступа к микрофону...");

      const stream = await getLocalStream();
      setStatus("🔄 Подключение к собеседнику...");

      // Дополнительная проверка перед вызовом
      if (!peer || peer.destroyed) {
        throw new Error("P2P соединение потеряно");
      }

      const call = peer.call(remoteId.trim(), stream);

      if (!call) {
        throw new Error("Не удалось создать звонок");
      }

      // ... остальная логика
    } catch (error) {
      console.error("❌ Error starting call:", error);
      setStatus(
        error instanceof Error ? error.message : "Ошибка начала звонка"
      );
      setCallState((prev) => ({ ...prev, isCalling: false }));
    }
  };

  // Ответить на звонок
  const answerCall = async (call: MediaConnection) => {
    try {
      setStatus("🎤 Получение доступа к микрофону...");
      const stream = await getLocalStream();

      console.log("✅ Answering call from:", call.peer);
      call.answer(stream);

      call.on("stream", (remoteStream) => {
        console.log("🎧 Received remote stream in answer");
        handleRemoteStream(remoteStream);
      });

      call.on("close", () => {
        console.log("📴 Answered call closed");
        handleCallEnd();
      });

      currentCallRef.current = call;
      setCallState((prev) => ({
        ...prev,
        isConnected: true,
        isReceivingCall: false,
        incomingCallId: null,
      }));
      setStatus("✅ Соединение установлено");
    } catch (error) {
      console.error("❌ Error answering call:", error);
      setStatus(
        error instanceof Error ? error.message : "Ошибка ответа на звонок"
      );
      setCallState((prev) => ({
        ...prev,
        isReceivingCall: false,
        incomingCallId: null,
      }));
    }
  };

  // Обработка удаленного аудио потока
  const handleRemoteStream = (remoteStream: MediaStream) => {
    console.log("🔊 Setting remote stream");
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch((error) => {
        console.error("❌ Error playing remote audio:", error);
      });
    }
  };

  // Завершение звонка
  const handleCallEnd = () => {
    console.log("📞 Ending call");

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (currentCallRef.current) {
      currentCallRef.current.close();
      currentCallRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        track.stop();
        console.log("⏹️ Stopped track:", track.kind);
      });
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    setCallState({
      isConnected: false,
      isCalling: false,
      isMuted: false,
      isReceivingCall: false,
      incomingCallId: null,
    });
    setAudioLevel(0);
    setStatus("📴 Звонок завершен");

    setTimeout(() => {
      setStatus("🟢 Готов к звонкам");
    }, 2000);
  };

  // Переключение звука
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const newMutedState = !audioTrack.enabled;
        setCallState((prev) => ({ ...prev, isMuted: newMutedState }));
        console.log("🔇 Muted:", newMutedState);
      }
    }
  };

  // Копирование ID в буфер обмена
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(myId);
      setStatus("📋 ID скопирован!");
      setTimeout(() => setStatus("🟢 Готов к звонкам"), 2000);
    } catch (error) {
      console.error("❌ Clipboard error:", error);
      // Fallback для старых браузеров
      const textArea = document.createElement("textarea");
      textArea.value = myId;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setStatus("📋 ID скопирован!");
      setTimeout(() => setStatus("🟢 Готов к звонкам"), 2000);
    }
  };

  return (
    <div className="audio-call">
      <div className="call-container">
        <header>
          <h1>🎧 P2P Audio Call</h1>
          <div className="version-info">
            React {import.meta.env.DEV ? "19.1.1" : ""} + Vite{" "}
            {import.meta.env.DEV ? "7.0.0" : ""}
          </div>
        </header>

        <div className="connection-info">
          <div className="id-section">
            <label>Ваш ID:</label>
            <div className="id-input-group">
              <input
                type="text"
                value={myId}
                readOnly
                className="id-input"
                placeholder="Генерируется автоматически..."
              />
              <button
                onClick={copyToClipboard}
                className="copy-btn"
                disabled={!myId}
                title="Копировать ID"
              >
                📋
              </button>
            </div>
          </div>

          <div className="remote-id-section">
            <label>ID собеседника:</label>
            <input
              type="text"
              value={remoteId}
              onChange={(e) => setRemoteId(e.target.value)}
              placeholder="Введите ID собеседника"
              className="remote-id-input"
              disabled={callState.isConnected || callState.isCalling}
            />
          </div>
        </div>

        <div className="call-controls">
          {!callState.isConnected &&
            !callState.isCalling &&
            !callState.isReceivingCall && (
              <button
                onClick={startCall}
                className="call-btn primary"
                disabled={!peer || !remoteId.trim()}
              >
                📞 Позвонить
              </button>
            )}

          {callState.isCalling && (
            <button onClick={handleCallEnd} className="call-btn danger">
              ❌ Отменить
            </button>
          )}

          {callState.isReceivingCall && (
            <div className="incoming-call">
              <div className="pulse-indicator"></div>
              <p>📞 Входящий звонок...</p>
              <p>Автоответ через 2 сек</p>
            </div>
          )}

          {callState.isConnected && (
            <>
              <button
                onClick={toggleMute}
                className={`call-btn ${
                  callState.isMuted ? "muted" : "unmuted"
                }`}
                title={
                  callState.isMuted ? "Включить микрофон" : "Отключить микрофон"
                }
              >
                {callState.isMuted ? "🔇 Включить" : "🎤 Отключить"}
              </button>
              <button onClick={handleCallEnd} className="call-btn danger">
                📞 Завершить
              </button>
            </>
          )}
        </div>

        {/* Индикатор уровня звука */}
        {callState.isConnected && !callState.isMuted && (
          <div className="audio-level-indicator">
            <div className="audio-level-label">Уровень звука:</div>
            <div className="audio-level-bar">
              <div
                className="audio-level-fill"
                style={{ width: `${audioLevel * 100}%` }}
              ></div>
            </div>
          </div>
        )}

        <div
          className={`status ${
            callState.isConnected
              ? "connected"
              : callState.isCalling
              ? "calling"
              : ""
          }`}
        >
          <span>{status}</span>
          {callState.isConnected && (
            <div className="connection-indicator">
              <span className="indicator-dot"></span>В эфире
            </div>
          )}
        </div>

        {/* Скрытый элемент для воспроизведения удаленного аудио */}
        <audio
          ref={remoteAudioRef}
          autoPlay
          playsInline
          style={{ display: "none" }}
        />
        {isPeerLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <p>Инициализация P2P соединения...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioCall;
