# Post-fix Dispatch Verification — appointment-reconcile
- CapturedAtUTC: 2026-02-18T05-59-49Z
- RouteResponseFile: post-fix-appointment-reconcile-dispatch-response-2026-02-18T05-59-49Z.txt
- CheckFile: post-fix-appointment-reconcile-dispatch-check-2026-02-18T05-59-49Z.json
- DispatchKey: cron:appointment-reconcile:2026-02-18T05:59
- EventId: cron/appointment-reconcile.requested:cron:appointment-reconcile:2026-02-18T05:59
- Expectation: dispatch response + durable `BackgroundFunctionRun` rows and zero recent `Invalid signature` failures.
