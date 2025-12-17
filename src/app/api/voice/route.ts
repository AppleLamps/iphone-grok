/**
 * Grok Voice API Route
 *
 * IMPORTANT: WebSocket-based real-time voice streaming is NOT supported
 * by Vercel Serverless Functions. This is a fundamental limitation of
 * serverless architecture (functions are stateless and short-lived).
 *
 * OPTIONS FOR REAL-TIME VOICE:
 *
 * 1. LOCAL DEVELOPMENT (works with custom server):
 *    - Run: `npm run dev:voice` (after setting up custom server)
 *    - Or use the standalone relay server
 *
 * 2. PRODUCTION ON VERCEL:
 *    - Deploy the voice relay to a service that supports WebSockets:
 *      - Fly.io (free tier available)
 *      - Render (free tier available)
 *      - Railway
 *      - Your own VPS
 *    - Set NEXT_PUBLIC_VOICE_RELAY_URL to point to your relay
 *
 * 3. ALTERNATIVE ARCHITECTURE:
 *    - Use Vercel for the UI only
 *    - Use a dedicated voice server elsewhere
 *
 * This file provides a configuration endpoint and helpful error messages.
 */

import { NextRequest, NextResponse } from "next/server";

// Configuration
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const XAI_VOICE = process.env.XAI_VOICE || "ara";
const XAI_INSTRUCTIONS =
  process.env.XAI_INSTRUCTIONS ||
  "You are a helpful voice assistant named Grok. Keep your responses concise and conversational since this is a voice call. Be friendly and engaging.";

// Check if we're running on Vercel
const isVercel = process.env.VERCEL === "1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voice
 * Returns configuration and status information
 */
export async function GET(request: NextRequest) {
  const upgradeHeader = request.headers.get("upgrade");

  // If this is a WebSocket upgrade request
  if (upgradeHeader === "websocket") {
    // WebSocket is not supported in Vercel Serverless
    if (isVercel) {
      return NextResponse.json(
        {
          error: "WebSocket not supported",
          message:
            "Vercel Serverless Functions do not support WebSocket connections. " +
            "For real-time voice, please deploy a dedicated voice relay server.",
          solutions: [
            "Deploy voice relay to Fly.io (free tier): https://fly.io",
            "Deploy voice relay to Render (free tier): https://render.com",
            "Set NEXT_PUBLIC_VOICE_RELAY_URL environment variable to your relay URL",
          ],
          docs: "See grok/grok-voice-relay for a ready-to-deploy relay server",
        },
        { status: 501 },
      );
    }

    // For local development, return instructions
    return NextResponse.json(
      {
        error: "WebSocket upgrade not available",
        message:
          "Next.js App Router API routes do not support WebSocket upgrade. " +
          "For local development with WebSocket, use the standalone voice relay server.",
        localDev: {
          instructions: [
            "1. cd grok/grok-voice-relay",
            "2. cp .env.example .env",
            "3. Add your XAI_API_KEY to .env",
            "4. npm install && npm run dev",
            "5. Set NEXT_PUBLIC_VOICE_RELAY_URL=http://localhost:8787 in .env.local",
          ],
        },
      },
      { status: 501 },
    );
  }

  // Regular GET request - return configuration/status
  return NextResponse.json({
    status: "ok",
    service: "Grok Voice",
    configured: Boolean(XAI_API_KEY),
    voice: XAI_VOICE,
    environment: isVercel ? "vercel" : "local",
    websocketSupported: false,
    message: isVercel
      ? "Running on Vercel. WebSocket requires external relay server."
      : "Running locally. Use standalone relay server for WebSocket support.",
    setup: {
      hasApiKey: Boolean(XAI_API_KEY),
      voice: XAI_VOICE,
      instructionsConfigured: XAI_INSTRUCTIONS !== "",
    },
    recommendations: isVercel
      ? [
          "Deploy grok-voice-relay to Fly.io or Render",
          "Set NEXT_PUBLIC_VOICE_RELAY_URL in Vercel environment variables",
        ]
      : [
          "Run the voice relay server locally: cd grok/grok-voice-relay && npm run dev",
          "Create .env.local with NEXT_PUBLIC_VOICE_RELAY_URL=ws://localhost:8787",
        ],
  });
}

/**
 * POST /api/voice
 * Could be used for non-realtime voice interactions (not implemented)
 */
export async function POST(request: NextRequest) {
  if (!XAI_API_KEY) {
    return NextResponse.json(
      { error: "XAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      error: "Not implemented",
      message:
        "Real-time voice requires WebSocket connections. " +
        "This endpoint could be extended for non-realtime voice (e.g., upload audio file, get response). " +
        "For real-time voice calls, use the WebSocket relay server.",
    },
    { status: 501 },
  );
}

/**
 * OPTIONS /api/voice
 * CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
