import Room from "@/components/Room";
import { redirect } from "next/navigation";

export default async function RoomById({ params }: { params: { id: string } }) {
  async function setupIceServers() {
    if (!process.env.ICESERVER_URL) return null;

    try {
      const response = await fetch(process.env.ICESERVER_URL, {
        next: { revalidate: 3600 },
      });

      if (!response.ok) {
        throw new Error("Error");
      }

      const iceServers: [] = await response.json();

      return iceServers;
    } catch (error) {
      console.error("Failed to fetch ICE server list:", error);
    }

    return null;
  }

  const iceServers = await setupIceServers();

  if (!iceServers) {
    redirect("/");
  }

  return <Room params={params} iceServers={iceServers} />;
}
