"use client";

import { createClient } from "@/utils/supabase/client";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function Room({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const cameraId = searchParams.get("cameraId");
  const router = useRouter();
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const pcRef: MutableRefObject<RTCPeerConnection | null> = useRef(null);
  const supabase = createClient();
  const [callId, setCallId] = useState<string>("");
  const iceServerUrl = process.env.NEXT_PUBLIC_ICESERVER_URL;

  useEffect(() => {
    setupSources();

    return () => {
      stopStreams(localRef.current);
      stopStreams(remoteRef.current);
    };
  }, []);

  const stopStreams = (videoElement: HTMLVideoElement | null) => {
    if (videoElement && videoElement.srcObject) {
      const stream = videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
  };

  async function setupIceServers() {
    if (!iceServerUrl) return;

    try {
      const response = await fetch(iceServerUrl);

      if (!response.ok) {
        throw new Error("Error");
      }

      const iceServers = await response.json();

      pcRef.current = new RTCPeerConnection({
        iceServers: iceServers,
        iceCandidatePoolSize: 10,
      });
    } catch (error) {
      console.error("Failed to fetch ICE server list:", error);
    }
  }

  const setupSources = async () => {
    await setupIceServers();
    if (!pcRef.current) return;

    const localStream = await navigator.mediaDevices.getUserMedia({
      video: cameraId ? { deviceId: cameraId } : true,
      audio: true,
    });
    const remoteStream = new MediaStream();

    localStream.getTracks().forEach((track) => {
      pcRef.current?.addTrack(track, localStream);
    });

    pcRef.current.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    };

    if (localRef.current) localRef.current.srcObject = localStream;
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;

    const localCallId = params.id === "start" ? await startCall() : await joinCall();

    if (!localCallId) return;

    setCallId(localCallId);

    setupRoomDeleteListener(localCallId);
  };

  async function startCall(): Promise<string | null> {
    const { data: createdCall, error } = await supabase.from("calls").insert({}).select().single();
    if (error) return null;

    setupOnIceCandidate(createdCall.id, "offerCandidates");
    await createAndSendOffer(createdCall.id);

    setupListener("calls", "calls", `id=eq.${createdCall.id}`, async (payload) => {
      if (payload.eventType === "UPDATE") {
        if (!pcRef.current!.currentRemoteDescription) {
          await setRemoteOffer({ sdp: payload.new.answer_sdp, type: payload.new.answer_type });
          setPrefetchedCandidates("answerCandidates", createdCall.id);
        }
      }
    });

    setupListener(
      "answerCandidates",
      "answerCandidates",
      `call_id=eq.${createdCall.id}`,
      async (payload) => {
        if (payload.eventType === "INSERT") {
          if (!pcRef.current!.currentRemoteDescription) return;
          pcRef.current!.addIceCandidate(new RTCIceCandidate(payload.new));
        }
      }
    );

    return createdCall.id.toString();
  }

  async function joinCall(): Promise<string | null> {
    const { data: call, error: callError } = await supabase
      .from("calls")
      .select("id, offer_sdp, offer_type")
      .eq("id", params.id)
      .single();

    if (callError || !call) {
      router.replace("/");
      return null;
    }

    setupOnIceCandidate(call.id, "answerCandidates");
    await setRemoteOffer({ sdp: call.offer_sdp, type: call.offer_type });
    await createAndSendAnswer(call.id);
    setPrefetchedCandidates("offerCandidates", call.id);

    setupListener(
      "offerCandidates",
      "offerCandidates",
      `call_id=eq.${call.id}`,
      async (payload) => {
        if (payload.eventType === "INSERT") {
          if (!pcRef.current!.currentRemoteDescription) return;
          pcRef.current!.addIceCandidate(new RTCIceCandidate(payload.new));
        }
      }
    );

    return call.id.toString();
  }

  const hangUp = async () => {
    pcRef.current!.close();

    await supabase.removeAllChannels();
    supabase.from("calls").delete().eq("id", params.id).then();
    supabase.from("offerCandidates").delete().eq("call_id", params.id).then();
    supabase.from("answerCandidates").delete().eq("call_id", params.id).then();

    stopStreams(localRef.current);
    stopStreams(remoteRef.current);

    router.replace("/");
  };

  function setupOnIceCandidate(localCallId: number, table: string) {
    pcRef.current!.onicecandidate = (event) => {
      event.candidate &&
        supabase
          .from(table)
          .insert({ ...event.candidate.toJSON(), call_id: localCallId })
          .then();
    };
  }

  async function setRemoteOffer(description: { sdp: string; type: RTCSdpType }) {
    const offerDescription = new RTCSessionDescription(description);
    await pcRef.current!.setRemoteDescription(offerDescription);
  }

  async function createAndSendOffer(localCallId: number) {
    const offerDescription = await pcRef.current!.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: true,
    });
    await pcRef.current!.setLocalDescription(offerDescription);
    await supabase
      .from("calls")
      .update({
        offer_sdp: offerDescription.sdp,
        offer_type: offerDescription.type,
      })
      .eq("id", localCallId);
  }

  async function createAndSendAnswer(localCallId: number) {
    const answerDescription = await pcRef.current!.createAnswer();
    await pcRef.current!.setLocalDescription(answerDescription);
    await supabase
      .from("calls")
      .update({
        answer_sdp: answerDescription.sdp,
        answer_type: answerDescription.type,
      })
      .eq("id", localCallId);
  }

  async function setPrefetchedCandidates(table: string, localCallId: number) {
    const { data: candidates, error } = await supabase
      .from(table)
      .select("candidate, sdpMLineIndex, sdpMid, usernameFragment")
      .eq("call_id", localCallId)
      .returns<
        {
          candidate: string;
          sdpMLineIndex: number;
          sdpMid: string;
          usernameFragment: string;
        }[]
      >();

    if (error) return null;

    candidates.forEach((candidate) => {
      pcRef.current!.addIceCandidate(new RTCIceCandidate(candidate));
    });
  }

  function setupListener(
    channelName: string,
    table: string,
    filter: string,
    callback: (payload: any) => void
  ) {
    supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, callback)
      .subscribe();
  }

  async function setupRoomDeleteListener(localCallId: string) {
    if (!pcRef.current) return;

    if (localCallId !== "") {
      setupListener("calls_delete", "calls", `id=eq.${localCallId}`, async (payload) => {
        payload.eventType === "DELETE" ? hangUp() : null;
      });
    }

    pcRef.current.onconnectionstatechange = () => {
      if (pcRef.current?.connectionState === "disconnected") {
        hangUp();
      }
    };
  }

  return (
    <div className="text-center p-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        <div className="text-center">
          <video
            className="-scale-x-100 w-full aspect-video border-2 rounded-xl bg-black"
            ref={localRef}
            autoPlay
            playsInline
            muted
          ></video>
          <p className="font-bold text-2xl">Local</p>
        </div>
        <div className="text-center">
          <video
            className="-scale-x-100 w-full aspect-video border-2 rounded-xl bg-black"
            ref={remoteRef}
            autoPlay
            playsInline
          ></video>
          <p className="font-bold text-2xl">Remote</p>
        </div>
      </div>
      {callId && <p className="mb-4">Call ID: {callId}</p>}
      <button
        className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
        onClick={hangUp}
      >
        Hang Up
      </button>
    </div>
  );
}
