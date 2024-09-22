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

  useEffect(() => {
    setupSources();

    return () => {
      if (localRef.current && localRef.current.srcObject) {
        const stream = localRef.current.srcObject as MediaStream;
        const tracks = stream.getTracks();
        tracks.forEach((track) => track.stop());
      }

      if (remoteRef.current && remoteRef.current.srcObject) {
        const stream = remoteRef.current.srcObject as MediaStream;
        const tracks = stream.getTracks();
        tracks.forEach((track) => track.stop());
      }
    };
  }, []);

  const hangUp = async () => {
    pcRef.current?.close();

    if (params.id) {
      await supabase.removeAllChannels();
      await supabase.from("calls").delete().eq("id", params.id);
      await supabase.from("offerCandidates").delete().eq("call_id", params.id);
      await supabase.from("answerCandidates").delete().eq("call_id", params.id);
    }

    router.replace("/");
  };

  const setupSources = async () => {
    await setupIceServers();

    if (!pcRef.current) return;

    let callId = params.id ?? "";

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

    if (localRef.current) {
      localRef.current.srcObject = localStream;
    }

    if (remoteRef.current) {
      remoteRef.current.srcObject = remoteStream;
    }

    if (params.id == "start") {
      const { data: createdCallDoc, error } = await supabase
        .from("calls")
        .insert({})
        .select()
        .returns<
          {
            id: number;
          }[]
        >();

      if (error) {
        console.log(error);
        return;
      }

      const createdCall = createdCallDoc[0];
      setCallId(createdCall.id.toString());
      callId = createdCall.id.toString();

      pcRef.current.onicecandidate = (event) => {
        event.candidate &&
          supabase
            .from("offerCandidates")
            .insert({
              ...event.candidate.toJSON(),
              call_id: createdCall.id,
            })
            .then();
      };

      const offerDescription = await pcRef.current.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true,
      });
      await pcRef.current.setLocalDescription(offerDescription);

      const offer = {
        offer_sdp: offerDescription.sdp,
        offer_type: offerDescription.type,
      };

      await supabase.from("calls").update(offer).eq("id", createdCall.id);

      // listener for when the offer is answered
      const callsChannel = supabase
        .channel("calls")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "calls", filter: `id=eq.${createdCall.id}` },
          async (payload) => {
            if (pcRef.current && !pcRef.current.currentRemoteDescription) {
              const answerDescription = new RTCSessionDescription({
                sdp: payload.new.answer_sdp,
                type: payload.new.answer_type,
              });
              pcRef.current.setRemoteDescription(answerDescription);

              supabase.removeChannel(callsChannel);

              const { data: answerCandidates, error } = await supabase
                .from("answerCandidates")
                .select("candidate, sdpMLineIndex, sdpMid, usernameFragment")
                .eq("call_id", createdCall.id)
                .returns<
                  {
                    candidate: string;
                    sdpMLineIndex: number;
                    sdpMid: string;
                    usernameFragment: string;
                  }[]
                >();

              if (error) {
                console.log(error);
                return;
              }

              answerCandidates.forEach((candidate) => {
                pcRef.current?.addIceCandidate(
                  new RTCIceCandidate({
                    candidate: candidate.candidate,
                    sdpMLineIndex: candidate.sdpMLineIndex,
                    sdpMid: candidate.sdpMid,
                    usernameFragment: candidate.usernameFragment,
                  })
                );
              });
            }
          }
        )
        .subscribe();

      // listener for answerCandidates
      supabase
        .channel("answerCandidates")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "answerCandidates",
            filter: `call_id=eq.${createdCall.id}`,
          },
          (payload) => {
            if (pcRef.current && pcRef.current.currentRemoteDescription) {
              const candidate = new RTCIceCandidate({
                candidate: payload.new.candidate,
                sdpMLineIndex: payload.new.sdpMLineIndex,
                sdpMid: payload.new.sdpMid,
                usernameFragment: payload.new.usernameFragment,
              });
              pcRef.current?.addIceCandidate(candidate);
            }
          }
        )
        .subscribe();
    } else if (params.id) {
      const { data: callDoc, error: callError } = await supabase
        .from("calls")
        .select("id, offer_sdp, offer_type")
        .eq("id", params.id)
        .returns<
          {
            id: number;
            offer_sdp: string;
            offer_type: RTCSdpType;
          }[]
        >();

      if (callError) {
        console.log(callError);
        return;
      }

      if (callDoc.length === 0) {
        router.replace("/");
        return;
      }

      const call = callDoc[0];
      setCallId(call.id.toString());
      callId = call.id.toString();

      pcRef.current.onicecandidate = (event) => {
        event.candidate &&
          supabase
            .from("answerCandidates")
            .insert({
              ...event.candidate.toJSON(),
              call_id: call.id,
            })
            .then();
      };

      const offerDescription = new RTCSessionDescription({
        sdp: call.offer_sdp,
        type: call.offer_type,
      });
      await pcRef.current.setRemoteDescription(offerDescription);

      const answerDescription = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answerDescription);

      const answer = {
        answer_sdp: answerDescription.sdp,
        answer_type: answerDescription.type,
      };

      await supabase.from("calls").update(answer).eq("id", call.id);

      const { data: offerCandidates, error } = await supabase
        .from("offerCandidates")
        .select("candidate, sdpMLineIndex, sdpMid, usernameFragment")
        .eq("call_id", call.id)
        .returns<
          {
            candidate: string;
            sdpMLineIndex: number;
            sdpMid: string;
            usernameFragment: string;
          }[]
        >();

      if (error) {
        console.log(error);
        return;
      }

      offerCandidates.forEach((candidate) => {
        pcRef.current?.addIceCandidate(
          new RTCIceCandidate({
            candidate: candidate.candidate,
            sdpMLineIndex: candidate.sdpMLineIndex,
            sdpMid: candidate.sdpMid,
            usernameFragment: candidate.usernameFragment,
          })
        );
      });

      // TODO: finish a listener for offerCandidates
      supabase
        .channel("offerCandidates")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "offerCandidates",
            filter: `call_id=eq.${call.id}`,
          },
          (payload) => {
            pcRef.current?.addIceCandidate(new RTCIceCandidate(payload.new));
          }
        )
        .subscribe();
    }

    if (callId !== "") {
      supabase
        .channel("calls_delete")
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "calls", filter: `id=eq.${callId}` },
          async () => {
            hangUp();
          }
        )
        .subscribe();
    }

    pcRef.current.onconnectionstatechange = () => {
      if (pcRef.current?.connectionState === "disconnected") {
        hangUp();
      }
    };
  };

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
