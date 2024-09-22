"use client";

import Link from "next/link";
import { useState } from "react";

export default function Home() {
  const [roomId, setRoomId] = useState("");

  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="text-center flex flex-col gap-4">
        <h1 className="text-3xl font-bold">Video Call App</h1>
        <p className="text-lg">
          This is a video call app that allows you to make video calls using WebRTC.
        </p>
        <div className="flex flex-col gap-2">
          <Link
            href={"/room/start"}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Start Call
          </Link>
          <p>Or</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter the room ID"
              name="roomId"
              className="bg-gray-200 border border-gray-300 text-gray-700 px-4 rounded flex-grow"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
            <Link
              href={"/room/" + roomId}
              className={
                roomId == ""
                  ? "bg-gray-500 text-white font-bold py-2 px-4 rounded pointer-events-none"
                  : "bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              }
            >
              Join Call
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
