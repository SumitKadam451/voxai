import { and, eq, not } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  //CallEndedEvent,
  //CallTranscriptionReadyEvent,
  // CallRecordingReadyEvent,
  CallSessionParticipantLeftEvent,
  CallSessionStartedEvent,
} from "@stream-io/node-sdk";

import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { streamVideo } from "@/lib/stream-video";

function verifySignatureWithSDK(body: string, signature: string): boolean {
  return streamVideo.verifyWebhook(body, signature);
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-signature");
  const apiKey = req.headers.get("x-api-key");

  if (!signature || !apiKey) {
    return NextResponse.json(
      { error: "Missing Signature or API KEY" },
      { status: 400 },
    );
  }

  const body = await req.text();

  if (!verifySignatureWithSDK(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload?.type;

  console.log("Webhook hit:", eventType);

  // =========================
  // 🎯 CALL STARTED
  // =========================
  if (eventType === "call.session_started") {
    const event = payload as CallSessionStartedEvent;
    const meetingId = event.call?.custom?.meetingId;

    if (!meetingId) {
      return NextResponse.json({ error: "Missing MeetingId" }, { status: 400 });
    }

    // 🛑 ATOMIC UPDATE → prevents duplicates
    const updated = await db
      .update(meetings)
      .set({
        status: "active",
        startedAt: new Date(),
      })
      .where(
        and(
          eq(meetings.id, meetingId),
          not(eq(meetings.status, "active")), // only first request succeeds
        ),
      )
      .returning();

    // ❗ If already handled
    if (!updated || updated.length === 0) {
      console.log("Agent already started, skipping...");
      return NextResponse.json({ status: "already active" });
    }

    const existingMeeting = updated[0];

    const [existingAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, existingMeeting.agentId));

    if (!existingAgent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY");
    }

    const call = streamVideo.video.call("default", meetingId);

    const realtimeClient = await streamVideo.video.connectOpenAi({
      call,
      openAiApiKey: process.env.OPENAI_API_KEY,
      agentUserId: existingAgent.id,
    });

    realtimeClient.updateSession({
      instructions: existingAgent.instructions,
    });

    console.log("Agent started successfully");
  }

  // =========================
  // 👋 PARTICIPANT LEFT
  // =========================
  else if (eventType === "call.session_participant_left") {
    const event = payload as CallSessionParticipantLeftEvent;
    const meetingId = event.call_cid?.split(":")?.[1];

    if (!meetingId) {
      return NextResponse.json({ error: "Missing MeetingID" }, { status: 400 });
    }

    const call = streamVideo.video.call("default", meetingId);

    await call.end();

    console.log("Call ended");
  }

  return NextResponse.json({ status: "ok" });
}
