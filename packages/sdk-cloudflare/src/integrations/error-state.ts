const CAPTURED_ERROR_SYMBOL = Symbol.for('@log9/cloudflare/captured-error')

type ErrorWithCaptureState = Error & {
  [CAPTURED_ERROR_SYMBOL]?: boolean
}

export function isCapturedError(error: unknown): boolean {
  return error instanceof Error && (error as ErrorWithCaptureState)[CAPTURED_ERROR_SYMBOL] === true
}

export function markCapturedError(error: unknown): void {
  if (!(error instanceof Error)) {
    return
  }

  ;(error as ErrorWithCaptureState)[CAPTURED_ERROR_SYMBOL] = true
}
