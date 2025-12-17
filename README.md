# Grok Voice

A real-time voice assistant powered by xAI's Grok Realtime API. Features an iPhone-style UI for voice conversations with Grok.

## Features

- **Real-time voice conversations** with Grok via WebSocket
- **iPhone-style UI** with call controls (mute, speaker)
- **Live transcription** of both user and assistant speech
- **Web & X search** - Grok can search the web and X (Twitter) for current information
- **Customizable personality** via environment variables

## Setup

1. Clone the repository

2. Create `.env.local` with your xAI API key:

```bash
XAI_API_KEY=your_xai_api_key_here

# Optional: customize voice (default: ara)
XAI_VOICE=ara

# Optional: customize assistant personality
XAI_INSTRUCTIONS=You are a helpful voice assistant named Grok. Keep replies short and conversational.
```

3. Install dependencies and run:

```bash
npm install
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) and allow microphone access

## Tech Stack

- **Next.js 15** - React framework
- **xAI Grok Realtime API** - Voice AI via WebSocket
- **Tailwind CSS** - Styling
- **Web Audio API** - Real-time audio capture and playback

## API Routes

- `POST /api/session` - Creates an ephemeral token for client-side WebSocket connection

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `XAI_API_KEY` | Yes | Your xAI API key |
| `XAI_VOICE` | No | Voice to use (default: `ara`) |
| `XAI_INSTRUCTIONS` | No | System prompt for Grok's personality |

## License

MIT
