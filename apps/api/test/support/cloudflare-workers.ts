export class WorkerEntrypoint<TEnv extends object = object> {
  constructor(public env: TEnv) {}
}
