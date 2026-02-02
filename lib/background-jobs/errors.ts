export class RescheduleBackgroundJobError extends Error {
  runAt: Date;

  constructor(runAt: Date, message: string = "Reschedule background job") {
    super(message);
    this.name = "RescheduleBackgroundJobError";
    this.runAt = runAt;
  }
}
