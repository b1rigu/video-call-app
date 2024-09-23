"use client";

import { createClient } from "@/utils/supabase/client";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MdOutlineCallEnd } from "react-icons/md";
import { LuScreenShare } from "react-icons/lu";
import { LuScreenShareOff } from "react-icons/lu";
import { FiVideo } from "react-icons/fi";
import { FiVideoOff } from "react-icons/fi";
import { FiMic } from "react-icons/fi";
import { FiMicOff } from "react-icons/fi";

export default function Room({ params }: { params: { id: string } }) {
  const router = useRouter();
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const pcRef: MutableRefObject<RTCPeerConnection | null> = useRef(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenShareStreamRef = useRef<MediaStream | null>(null);
  const supabase = createClient();
  const [callId, setCallId] = useState<string>("");
  const callIdRef = useRef<string>("");
  const iceServerUrl = process.env.NEXT_PUBLIC_ICESERVER_URL;
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSharingVideo, setIsSharingVideo] = useState(true);

  useEffect(() => {
    const handleUnload = (event: any) => {
      supabase.from("calls").delete().eq("id", callIdRef.current).then();
    };

    setIsMobile(/Mobi|Android/i.test(navigator.userAgent));
    setupSources();

    window.addEventListener("unload", handleUnload);

    return () => {
      window.removeEventListener("unload", handleUnload);
      hangUp();
    };
  }, []);

  function stopStreams(videoElement: HTMLVideoElement | null) {
    if (videoElement && videoElement.srcObject) {
      const stream = videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
  }

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

  function hideVideo() {
    if (localStreamRef.current) {
      localStreamRef.current!.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    if (screenShareStreamRef.current) {
      screenShareStreamRef.current!.getTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    setIsSharingVideo(false);
  }

  function unhideVideo() {
    if (localStreamRef.current) {
      localStreamRef.current!.getVideoTracks().forEach((track) => {
        track.enabled = true;
      });
    }
    if (screenShareStreamRef.current) {
      screenShareStreamRef.current!.getTracks().forEach((track) => {
        track.enabled = true;
      });
    }
    setIsSharingVideo(true);
  }

  function muteMicrophone() {
    if (localStreamRef.current) {
      localStreamRef.current!.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    setIsMuted(true);
  }

  function unmuteMicrophone() {
    if (localStreamRef.current) {
      localStreamRef.current!.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
    }
    setIsMuted(false);
  }

  async function stopScreenShare() {
    screenShareStreamRef.current!.getTracks().forEach((track) => track.stop());
    const localStream = localStreamRef.current!;
    const videoSender = pcRef.current!.getSenders().find((sender) => {
      return sender.track!.kind === "video";
    });
    if (videoSender) {
      videoSender.replaceTrack(localStream.getVideoTracks()[0]);
      localRef.current!.srcObject = localStream;
      setIsScreenSharing(false);
    }
  }

  async function startScreenShare() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false, // Set to true if you also want to capture audio
      });
      localRef.current!.srcObject = screenStream;
      screenShareStreamRef.current = screenStream;

      // Get the video track from the screen share stream
      const screenTrack = screenStream.getVideoTracks()[0];

      // Find the video sender in the peer connection
      const videoSender = pcRef.current!.getSenders().find((sender) => {
        return sender.track!.kind === "video";
      });

      // Replace the current video track with the screen share track
      if (videoSender) {
        videoSender.replaceTrack(screenTrack);

        setIsScreenSharing(true);

        // Optionally, you can listen for when the user stops sharing the screen
        screenTrack.onended = () => {
          stopScreenShare();
        };
      }
    } catch (error) {
      console.error("Error switching to screen share: ", error);
    }
  }

  async function setupSources() {
    await setupIceServers();
    if (!pcRef.current) return;

    const localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localStreamRef.current = localStream;
    const remoteStream = new MediaStream();

    localStream.getTracks().forEach((track) => {
      pcRef.current!.addTrack(track, localStream);
    });

    pcRef.current!.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    };

    localRef.current!.srcObject = localStream;
    remoteRef.current!.srcObject = remoteStream;

    const localCallId = params.id === "start" ? await startCall() : await joinCall();

    if (!localCallId) return;

    setCallId(localCallId);

    setupRoomDeleteListener(localCallId);
  }

  async function startCall(): Promise<string | null> {
    const { data: createdCall, error } = await supabase.from("calls").insert({}).select().single();
    if (error) return null;

    callIdRef.current = createdCall.id;
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

    callIdRef.current = call.id;
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

  function hangUp() {
    supabase.from("calls").delete().eq("id", callIdRef.current).then();
    supabase.removeAllChannels().then();
    pcRef.current!.close();

    stopStreams(localRef.current);
    stopStreams(remoteRef.current);

    router.replace("/");
  }

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
    <div className="text-center h-screen">
      <div className="w-full h-full bg-black flex items-center justify-center">
        <video
          className="-scale-x-100 w-full h-full object-contain"
          ref={remoteRef}
          autoPlay
          playsInline
        ></video>
      </div>
      <div
        className={
          "w-full max-w-48 sm:max-w-64 rounded-xl bg-black fixed top-4 right-4 aspect-video border-2 border-white/20 flex items-center justify-center" +
          (isSharingVideo ? "" : " hidden")
        }
      >
        <video
          className="-scale-x-100 w-full h-full object-contain"
          ref={localRef}
          autoPlay
          playsInline
          muted
        ></video>
      </div>

      <div className="flex flex-col items-center justify-center gap-4 fixed bottom-0 left-0 w-full h-32 opacity-100 transition-opacity bg-gradient-to-t from-gray-800 to-transparent">
        <div className="flex items-center gap-4">
          <button
            className={
              "hover:bg-slate-700 text-white font-bold py-2 px-4 rounded" +
              (isSharingVideo ? " bg-slate-500" : " bg-slate-700")
            }
            onClick={isSharingVideo ? hideVideo : unhideVideo}
          >
            {isSharingVideo ? <FiVideo className="text-xl" /> : <FiVideoOff className="text-xl" />}
          </button>
          <button
            className={
              "hover:bg-slate-700 text-white font-bold py-2 px-4 rounded" +
              (isMuted ? " bg-slate-700" : " bg-slate-500")
            }
            onClick={isMuted ? unmuteMicrophone : muteMicrophone}
          >
            {isMuted ? <FiMicOff className="text-xl" /> : <FiMic className="text-xl" />}
          </button>
          {!isMobile && (
            <button
              className={
                "hover:bg-blue-700 text-white font-bold py-2 px-4 rounded" +
                (isScreenSharing ? " bg-blue-700" : " bg-blue-500")
              }
              onClick={isScreenSharing ? stopScreenShare : startScreenShare}
            >
              {isScreenSharing ? (
                <LuScreenShareOff className="text-xl" />
              ) : (
                <LuScreenShare className="text-xl" />
              )}
            </button>
          )}
          <button
            className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded "
            onClick={hangUp}
          >
            <MdOutlineCallEnd className="text-xl" />
          </button>
        </div>
        {callId && <p className="text-white">Call ID: {callId}</p>}
      </div>
    </div>
  );
}
