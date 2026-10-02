"use client";

import { useRouter } from "next/navigation";
import type { Property, Room } from "@/lib/types/database";
import { NewReservationForm } from "../reservation-modal";

export function NewReservationPageForm({ date, roomId, rooms, properties }: { date: string; roomId?: string; rooms: Room[]; properties: Property[] }) {
  const router = useRouter();
  return (
    <NewReservationForm
      date={date}
      roomId={roomId}
      rooms={rooms}
      properties={properties}
      onClose={() => router.push("/reservations")}
    />
  );
}
