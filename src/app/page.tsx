"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";

type CallState = "idle" | "connecting" | "in_call" | "ended" | "error";

// xAI Realtime WebSocket URL
const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function buildSessionInstructions(baseInstructions: string, serverTimeIso?: string) {
  const nowIso = serverTimeIso || new Date().toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = [
    `Current date/time: ${nowIso} (${tz}).`,
    "For requests about current events/news or other time-sensitive information, use web_search and/or x_search as needed (x_search is often better for very recent/breaking items).",
    baseInstructions || "",
  ].filter(Boolean);
  return parts.join("\n");
}

export default function Page() {
  const [callState, setCallState] = useState<CallState>("idle");
  const [statusLine, setStatusLine] = useState<string>("Ready");
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  const [transcriptLines, setTranscriptLines] = useState<
    Array<{ role: "user" | "assistant"; text: string }>
  >([]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const isSessionConfiguredRef = useRef(false);
  const sessionConfigRef = useRef<
    { voice: string; instructions: string; sampleRate: number } | null
  >(null);

  const inCall = callState === "in_call" || callState === "connecting";

  // Timer for call duration
  useEffect(() => {
    if (callState !== "in_call" || callStartedAt == null) return;
    const id = setInterval(() => {
      const s = Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000));
      setSeconds(s);
    }, 500);
    return () => clearInterval(id);
  }, [callState, callStartedAt]);

  const title = useMemo(() => {
    if (callState === "idle") return "Grok Voice";
    if (callState === "connecting") return "Connecting…";
    if (callState === "in_call") return "Grok Voice";
    if (callState === "ended") return "Call Ended";
    return "Error";
  }, [callState]);

  function pushLog(line: string) {
    console.log(`[Grok] ${new Date().toISOString().slice(11, 19)} ${line}`);
  }

  // Convert base64 to Float32Array (PCM16 24kHz)
  function base64ToFloat32(base64: string): Float32Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    return float32;
  }

  // Convert Float32Array to base64 (PCM16)
  function float32ToBase64(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 32768 : s * 32767;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Play audio from queue
  const playAudioQueue = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const audioData = audioQueueRef.current.shift()!;

    const buffer = ctx.createBuffer(1, audioData.length, ctx.sampleRate);
    buffer.getChannelData(0).set(audioData);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;

    source.onended = () => {
      if (audioQueueRef.current.length > 0) {
        playAudioQueue();
      } else {
        isPlayingRef.current = false;
      }
    };
  }, []);

  // Queue audio for playback
  const queueAudio = useCallback(
    (base64: string) => {
      if (!speaker) return;
      const audioData = base64ToFloat32(base64);
      audioQueueRef.current.push(audioData);
      if (!isPlayingRef.current) {
        playAudioQueue();
      }
    },
    [speaker, playAudioQueue],
  );

  // Start the call
  async function startCall() {
    setErrorText(null);
    setTranscriptLines([]);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCallState("error");
      setStatusLine("Unsupported browser");
      setErrorText("This browser does not support getUserMedia.");
      return;
    }

    setCallState("connecting");
    setStatusLine("Requesting microphone…");
    pushLog("Requesting microphone access...");

    try {
      // Create AudioContext for playback and capture (use browser native sample rate)
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Resume audio context (required by some browsers)
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const nativeSampleRate = audioContext.sampleRate;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: nativeSampleRate,
        },
        video: false,
      });
      mediaStreamRef.current = stream;
      pushLog("Microphone access granted");

      setStatusLine("Creating session…");
      pushLog("Requesting ephemeral token...");

      const sessionResponse = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const sessionData = (await sessionResponse.json()) as {
        client_secret?: { value: string; expires_at: number };
        server_time_iso?: string;
        voice?: string;
        instructions?: string;
        error?: string;
        details?: string;
      };

      if (!sessionResponse.ok || !sessionData.client_secret?.value) {
        const details =
          sessionData.details || sessionData.error || "Failed to create session";
        throw new Error(details);
      }

      sessionConfigRef.current = {
        voice: sessionData.voice || "ara",
        instructions: buildSessionInstructions(
          sessionData.instructions || "",
          sessionData.server_time_iso,
        ),
        sampleRate: nativeSampleRate,
      };
      isSessionConfiguredRef.current = false;

      setStatusLine("Connecting to Grok…");
      pushLog(`Connecting to ${XAI_REALTIME_URL}`);

      const ws = new WebSocket(XAI_REALTIME_URL, [
        "realtime",
        `openai-insecure-api-key.${sessionData.client_secret.value}`,
        "openai-beta.realtime-v1",
      ]);
      wsRef.current = ws;

      ws.onopen = () => {
        pushLog("WebSocket connected to XAI");
        setStatusLine("Connected, initializing…");
      };

      ws.onmessage = (event) => {
        try {
          const parsed: unknown = JSON.parse(event.data);
          if (!isRecord(parsed)) return;

          const type = getStringField(parsed, "type");
          if (!type) {
            return;
          }

          if (
            type !== "response.output_audio.delta" &&
            type !== "input_audio_buffer.append"
          ) {
            pushLog(`Event: ${type}`);
          }

          switch (type) {
            case "conversation.created": {
              if (!sessionConfigRef.current) break;
              const { voice, instructions, sampleRate } =
                sessionConfigRef.current;

              pushLog(
                `Sending session.update (voice=${voice}, instructionsChars=${instructions.length})`,
              );

              ws.send(
                JSON.stringify({
                  type: "session.update",
                  session: {
                    instructions,
                    voice,
                    tools: [{ type: "web_search" }, { type: "x_search" }],
                    audio: {
                      input: { format: { type: "audio/pcm", rate: sampleRate } },
                      output: { format: { type: "audio/pcm", rate: sampleRate } },
                    },
                    turn_detection: { type: "server_vad" },
                    input_audio_transcription: { model: "grok-2-public" },
                  },
                }),
              );
              break;
            }

            case "session.updated": {
              if (isSessionConfiguredRef.current) break;
              isSessionConfiguredRef.current = true;

              setCallState("in_call");
              setCallStartedAt(Date.now());
              setSeconds(0);
              setStatusLine("In call");

              ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
              ws.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "message",
                    role: "user",
                    content: [
                      {
                        type: "input_text",
                        text: "Hello! Please greet me briefly and let me know you're ready to chat.",
                      },
                    ],
                  },
                }),
              );
              ws.send(JSON.stringify({ type: "response.create" }));

              startAudioCapture();
              break;
            }

            case "response.output_audio.delta": {
              const delta = getStringField(parsed, "delta");
              if (delta) {
                queueAudio(delta);
              }
              break;
            }

            case "response.output_audio_transcript.delta": {
              const delta = getStringField(parsed, "delta");
              if (delta) {
                setTranscriptLines((prev) => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === "assistant") {
                    return [
                      ...prev.slice(0, -1),
                      { role: "assistant", text: last.text + delta },
                    ];
                  }
                  return [
                    ...prev,
                    { role: "assistant", text: delta },
                  ];
                });
              }
              break;
            }

            case "conversation.item.input_audio_transcription.completed": {
              const transcript = getStringField(parsed, "transcript");
              if (transcript) {
                setTranscriptLines((prev) => [
                  ...prev,
                  { role: "user", text: transcript },
                ]);
              }
              break;
            }

            case "input_audio_buffer.speech_started":
              setStatusLine("Listening…");
              break;

            case "input_audio_buffer.speech_stopped":
              setStatusLine("Processing…");
              break;

            case "response.created":
              setStatusLine("Grok is speaking…");
              break;

            case "response.done":
              setStatusLine("In call");
              break;

            case "error": {
              const errorRaw = parsed["error"];
              const errorMsg =
                (isRecord(errorRaw) && getStringField(errorRaw, "message")) ||
                "Unknown error from xAI";
              pushLog(`Error: ${errorMsg}`);
              setErrorText(errorMsg);
              break;
            }
          }
        } catch (err) {
          pushLog(`Parse error: ${err}`);
        }
      };

      ws.onerror = (err) => {
        pushLog(`WebSocket error: ${err}`);
        setCallState("error");
        setStatusLine("Connection error");
        setErrorText("Failed to connect to voice service");
      };

      ws.onclose = (event) => {
        pushLog(
          `WebSocket closed (code=${event.code}${event.reason ? `, reason=${event.reason}` : ""})`,
        );
        if (wsRef.current === ws) {
          stopCall(true);
        }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushLog(`Error: ${message}`);
      setCallState("error");
      setStatusLine("Failed to connect");
      setErrorText(message);
      stopCall(true);
    }
  }

  // Start capturing and sending audio
  async function startAudioCapture() {
    const audioContext = audioContextRef.current;
    const stream = mediaStreamRef.current;
    const ws = wsRef.current;

    if (!audioContext || !stream || !ws) return;

    try {
      const chunkSizeSamples = Math.max(1, Math.round(audioContext.sampleRate / 10));

      // Load audio worklet for processing
      const workletCode = `
        class AudioProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.buffer = [];
            this.bufferSize = ${chunkSizeSamples};
          }

          process(inputs) {
            const input = inputs[0];
            if (input && input[0]) {
              this.buffer.push(...input[0]);

              while (this.buffer.length >= this.bufferSize) {
                const chunk = this.buffer.splice(0, this.bufferSize);
                this.port.postMessage({ audio: new Float32Array(chunk) });
              }
            }
            return true;
          }
        }
        registerProcessor('audio-processor', AudioProcessor);
      `;

      const blob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);

      await audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, "audio-processor");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event) => {
        if (
          ws.readyState === WebSocket.OPEN &&
          !muted &&
          isSessionConfiguredRef.current
        ) {
          const audioData = event.data.audio as Float32Array;
          const base64 = float32ToBase64(audioData);
          ws.send(
            JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }),
          );
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);
      pushLog("Audio capture started");
    } catch (err) {
      pushLog(`Audio capture error: ${err}`);
    }
  }

  // Stop the call
  async function stopCall(silent = false) {
    const ws = wsRef.current;
    const stream = mediaStreamRef.current;
    const audioContext = audioContextRef.current;
    const workletNode = workletNodeRef.current;

    wsRef.current = null;
    mediaStreamRef.current = null;
    audioContextRef.current = null;
    workletNodeRef.current = null;
    isSessionConfiguredRef.current = false;
    sessionConfigRef.current = null;

    // Clear audio queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;

    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch {}

    try {
      workletNode?.disconnect();
    } catch {}

    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {}

    try {
      await audioContext?.close();
    } catch {}

    setCallStartedAt(null);
    setSeconds(0);
    setMuted(false);

    if (!silent) {
      setCallState("ended");
      setStatusLine("Call ended");
      pushLog("Call ended");
      setTimeout(() => {
        setCallState("idle");
        setStatusLine("Ready");
      }, 1500);
    }
  }

  function toggleMute() {
    setMuted((m) => {
      pushLog(m ? "Unmuted" : "Muted");
      return !m;
    });
  }

  function toggleSpeaker() {
    setSpeaker((s) => {
      if (s) {
        // Turning off - clear queue
        audioQueueRef.current = [];
      }
      pushLog(s ? "Speaker off" : "Speaker on");
      return !s;
    });
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCall(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 p-4 sm:p-6 text-zinc-100">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6">
        {/* iPhone frame */}
        <div className="relative w-full max-w-[375px]">
          <div className="relative rounded-[50px] bg-zinc-950 p-3 shadow-2xl ring-1 ring-white/10">
            <div className="rounded-[38px] bg-black overflow-hidden">
              {/* Dynamic Island */}
              <div className="absolute left-1/2 top-3 z-20 h-8 w-28 -translate-x-1/2 rounded-full bg-black" />

              {/* Screen */}
              <div className="relative h-[812px] bg-black text-white flex flex-col">
                {/* Status bar */}
                <div className="flex items-center justify-between px-8 pt-4 text-[12px] font-medium text-zinc-400">
                  <div>9:41</div>
                  <div className="flex items-center gap-1.5">
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3C8.5 3 5.4 4.6 3.3 7.1L12 18l8.7-10.9C18.6 4.6 15.5 3 12 3z" />
                    </svg>
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M2 17h2v4H2v-4zm4-5h2v9H6v-9zm4-4h2v13h-2V8zm4-4h2v17h-2V4zm4 7h2v10h-2V11z" />
                    </svg>
                    <div className="ml-1 flex h-4 w-7 items-center rounded-sm border border-zinc-500 px-0.5">
                      <div className="h-2.5 w-4 rounded-sm bg-zinc-400" />
                    </div>
                  </div>
                </div>

                {/* Top section - Avatar and status */}
                <div className="pt-8 pb-4 text-center">
                  {/* Avatar */}
                  <div className="mx-auto mb-4">
                    <div
                      className={cx(
                        "relative mx-auto flex h-24 w-24 items-center justify-center rounded-full transition-all duration-300",
                        callState === "in_call"
                          ? "bg-emerald-500/20 ring-4 ring-emerald-500/40 shadow-lg shadow-emerald-500/20"
                          : callState === "connecting"
                            ? "bg-blue-500/20 ring-4 ring-blue-500/40 animate-pulse"
                            : "bg-zinc-800 ring-2 ring-zinc-700",
                      )}
                    >
                      <div className="text-4xl">🤖</div>
                      {callState === "in_call" && (
                        <div className="absolute -inset-1 rounded-full animate-pulse bg-emerald-500/10" />
                      )}
                    </div>
                  </div>
                  
                  {/* Name and status */}
                  <h1 className="text-2xl font-semibold">{title}</h1>
                  <p className={cx(
                    "mt-1 text-sm",
                    callState === "in_call" ? "text-emerald-400 font-mono" : "text-zinc-500"
                  )}>
                    {callState === "in_call" ? formatDuration(seconds) : statusLine}
                  </p>
                </div>

                {/* Error display */}
                {callState === "error" && errorText && (
                  <div className="mx-4 mb-2 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
                    {errorText}
                  </div>
                )}

                {/* Transcript area - takes remaining space */}
                <div className="flex-1 mx-4 mb-4 overflow-hidden flex flex-col">
                  {/* Copy button */}
                  {transcriptLines.length > 0 && (
                    <button
                      onClick={() => {
                        const text = transcriptLines
                          .map((l) => `${l.role === "user" ? "You" : "Grok"}: ${l.text}`)
                          .join("\n");
                        navigator.clipboard.writeText(text);
                      }}
                      className="self-end mb-2 px-3 py-1.5 text-xs text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </button>
                  )}
                  <div className="flex-1 overflow-y-auto rounded-2xl bg-zinc-900/80 border border-zinc-800 p-4">
                    {transcriptLines.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-zinc-600 text-sm">
                          {callState === "in_call" ? "Listening..." : "Tap the call button to start"}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {transcriptLines.slice(-12).map((line, i) => (
                          <div
                            key={i}
                            className={cx(
                              "flex",
                              line.role === "user" ? "justify-end" : "justify-start",
                            )}
                          >
                            <div
                              className={cx(
                                "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                                line.role === "user"
                                  ? "bg-emerald-600 text-white"
                                  : "bg-zinc-800 text-zinc-100",
                              )}
                            >
                              {line.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom controls */}
                <div className="pb-8 px-6">
                  {/* Mute/Speaker row */}
                  <div className="flex justify-center gap-8 mb-6">
                    <button
                      className={cx(
                        "flex h-14 w-14 items-center justify-center rounded-full transition-all",
                        inCall
                          ? muted
                            ? "bg-red-500 text-white"
                            : "bg-zinc-800 text-white hover:bg-zinc-700"
                          : "bg-zinc-900 text-zinc-600",
                      )}
                      onClick={toggleMute}
                      disabled={!inCall}
                    >
                      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {muted ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z M3 3l18 18" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        )}
                      </svg>
                    </button>

                    <button
                      className={cx(
                        "flex h-14 w-14 items-center justify-center rounded-full transition-all",
                        inCall
                          ? !speaker
                            ? "bg-red-500 text-white"
                            : "bg-zinc-800 text-white hover:bg-zinc-700"
                          : "bg-zinc-900 text-zinc-600",
                      )}
                      onClick={toggleSpeaker}
                      disabled={!inCall}
                    >
                      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {!speaker ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        )}
                      </svg>
                    </button>
                  </div>

                  {/* Main call button */}
                  <div className="flex justify-center">
                    {callState === "idle" || callState === "ended" || callState === "error" ? (
                      <button
                        className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30 transition-all hover:bg-emerald-400 hover:scale-105 active:scale-95"
                        onClick={startCall}
                      >
                        <svg className="h-7 w-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/30 transition-all hover:bg-red-400 hover:scale-105 active:scale-95"
                        onClick={() => stopCall(false)}
                      >
                        <svg className="h-7 w-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 01-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.67-1.85.996.996 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Home indicator */}
                <div className="absolute bottom-2 left-1/2 h-1 w-32 -translate-x-1/2 rounded-full bg-white/20" />
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
