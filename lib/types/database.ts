export type RoomType = "family" | "single" | "standard";
export type StaffRole = "admin" | "staff";
export type PaymentMethod = "online" | "onsite";
export type ReservationStatus =
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled";
export type TaskType = "cleaning" | "prep" | "key_setup" | "special_check";
export type TaskStatus = "todo" | "in_progress" | "done";
export type RoomStatusValue = "uncleaned" | "cleaning" | "ready" | "occupied";

export type Property = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  display_order: number;
  created_at: string;
};

export type Room = {
  id: string;
  property_id: string;
  room_number: string;
  room_type: RoomType;
  smart_key_code: string | null;
  display_order: number;
  created_at: string;
};

export type Staff = {
  id: string;
  display_name: string;
  role: StaffRole;
  line_user_id: string | null;
  assigned_property_ids: string[];
  created_at: string;
};

export type Reservation = {
  id: string;
  room_id: string;
  guest_name: string;
  guest_phone: string | null;
  guest_count: number;
  check_in_date: string;
  check_out_date: string;
  check_in_time: string;
  check_out_time: string;
  payment_method: PaymentMethod;
  smart_key_code: string | null;
  special_notes: string | null;
  source: string | null;
  status: ReservationStatus;
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: string;
  reservation_id: string | null;
  room_id: string;
  type: TaskType;
  status: TaskStatus;
  assignee_id: string | null;
  scheduled_for: string;
  priority: number;
  note: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RoomStatusRow = {
  room_id: string;
  status: RoomStatusValue;
  updated_by: string | null;
  updated_at: string;
};
