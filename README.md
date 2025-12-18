# Grok Voice

A real-time voice assistant application powered by [xAI's Grok Realtime API](https://x.ai/). Features a polished iPhone-inspired interface for natural voice conversations with Grok AI.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Overview

Grok Voice provides a seamless voice conversation experience with xAI's Grok model. The application establishes a WebSocket connection to the Grok Realtime API, enabling bidirectional audio streaming with low latency. The interface mimics an iPhone call screen, complete with a Dynamic Island indicator, call controls, and live transcription.

### Key Features

- **Real-Time Voice Streaming** — Bidirectional audio via WebSocket with server-side VAD (Voice Activity Detection)
- **Live Transcription** — Real-time speech-to-text for both user and assistant utterances
- **iPhone-Style UI** — Authentic iOS call interface with Dynamic Island, status bar, and glassmorphism effects
- **Web & X Search** — Grok can search the web and X (Twitter) for up-to-date information
- **Call Controls** — Mute microphone and toggle speaker output
- **Customizable Personality** — Configure Grok's voice and behavior via environment variables
- **Responsive Design** — Optimized for desktop and mobile viewports

---

## Prerequisites

- **Node.js** 18.x or later
- **xAI API Key** — Obtain from [x.ai](https://x.ai/)
- **Modern Browser** — Chrome, Firefox, Safari, or Edge with WebRTC support

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/iphone-voice-site.git
cd iphone-voice-site
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env.local` file in the project root:

```bash
# Required
XAI_API_KEY=your_xai_api_key_here

# Optional: Voice selection (default: ara)
XAI_VOICE=ara

# Optional: Custom system prompt
XAI_INSTRUCTIONS=You are a helpful voice assistant named Grok. Keep your responses concise and conversational since this is a voice call. Be friendly and engaging.
```

### 4. Start the Development Server

```bash
npm run dev
```

### 5. Open the Application

Navigate to [http://localhost:3000](http://localhost:3000) and grant microphone access when prompted.

---

## Project Structure

```text
iphone-voice-site/
├── src/
│   └── app/
│       ├── api/
│       │   ├── session/
│       │   │   └── route.ts      # Ephemeral token generation
│       │   └── voice/
│       │       └── route.ts      # Voice configuration endpoint
│       ├── globals.css           # Global styles & animations
│       ├── layout.tsx            # Root layout with fonts
│       └── page.tsx              # Main voice interface
├── public/                       # Static assets
├── .env.local                    # Environment variables (create this)
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## Architecture

### Client-Side Audio Pipeline

1. **Microphone Capture** — Web Audio API with `AudioWorklet` for low-latency PCM capture
2. **Audio Processing** — Real-time conversion to PCM16 format at native sample rate
3. **WebSocket Transport** — Base64-encoded audio chunks sent to Grok Realtime API
4. **Playback** — Incoming audio queued and played via `AudioBufferSourceNode`

### Server-Side Components

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session` | POST | Generates ephemeral client secrets for secure WebSocket authentication |
| `/api/voice` | GET | Returns service configuration and status |

### WebSocket Events

The application handles the following Grok Realtime API events:

| Event | Description |
|-------|-------------|
| `conversation.created` | Session initialized, sends configuration |
| `session.updated` | Configuration confirmed, starts audio capture |
| `response.output_audio.delta` | Incoming audio chunk from Grok |
| `response.output_audio_transcript.delta` | Assistant transcription update |
| `conversation.item.input_audio_transcription.completed` | User transcription complete |
| `input_audio_buffer.speech_started` | VAD detected speech start |
| `input_audio_buffer.speech_stopped` | VAD detected speech end |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XAI_API_KEY` | ✅ Yes | — | Your xAI API key for authentication |
| `XAI_VOICE` | No | `ara` | Voice model to use for responses |
| `XAI_INSTRUCTIONS` | No | (see below) | System prompt defining Grok's personality |

**Default Instructions:**
> You are a helpful voice assistant named Grok. Keep your responses concise and conversational since this is a voice call. Be friendly and engaging.

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| [Next.js](https://nextjs.org/) | 16.x | React framework with App Router |
| [React](https://react.dev/) | 19.x | UI library |
| [Tailwind CSS](https://tailwindcss.com/) | 4.x | Utility-first styling |
| [TypeScript](https://www.typescriptlang.org/) | 5.x | Type safety |
| [xAI Realtime API](https://x.ai/) | — | Voice AI via WebSocket |
| [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) | — | Audio capture & playback |

---

## Deployment

### Vercel (Recommended for UI)

```bash
npm run build
vercel deploy
```

> **Note:** Vercel Serverless Functions do not support persistent WebSocket connections. The current implementation uses client-side WebSocket connections directly to the xAI API with ephemeral tokens, which works on Vercel.

### Other Platforms

The application can be deployed to any Node.js hosting platform:

- **Railway**
- **Render**
- **Fly.io**
- **AWS / GCP / Azure**

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build production bundle |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

---

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome 90+ | ✅ Full |
| Firefox 90+ | ✅ Full |
| Safari 15+ | ✅ Full |
| Edge 90+ | ✅ Full |

Requires `getUserMedia` and `AudioWorklet` support.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Acknowledgments

- [xAI](https://x.ai/) for the Grok Realtime API
- [Vercel](https://vercel.com/) for Next.js and hosting infrastructure
