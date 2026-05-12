/** Row from `public.public_room_settings` (website list prices). */
export type PublicRoomSettingRow = {
  id: string;
  property_code: string;
  room_type: string;
  display_name: string;
  weekday_price: number;
  friday_price: number;
  saturday_price: number;
  included_guests: number;
  extra_guest_fee: number;
  max_guests: number;
  inventory_cap: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** Row from `public.public_inventory_caps` (marketing inventory by guest band). */
export type PublicInventoryCapRow = {
  id: string;
  property_code: string;
  room_type: string;
  min_guests: number;
  max_guests: number;
  inventory_cap: number;
  created_at: string;
  updated_at: string;
};

/** Row from `public.public_seasonal_room_rates` (date-range price / cap overrides). */
export type PublicSeasonalRoomRateRow = {
  id: string;
  property_code: string;
  room_type: string;
  name: string;
  start_date: string;
  end_date: string;
  weekday_price: number;
  friday_price: number;
  saturday_price: number;
  included_guests: number | null;
  extra_guest_fee: number | null;
  inventory_cap_override: number | null;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
};
