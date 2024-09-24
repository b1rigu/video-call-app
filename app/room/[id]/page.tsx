"use client";

import { createClient } from "@/utils/supabase/client";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneMissed,
  Settings,
  Video,
  VideoOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Room({ params }: { params: { id: string } }) {
  const router = useRouter();
  const localVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const pcRef: MutableRefObject<RTCPeerConnection | null> = useRef(null);
  const screenShareStreamRef = useRef<MediaStream | null>(null);
  const supabase = createClient();
  const [callId, setCallId] = useState<string>("");
  const callIdRef = useRef<string>("");
  const iceServerUrl = process.env.NEXT_PUBLIC_ICESERVER_URL;
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSharingVideo, setIsSharingVideo] = useState(true);
  const [selectedAudio, setSelectedAudio] = useState<string>("");
  const [selectedVideo, setSelectedVideo] = useState<string>("");
  const [devices, setDevices] = useState<{
    audioInputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
  }>({
    audioInputs: [],
    videoInputs: [],
  });

  useEffect(() => {
    setIsMobile(/Mobi|Android/i.test(navigator.userAgent));
    setupWebRTC();

    window.addEventListener("unload", handleUnload);

    return () => {
      window.removeEventListener("unload", handleUnload);
      hangUp();
    };
  }, []);

  function handleUnload() {
    supabase.from("calls").delete().eq("id", callIdRef.current).then();
  }

  async function setupWebRTC() {
    const devices = await getDevices();
    setDevices(devices);

    try {
      await setupIceServers();
      if (!pcRef.current) return;

      if (devices.audioInputs.length > 0 || devices.videoInputs.length > 0) {
        const localStream = await navigator.mediaDevices.getUserMedia({
          video:
            devices.videoInputs.length > 0 ? { deviceId: devices.videoInputs[0].deviceId } : false,
          audio:
            devices.audioInputs.length > 0
              ? { deviceId: devices.audioInputs[0].deviceId, noiseSuppression: true }
              : false,
        });
        localStreamRef.current = localStream;
        localStream.getTracks().forEach((track) => {
          pcRef.current!.addTrack(track, localStream);
        });
        localVideoElementRef.current!.srcObject = localStream;
      }

      const remoteStream = new MediaStream();
      pcRef.current!.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
          remoteStream.addTrack(track);
        });
      };
      remoteVideoElementRef.current!.srcObject = remoteStream;

      const localCallId = params.id === "start" ? await startCall() : await joinCall();

      if (!localCallId) return;

      setCallId(localCallId);

      setupRoomDeleteListener(localCallId);
    } catch (error) {
      console.error("Error accessing media devices:", error);
    }
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

  async function changeCamera(deviceId: string) {
    const constraints = {
      audio: selectedAudio ? { deviceId: selectedAudio } : false,
      video: { deviceId: deviceId },
    };
    changeMediaDevice(constraints);
  }

  async function changeMicrophone(deviceId: string) {
    const constraints = {
      audio: { deviceId: deviceId },
      video: selectedVideo ? { deviceId: selectedVideo } : false,
    };
    changeMediaDevice(constraints);
  }

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

  function changeVideoState(enabled: boolean) {
    if (localStreamRef.current) {
      localStreamRef.current!.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
    setIsSharingVideo(enabled);
  }

  function hideVideo() {
    changeVideoState(false);
  }

  function unhideVideo() {
    changeVideoState(true);
  }

  function changeMicrophoneState(enabled: boolean) {
    if (localStreamRef.current) {
      localStreamRef.current!.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
    setIsMuted(!enabled);
  }

  function muteMicrophone() {
    changeMicrophoneState(false);
  }

  function unmuteMicrophone() {
    changeMicrophoneState(true);
  }

  async function stopScreenShare() {
    screenShareStreamRef.current!.getTracks().forEach((track) => track.stop());
    const videoSender = pcRef.current!.getSenders().find((sender) => {
      return sender.track!.kind === "video";
    });
    if (videoSender) {
      videoSender.replaceTrack(localStreamRef.current!.getVideoTracks()[0]);
      localVideoElementRef.current!.srcObject = localStreamRef.current!;
      setIsScreenSharing(false);
    }
  }

  async function startScreenShare() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      localVideoElementRef.current!.srcObject = screenStream;
      screenShareStreamRef.current = screenStream;

      const screenTrack = screenStream.getVideoTracks()[0];

      const videoSender = pcRef.current!.getSenders().find((sender) => {
        return sender.track!.kind === "video";
      });

      if (videoSender) {
        videoSender.replaceTrack(screenTrack);

        setIsScreenSharing(true);

        screenTrack.onended = () => {
          stopScreenShare();
        };
      }
    } catch (error) {
      console.error("Error switching to screen share: ", error);
    }
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

    stopStreams(localVideoElementRef.current);
    stopStreams(remoteVideoElementRef.current);

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
          className="w-full h-full object-contain"
          ref={remoteVideoElementRef}
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
            onClick={isSharingVideo ? hideVideo : unhideVideo}
            variant={isSharingVideo ? "outline" : "secondary"}
            size="icon"
          >
            {isSharingVideo ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </Button>
          <Button
            disabled={devices.audioInputs.length === 0}
            onClick={isMuted ? unmuteMicrophone : muteMicrophone}
            variant={isMuted ? "secondary" : "outline"}
            size="icon"
          >
            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </Button>
          {!isMobile && (
            <Button
              onClick={isScreenSharing ? stopScreenShare : startScreenShare}
              variant="outline"
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
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" size="icon">
                <Settings className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Settings</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Camera</Label>
                  <Select
                    disabled={devices.videoInputs.length === 0}
                    defaultValue={devices.videoInputs[0]?.deviceId ?? ""}
                    onValueChange={(value) => {
                      setSelectedVideo(value);
                      changeCamera(value);
                    }}
                  >
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder="Select a camera" />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.videoInputs.map((videoInput) => {
                        return (
                          <SelectItem key={videoInput.deviceId} value={videoInput.deviceId}>
                            {videoInput.label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Microphone</Label>
                  <Select
                    disabled={devices.audioInputs.length === 0}
                    defaultValue={devices.audioInputs[0]?.deviceId ?? ""}
                    onValueChange={(value) => {
                      setSelectedAudio(value);
                      changeMicrophone(value);
                    }}
                  >
                    <SelectTrigger className="col-span-3">
                      <SelectValue placeholder="Select a microphone" />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.audioInputs.map((audioInput) => {
                        return (
                          <SelectItem key={audioInput.deviceId} value={audioInput.deviceId}>
                            {audioInput.label}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        {callId && <p className="text-white">Call ID: {callId}</p>}
      </div>
    </div>
  );
}
