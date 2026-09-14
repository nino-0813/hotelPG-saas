"use client";

import { useRouter } from "next/navigation";
import type { Property, Room } from "@/lib/types/database";
import { NewReservationForm } from "../reservation-modal";

export function NewReservationPageForm({ date, rooms, properties }: { date: string; rooms: Room[]; properties: Property[] }) {
  const router = useRouter();
  return (
    <NewReservationForm
      date={date}
      rooms={rooms}
      properties={properties}
      onClose={() => router.push("/reservations")}
    />
  );
}
