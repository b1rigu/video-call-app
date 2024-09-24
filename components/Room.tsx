"use client";

import { createClient } from "@/utils/supabase/client";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FlipHorizontal2,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneMissed,
  Video,
  VideoOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import MediaSettings from "@/components/MediaSettings";

export default function Room({ params, iceServers }: { params: { id: string }; iceServers: [] }) {
  const supabase = createClient();
  const router = useRouter();
  const pcRef: MutableRefObject<RTCPeerConnection | null> = useRef(null);
  const localVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const callIdRef = useRef<string>("");

  const [isMirrored, setIsMirrored] = useState(true);
  const [callId, setCallId] = useState<string>("");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSharingVideo, setIsSharingVideo] = useState(true);
  const [userAnsweredCall, setUserAnsweredCall] = useState(false);
  const [devices, setDevices] = useState<{
    audioInputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
  }>({
    audioInputs: [],
    videoInputs: [],
  });

  useEffect(() => {
    setupWebRTC();
    window.addEventListener("unload", deleteCurrentCallData);
    return () => {
      window.removeEventListener("unload", deleteCurrentCallData);
      hangUp();
    };
  }, []);

  async function setupWebRTC() {
    pcRef.current = new RTCPeerConnection({
      iceServers: iceServers,
      iceCandidatePoolSize: 10,
    });
    setIsMobile(/Mobi|Android/i.test(navigator.userAgent));
    const localDevices = await getDevices();
    setDevices(localDevices);

    await setupTracks(localDevices);

    const localCallId = params.id === "start" ? await startCall() : await joinCall();

    if (!localCallId) return;

    setCallId(localCallId);

    setupRoomDeleteListener(localCallId);
  }

  async function setupTracks(localDevices: {
    audioInputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
  }) {
    if (localDevices.audioInputs.length > 0 || localDevices.videoInputs.length > 0) {
      const localStream = await navigator.mediaDevices.getUserMedia({
        video:
          localDevices.videoInputs.length > 0
            ? { deviceId: localDevices.videoInputs[0].deviceId }
            : false,
        audio:
          localDevices.audioInputs.length > 0
            ? { deviceId: localDevices.audioInputs[0].deviceId }
            : false,
      });
      localStreamRef.current = localStream;
      localStream.getTracks().forEach((track) => {
        pcRef.current!.addTrack(track, localStream);
      });
      if (localVideoElementRef.current) localVideoElementRef.current.srcObject = localStream;
    }

    const remoteStream = new MediaStream();
    pcRef.current!.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    };
    if (remoteVideoElementRef.current) remoteVideoElementRef.current.srcObject = remoteStream;
  }

  async function getDevices() {
    await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
    const audioDeviceList = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = audioDeviceList.filter(
      (device) => device.kind === "audioinput" && device.deviceId !== ""
    );

    await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {});
    const allDeviceList = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = allDeviceList.filter(
      (device) => device.kind === "videoinput" && device.deviceId !== ""
    );
    return {
      audioInputs,
      videoInputs,
    };
  }

  async function changeMediaDevice(constraints: MediaStreamConstraints) {
    const newStream = await navigator.mediaDevices.getUserMedia(constraints);
    newStream.getTracks().forEach((track) => {
      const existingTrack = pcRef
        .current!.getSenders()
        .find((sender) => sender.track!.kind === track.kind);
      if (existingTrack) {
        existingTrack.replaceTrack(track);
      } else {
        pcRef.current!.addTrack(track, newStream);
      }
    });

    localVideoElementRef.current!.srcObject = newStream;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        if (track.kind !== "video" && track.kind !== "audio") return;
        track.stop();
      });
    }

    localStreamRef.current = newStream;
  }

  function stopStreams(videoElement: HTMLVideoElement | null) {
    if (videoElement && videoElement.srcObject) {
      const stream = videoElement.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
  }

  function switchVideoState() {
    if (localStreamRef.current) {
      localStreamRef.current!.getVideoTracks().forEach((track) => {
        track.enabled = !isSharingVideo;
      });
    }
    setIsSharingVideo(!isSharingVideo);
  }

  function switchMicrophoneState() {
    if (localStreamRef.current) {
      localStreamRef.current!.getAudioTracks().forEach((track) => {
        track.enabled = isMuted;
      });
    }
    setIsMuted(!isMuted);
  }

  async function startScreenShare() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const screenTrack = screenStream.getVideoTracks()[0];

      screenStream.getVideoTracks().forEach((track) => {
        const existingTrack = pcRef
          .current!.getSenders()
          .find((sender) => sender.track!.kind === track.kind);
        if (existingTrack) {
          existingTrack.replaceTrack(track);
        } else {
          pcRef.current!.addTrack(track, screenStream);
        }
      });

      localVideoElementRef.current!.srcObject = screenStream;

      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((track) => {
          track.stop();
        });
      }

      localStreamRef.current = screenStream;

      setIsScreenSharing(true);

      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (error) {
      console.error("Error switching to screen share: ", error);
    }
  }

  async function stopScreenShare() {
    changeMediaDevice({
      video: devices.videoInputs.length > 0 ? { deviceId: devices.videoInputs[0].deviceId } : false,
      audio: devices.audioInputs.length > 0 ? { deviceId: devices.audioInputs[0].deviceId } : false,
    });
    setIsScreenSharing(false);
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
          setUserAnsweredCall(true);
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

    setUserAnsweredCall(true);

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

  function deleteCurrentCallData() {
    supabase.from("calls").delete().eq("id", callIdRef.current).then();
  }

  function hangUp() {
    deleteCurrentCallData();
    supabase.removeAllChannels().then();
    pcRef.current!.close();

    stopStreams(localVideoElementRef.current);
    stopStreams(remoteVideoElementRef.current);
    localStreamRef.current = null;
    localVideoElementRef.current = null;
    remoteVideoElementRef.current = null;

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

  function setupRoomDeleteListener(localCallId: string) {
    if (localCallId !== "") {
      setupListener("calls_delete", "calls", `id=eq.${localCallId}`, (payload) => {
        payload.eventType === "DELETE" ? hangUp() : null;
      });
    }

    pcRef.current!.onconnectionstatechange = () => {
      if (pcRef.current!.connectionState === "disconnected") {
        hangUp();
      }
    };
  }

  return (
    <div className="text-center h-screen">
      <div className="w-full h-full bg-black flex items-center justify-center">
        <video
          className={"w-full h-full object-contain" + (userAnsweredCall ? "" : " hidden")}
          ref={remoteVideoElementRef}
          autoPlay
          playsInline
        ></video>
        {!userAnsweredCall && (
          <div>
            <p className="text-2xl text-white">Waiting for a person to join the call...</p>
            {callId && <p className="text-white">Call ID: {callId}</p>}
          </div>
        )}
      </div>
      <div
        className={
          "w-full max-w-48 sm:max-w-64 rounded-xl bg-black fixed top-4 right-4 aspect-video border-2 border-white/20 flex items-center justify-center" +
          (isSharingVideo ? "" : " opacity-0")
        }
      >
        <video
          className={"w-full h-full object-contain" + (isMirrored ? " -scale-x-100" : "")}
          ref={localVideoElementRef}
          autoPlay
          playsInline
          muted
        ></video>
      </div>

      <div className="flex flex-col items-center justify-center gap-4 fixed bottom-0 left-0 w-full h-32 opacity-100 transition-opacity bg-gradient-to-t from-gray-800 to-transparent">
        <div className="flex items-center gap-4">
          <Button
            disabled={devices.videoInputs.length === 0}
            onClick={() => setIsMirrored(!isMirrored)}
            variant="outline"
            size="icon"
          >
            <FlipHorizontal2 className="h-5 w-5" />
          </Button>
          <Button
            disabled={devices.videoInputs.length === 0}
            onClick={switchVideoState}
            variant={isSharingVideo ? "outline" : "secondary"}
            size="icon"
          >
            {isSharingVideo ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </Button>
          <Button
            disabled={devices.audioInputs.length === 0}
            onClick={switchMicrophoneState}
            variant={isMuted ? "secondary" : "outline"}
            size="icon"
          >
            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Button>
          {!isMobile && (
            <Button
              onClick={isScreenSharing ? stopScreenShare : startScreenShare}
              variant={isScreenSharing ? "secondary" : "outline"}
              size="icon"
            >
              {isScreenSharing ? (
                <MonitorX className="h-5 w-5" />
              ) : (
                <MonitorUp className="h-5 w-5" />
              )}
            </Button>
          )}
          <Button onClick={hangUp} variant="destructive" size="icon">
            <PhoneMissed className="h-5 w-5" />
          </Button>
          <MediaSettings devices={devices} changeMediaDevice={changeMediaDevice} />
        </div>
      </div>
    </div>
  );
}
