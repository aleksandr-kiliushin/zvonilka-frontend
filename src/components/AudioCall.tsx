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

const generateRandomId = (): string => {
  return Math.floor(Math.random() * 90 + 10).toString();
};

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
  const [isPeerLoading, setIsPeerLoading] = useState(true);

  const localStreamRef = useRef<MediaStream | null>(null);
  const currentCallRef = useRef<MediaConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  // Настройка audio элемента
  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = 1.0;
    }
  }, []);

  // Обработка входящего звонка
  const handleIncomingCall = useCallback((call: MediaConnection) => {
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
    setStatus(`📞 Входящий звонок от ${call.peer}...`);

    const timer = setTimeout(() => {
      answerCall(call);
    }, 2000);

    call.on("close", () => {
      clearTimeout(timer);
      handleCallEnd();
    });
  }, []);

  // Инициализация PeerJS
  useEffect(() => {
    const initPeer = async () => {
      try {
        // Проверяем поддержку WebRTC
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setStatus("❌ WebRTC не поддерживается в этом браузере");
          setIsPeerLoading(false);
          return;
        }

        // Проверяем, что мы на HTTPS (кроме localhost)
        if (
          location.protocol === "http:" &&
          location.hostname !== "localhost"
        ) {
          setStatus("⚠️ Требуется HTTPS для работы WebRTC");
          setIsPeerLoading(false);
          return;
        }

        setStatus("🔄 Инициализация P2P соединения...");

        const peerInstance = new Peer(generateRandomId(), {
          debug: 1,
          config: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
            ],
          },
        });

        peerInstance.on("open", (id: string) => {
          console.log("✅ Peer ID:", id);
          setMyId(id);
          setIsPeerLoading(false);
          setStatus("🟢 Готов к звонкам");
        });

        peerInstance.on("call", handleIncomingCall);

        peerInstance.on("error", (error) => {
          console.error("❌ PeerJS Error:", error);

          // Если ID занят, генерируем новый
          if (error.type === "unavailable-id") {
            const newId = generateRandomId();
            console.log("🔄 ID занят, пробуем новый:", newId);
            // Рекурсивно пытаемся с новым ID
            setTimeout(initPeer, 500);
            return;
          }

          setStatus(`Ошибка P2P: ${error.message}`);
          setIsPeerLoading(false);
        });

        peerInstance.on("disconnected", () => {
          console.log("🔌 Peer disconnected");
          setStatus("Соединение потеряно, переподключение...");
          setTimeout(() => {
            if (peerInstance && !peerInstance.destroyed) {
              peerInstance.reconnect();
            }
          }, 1000);
        });

        setPeer(peerInstance);
      } catch (error) {
        console.error("❌ Failed to initialize peer:", error);
        setStatus("Ошибка инициализации P2P");
        setIsPeerLoading(false);
      }
    };

    initPeer();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (peer && !peer.destroyed) {
        peer.destroy();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [handleIncomingCall]);

  // Получение медиа потока
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
        },
        video: false,
      });

      localStreamRef.current = stream;
      console.log("🎤 Local stream obtained");

      // Настройка анализатора аудио
      setupAudioAnalyser(stream);

      return stream;
    } catch (error) {
      console.error("❌ Error getting user media:", error);

      // Специфичные ошибки для разных случаев
      if (error instanceof Error) {
        switch (error.name) {
          case "NotAllowedError":
            throw new Error(
              "Разрешите доступ к микрофону в настройках браузера"
            );
          case "NotFoundError":
            throw new Error("Микрофон не найден на устройстве");
          case "NotSupportedError":
            throw new Error("Используйте HTTPS для доступа к микрофону");
          case "OverconstrainedError":
            throw new Error("Настройки микрофона не поддерживаются");
          default:
            throw new Error(`Ошибка микрофона: ${error.message}`);
        }
      }

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
      if (analyserRef.current && localStreamRef.current && !callState.isMuted) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        const average =
          dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        setAudioLevel(average / 255);
      }

      if (callState.isConnected || localStreamRef.current) {
        animationRef.current = requestAnimationFrame(updateLevel);
      }
    };

    updateLevel();
  };

  // Начать звонок
  const startCall = async () => {
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

      if (!peer || peer.destroyed) {
        throw new Error("P2P соединение потеряно");
      }

      const call = peer.call(remoteId.trim(), stream);

      if (!call) {
        throw new Error("Не удалось создать звонок");
      }

      // Обработчики событий для исходящего звонка
      call.on("stream", (remoteStream) => {
        console.log("🎧 Received remote stream");
        handleRemoteStream(remoteStream);
      });

      call.on("close", () => {
        console.log("📴 Call closed");
        handleCallEnd();
      });

      call.on("error", (error) => {
        console.error("❌ Call error:", error);
        setStatus(`Ошибка звонка: ${error.message}`);
        handleCallEnd();
      });

      currentCallRef.current = call;
      setCallState((prev) => ({
        ...prev,
        isConnected: true,
        isCalling: false,
      }));
      setStatus("✅ Соединение установлено");
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
      // Устанавливаем максимальную громкость
      remoteAudioRef.current.volume = 1.0;

      // Принудительное воспроизведение с обработкой ошибок
      remoteAudioRef.current.play().catch((error) => {
        console.error("❌ Error playing remote audio:", error);
        // Попробуем еще раз через небольшую задержку
        setTimeout(() => {
          if (remoteAudioRef.current) {
            remoteAudioRef.current.play().catch(console.error);
          }
        }, 100);
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
          <h1>🎧 Звонилка</h1>
        </header>

        {isPeerLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <p>Инициализация P2P соединения...</p>
          </div>
        )}

        <div className="connection-info">
          <div className="id-section">
            <label>Ваш ID (2 цифры):</label>
            <input
              type="text"
              value={myId}
              readOnly
              className="id-input short-id"
              placeholder="Генерируется..."
              style={{
                fontSize: "1.5rem",
                textAlign: "center",
                letterSpacing: "0.2em",
              }}
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

          <div className="remote-id-section">
            <label>ID собеседника (2 цифры):</label>
            <input
              type="text"
              value={remoteId}
              onChange={(e) => setRemoteId(e.target.value)}
              placeholder="42"
              className="remote-id-input short-id"
              disabled={callState.isConnected || callState.isCalling}
              style={{ fontSize: "1.2rem", textAlign: "center" }}
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
                disabled={!peer || !remoteId.trim() || isPeerLoading}
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
            <div className="audio-level-label">Уровень микрофона:</div>
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

        {/* Исправленный audio элемент */}
        <audio
          ref={remoteAudioRef}
          autoPlay
          playsInline
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
};

export default AudioCall;
