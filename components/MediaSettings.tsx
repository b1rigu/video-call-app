"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";

export default function MediaSettings({
  devices,
  changeMediaDevice,
}: {
  devices: {
    audioInputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
  };
  changeMediaDevice: (constraints: MediaStreamConstraints) => void;
}) {
  const [selectedAudio, setSelectedAudio] = useState<string>("");
  const [selectedVideo, setSelectedVideo] = useState<string>("");

  useEffect(() => {
    if (devices.audioInputs.length > 0) {
      setSelectedAudio(devices.audioInputs[0].deviceId);
    }
    if (devices.videoInputs.length > 0) {
      setSelectedVideo(devices.videoInputs[0].deviceId);
    }
  }, [devices]);

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

  return (
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
              onValueChange={(deviceId) => {
                setSelectedVideo(deviceId);
                changeCamera(deviceId);
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
              onValueChange={(deviceId) => {
                setSelectedAudio(deviceId);
                changeMicrophone(deviceId);
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
  );
}
