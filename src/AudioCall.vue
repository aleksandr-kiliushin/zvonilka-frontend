<template>
  <div class="audio-call">
    <div class="call-container">
      <header>
        <h1>🎧 Звонилка</h1>
      </header>

      <div v-if="isPeerLoading" class="loading-indicator">
        <div class="spinner"></div>
        <p>Инициализация P2P соединения...</p>
      </div>

      <div class="connection-info">
        <div class="id-section">
          <label>Ваш ID (2 цифры):</label>
          <input
            type="text"
            :value="myId"
            readonly
            class="id-input short-id"
            placeholder="Генерируется..."
            style="font-size: 1.5rem; text-align: center; letter-spacing: 0.2em"
          />
          <button
            @click="copyToClipboard"
            class="copy-btn"
            :disabled="!myId"
            title="Копировать ID"
          >
            📋
          </button>
        </div>

        <div class="remote-id-section">
          <label>ID собеседника (2 цифры):</label>
          <input
            type="text"
            v-model="remoteId"
            placeholder="42"
            class="remote-id-input short-id"
            :disabled="callState.isConnected || callState.isCalling"
            style="font-size: 1.2rem; text-align: center"
          />
        </div>
      </div>

      <div class="call-controls">
        <button
          v-if="
            !callState.isConnected &&
            !callState.isCalling &&
            !callState.isReceivingCall
          "
          @click="startCall"
          class="call-btn primary"
          :disabled="!peer || !remoteId.trim() || isPeerLoading"
        >
          📞 Позвонить
        </button>

        <button
          v-if="callState.isCalling"
          @click="handleCallEnd"
          class="call-btn danger"
        >
          ❌ Отменить
        </button>

        <div v-if="callState.isReceivingCall" class="incoming-call">
          <div class="pulse-indicator"></div>
          <p>📞 Входящий звонок...</p>
          <p>Автоответ через 2 сек</p>
        </div>

        <template v-if="callState.isConnected">
          <button
            @click="toggleMute"
            :class="`call-btn ${callState.isMuted ? 'muted' : 'unmuted'}`"
            :title="
              callState.isMuted ? 'Включить микрофон' : 'Отключить микрофон'
            "
          >
            {{ callState.isMuted ? "🔇 Включить" : "🎤 Отключить" }}
          </button>
          <button @click="handleCallEnd" class="call-btn danger">
            📞 Завершить
          </button>
        </template>
      </div>

      <div
        v-if="callState.isConnected && !callState.isMuted"
        class="audio-level-indicator"
      >
        <div class="audio-level-label">Уровень микрофона:</div>
        <div class="audio-level-bar">
          <div
            class="audio-level-fill"
            :style="{ width: `${audioLevel * 100}%` }"
          ></div>
        </div>
      </div>

      <div
        :class="`status ${
          callState.isConnected
            ? 'connected'
            : callState.isCalling
            ? 'calling'
            : ''
        }`"
      >
        <span>{{ status }}</span>
        <div v-if="callState.isConnected" class="connection-indicator">
          <span class="indicator-dot"></span>В эфире
        </div>
      </div>

      <audio ref="remoteAudioRef" autoplay playsinline style="display: none" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick } from "vue";
import Peer from "peerjs";
import type { MediaConnection } from "peerjs";

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

// Реактивные данные
const peer = ref<Peer | null>(null);
const myId = ref<string>("");
const remoteId = ref<string>("");
const callState = reactive<CallState>({
  isConnected: false,
  isCalling: false,
  isMuted: false,
  isReceivingCall: false,
  incomingCallId: null,
});
const status = ref<string>("Инициализация...");
const audioLevel = ref<number>(0);
const isPeerLoading = ref(true);

// Рефы для DOM элементов и объектов
const remoteAudioRef = ref<HTMLAudioElement | null>(null);
let localStreamRef: MediaStream | null = null;
let currentCallRef: MediaConnection | null = null;
let audioContextRef: AudioContext | null = null;
let analyserRef: AnalyserNode | null = null;
let animationRef: number | null = null;

// Обработка входящего звонка
const handleIncomingCall = (call: MediaConnection) => {
  if (!call || !call.peer) {
    console.error("❌ Invalid incoming call");
    return;
  }

  console.log("📞 Incoming call from:", call.peer);
  callState.isReceivingCall = true;
  callState.incomingCallId = call.peer;
  status.value = `📞 Входящий звонок от ${call.peer}...`;

  const timer = setTimeout(() => {
    answerCall(call);
  }, 2000);

  call.on("close", () => {
    clearTimeout(timer);
    handleCallEnd();
  });
};

// Инициализация PeerJS
const initPeer = async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.value = "❌ WebRTC не поддерживается в этом браузере";
      isPeerLoading.value = false;
      return;
    }

    if (location.protocol === "http:" && location.hostname !== "localhost") {
      status.value = "⚠️ Требуется HTTPS для работы WebRTC";
      isPeerLoading.value = false;
      return;
    }

    status.value = "🔄 Инициализация P2P соединения...";

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
      myId.value = id;
      isPeerLoading.value = false;
      status.value = "🟢 Готов к звонкам";
    });

    peerInstance.on("call", handleIncomingCall);

    peerInstance.on("error", (error) => {
      console.error("❌ PeerJS Error:", error);

      if (error.type === "unavailable-id") {
        const newId = generateRandomId();
        console.log("🔄 ID занят, пробуем новый:", newId);
        setTimeout(initPeer, 500);
        return;
      }

      status.value = `Ошибка P2P: ${error.message}`;
      isPeerLoading.value = false;
    });

    peerInstance.on("disconnected", () => {
      console.log("🔌 Peer disconnected");
      status.value = "Соединение потеряно, переподключение...";
      setTimeout(() => {
        if (peerInstance && !peerInstance.destroyed) {
          peerInstance.reconnect();
        }
      }, 1000);
    });

    peer.value = peerInstance;
  } catch (error) {
    console.error("❌ Failed to initialize peer:", error);
    status.value = "Ошибка инициализации P2P";
    isPeerLoading.value = false;
  }
};

// Получение медиа потока
const getLocalStream = async (): Promise<MediaStream> => {
  if (localStreamRef) {
    return localStreamRef;
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

    localStreamRef = stream;
    console.log("🎤 Local stream obtained");

    setupAudioAnalyser(stream);

    return stream;
  } catch (error) {
    console.error("❌ Error getting user media:", error);

    if (error instanceof Error) {
      switch (error.name) {
        case "NotAllowedError":
          throw new Error("Разрешите доступ к микрофону в настройках браузера");
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

    audioContextRef = audioContext;
    analyserRef = analyser;

    startAudioLevelMonitoring();
  } catch (error) {
    console.warn("⚠️ Could not setup audio analyser:", error);
  }
};

// Мониторинг уровня аудио
const startAudioLevelMonitoring = () => {
  const updateLevel = () => {
    if (analyserRef && localStreamRef && !callState.isMuted) {
      const dataArray = new Uint8Array(analyserRef.frequencyBinCount);
      analyserRef.getByteFrequencyData(dataArray);

      const average =
        dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
      audioLevel.value = average / 255;
    }

    if (callState.isConnected || localStreamRef) {
      animationRef = requestAnimationFrame(updateLevel);
    }
  };

  updateLevel();
};

// Начать звонок
const startCall = async () => {
  if (!peer.value || peer.value.destroyed) {
    status.value = "❌ P2P соединение не готово";
    return;
  }

  if (!remoteId.value.trim()) {
    alert("Введите ID собеседника");
    return;
  }

  try {
    callState.isCalling = true;
    status.value = "🎤 Получение доступа к микрофону...";

    const stream = await getLocalStream();
    status.value = "🔄 Подключение к собеседнику...";

    if (!peer.value || peer.value.destroyed) {
      throw new Error("P2P соединение потеряно");
    }

    const call = peer.value.call(remoteId.value.trim(), stream);

    if (!call) {
      throw new Error("Не удалось создать звонок");
    }

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
      status.value = `Ошибка звонка: ${error.message}`;
      handleCallEnd();
    });

    currentCallRef = call;
    callState.isConnected = true;
    callState.isCalling = false;
    status.value = "✅ Соединение установлено";
  } catch (error) {
    console.error("❌ Error starting call:", error);
    status.value =
      error instanceof Error ? error.message : "Ошибка начала звонка";
    callState.isCalling = false;
  }
};

// Ответить на звонок
const answerCall = async (call: MediaConnection) => {
  try {
    status.value = "🎤 Получение доступа к микрофону...";
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

    currentCallRef = call;
    callState.isConnected = true;
    callState.isReceivingCall = false;
    callState.incomingCallId = null;
    status.value = "✅ Соединение установлено";
  } catch (error) {
    console.error("❌ Error answering call:", error);
    status.value =
      error instanceof Error ? error.message : "Ошибка ответа на звонок";
    callState.isReceivingCall = false;
    callState.incomingCallId = null;
  }
};

// Обработка удаленного аудио потока
const handleRemoteStream = (remoteStream: MediaStream) => {
  console.log("🔊 Setting remote stream");
  nextTick(() => {
    if (remoteAudioRef.value) {
      remoteAudioRef.value.srcObject = remoteStream;
      remoteAudioRef.value.volume = 1.0;

      remoteAudioRef.value.play().catch((error) => {
        console.error("❌ Error playing remote audio:", error);
        setTimeout(() => {
          if (remoteAudioRef.value) {
            remoteAudioRef.value.play().catch(console.error);
          }
        }, 100);
      });
    }
  });
};

// Завершение звонка
const handleCallEnd = () => {
  console.log("📞 Ending call");

  if (animationRef) {
    cancelAnimationFrame(animationRef);
    animationRef = null;
  }

  if (audioContextRef) {
    audioContextRef.close();
    audioContextRef = null;
  }

  if (currentCallRef) {
    currentCallRef.close();
    currentCallRef = null;
  }

  if (localStreamRef) {
    localStreamRef.getTracks().forEach((track) => {
      track.stop();
      console.log("⏹️ Stopped track:", track.kind);
    });
    localStreamRef = null;
  }

  if (remoteAudioRef.value) {
    remoteAudioRef.value.srcObject = null;
  }

  Object.assign(callState, {
    isConnected: false,
    isCalling: false,
    isMuted: false,
    isReceivingCall: false,
    incomingCallId: null,
  });
  audioLevel.value = 0;
  status.value = "📴 Звонок завершен";

  setTimeout(() => {
    status.value = "🟢 Готов к звонкам";
  }, 2000);
};

// Переключение звука
const toggleMute = () => {
  if (localStreamRef) {
    const audioTrack = localStreamRef.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const newMutedState = !audioTrack.enabled;
      callState.isMuted = newMutedState;
      console.log("🔇 Muted:", newMutedState);
    }
  }
};

// Копирование ID в буфер обмена
const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(myId.value);
    status.value = "📋 ID скопирован!";
    setTimeout(() => (status.value = "🟢 Готов к звонкам"), 2000);
  } catch (error) {
    console.error("❌ Clipboard error:", error);
    const textArea = document.createElement("textarea");
    textArea.value = myId.value;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    status.value = "📋 ID скопирован!";
    setTimeout(() => (status.value = "🟢 Готов к звонкам"), 2000);
  }
};

// Настройка audio элемента
onMounted(() => {
  nextTick(() => {
    if (remoteAudioRef.value) {
      remoteAudioRef.value.volume = 1.0;
    }
  });
  initPeer();
});

// Очистка при размонтировании
onUnmounted(() => {
  if (animationRef) {
    cancelAnimationFrame(animationRef);
  }
  if (audioContextRef) {
    audioContextRef.close();
  }
  if (peer.value && !peer.value.destroyed) {
    peer.value.destroy();
  }
  if (localStreamRef) {
    localStreamRef.getTracks().forEach((track) => track.stop());
  }
});
</script>

<style>
/* Базовые стили - добавь сюда минимальные стили по желанию */
.audio-call {
  padding: 20px;
}

.call-container {
  max-width: 500px;
  margin: 0 auto;
}

.loading-indicator {
  text-align: center;
  padding: 20px;
}

.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 2s linear infinite;
  margin: 0 auto 10px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.connection-info {
  margin: 20px 0;
}

.id-section,
.remote-id-section {
  margin: 15px 0;
}

.call-controls {
  margin: 20px 0;
  text-align: center;
}

.call-btn {
  margin: 5px;
  padding: 10px 20px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}

.call-btn.primary {
  background: #4caf50;
  color: white;
}

.call-btn.danger {
  background: #f44336;
  color: white;
}

.call-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.audio-level-indicator {
  margin: 15px 0;
}

.audio-level-bar {
  height: 10px;
  background: #ddd;
  border-radius: 5px;
  overflow: hidden;
}

.audio-level-fill {
  height: 100%;
  background: #4caf50;
  transition: width 0.1s;
}

.status {
  text-align: center;
  margin: 20px 0;
}

.connection-indicator {
  color: green;
}

.indicator-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  background: green;
  border-radius: 50%;
  margin-right: 5px;
}

.incoming-call {
  text-align: center;
  color: #ff6b35;
}

.pulse-indicator {
  width: 20px;
  height: 20px;
  background: #ff6b35;
  border-radius: 50%;
  margin: 0 auto 10px;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.7;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
