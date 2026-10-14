/** Fail closed for inaccessible linked reservations, but keep standalone manual work. */
export function isVisibleCleaningTask(task: {
  reservation_id: string | null;
  reservation: { status: string } | null;
  superseded_at: string | null;
}) {
  return !task.superseded_at && (!task.reservation_id ||
    (!!task.reservation && !["cancelled", "blocked"].includes(task.reservation.status)));
}
