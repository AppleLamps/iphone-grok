import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "XAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const voice = process.env.XAI_VOICE || "ara";
  const instructions =
    process.env.XAI_INSTRUCTIONS ||
    "You are a helpful voice assistant named Grok. Keep your responses concise and conversational since this is a voice call. Be friendly and engaging.";

  try {
    const response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expires_after: { seconds: 300 } }),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: "Failed to create session", details: errorText },
        { status: response.status },
      );
    }

    const data = (await response.json()) as { value: string; expires_at: number };

    return NextResponse.json({
      client_secret: {
        value: data.value,
        expires_at: data.expires_at,
      },
      server_time_iso: new Date().toISOString(),
      voice,
      instructions,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to create session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
