import { useCallback, useRef, useState } from "react";

/**
 * Internal state backing {@link useConfirm}. Mirrors the copy-pasted
 * `confirmState` object pattern (open + dialog copy + the deferred callback)
 * that previously lived in each admin page, now centralized in one hook.
 *
 * @see Architecture-refactoring design §12 (Confirmation hook, R12).
 */
export interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  /** Whether the confirm action is styled as destructive (red). */
  destructive?: boolean;
  /** The callback to run when the user accepts. */
  onConfirm: () => void;
}

/**
 * Options accepted by {@link UseConfirmResult.confirm}. Matches the design
 * contract `{ title, message, onConfirm }`, with an optional `destructive`
 * flag passed straight through to the existing `<ConfirmDialog/>`.
 */
export interface ConfirmOptions {
  title: string;
  message: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * Props produced by the hook to be spread directly into the existing
 * `<ConfirmDialog/>` component. The names match `ConfirmDialog`'s props
 * exactly (`open`/`title`/`message`/`destructive`/`onConfirm`/`onCancel`)
 * so usage is `<ConfirmDialog {...dialogProps} />`.
 */
export interface ConfirmDialogControlledProps {
  open: boolean;
  title: string;
  message: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Return shape of {@link useConfirm}. */
export interface UseConfirmResult {
  /** Opens the confirmation dialog with the given copy and accept callback. */
  confirm: (opts: ConfirmOptions) => void;
  /** Spread into the existing `<ConfirmDialog/>`. */
  dialogProps: ConfirmDialogControlledProps;
}

const CLOSED: ConfirmState = {
  open: false,
  title: "",
  message: "",
  destructive: false,
  onConfirm: () => {},
};

/**
 * Hook that standardizes confirmation-dialog state for admin destructive
 * actions. Replaces the per-page `confirmState` object + handler boilerplate.
 *
 * `confirm({ title, message, onConfirm })` opens the dialog and stores the
 * accept callback. `dialogProps` is spread into the existing
 * `<ConfirmDialog/>`: `onCancel` closes the dialog without running anything,
 * and `onConfirm` runs the stored callback then closes.
 *
 * @see Architecture-refactoring design §12 (Confirmation hook, R12).
 */
export function useConfirm(): UseConfirmResult {
  const [state, setState] = useState<ConfirmState>(CLOSED);
  // Hold the deferred accept callback in a ref so `onConfirm` stays stable
  // and never runs a side effect inside a state updater (StrictMode-safe).
  const callbackRef = useRef<() => void>(() => {});

  const confirm = useCallback((opts: ConfirmOptions) => {
    callbackRef.current = opts.onConfirm;
    setState({
      open: true,
      title: opts.title,
      message: opts.message,
      destructive: opts.destructive ?? false,
      onConfirm: opts.onConfirm,
    });
  }, []);

  const onCancel = useCallback(() => {
    setState(CLOSED);
  }, []);

  const onConfirm = useCallback(() => {
    callbackRef.current();
    setState(CLOSED);
  }, []);

  return {
    confirm,
    dialogProps: {
      open: state.open,
      title: state.title,
      message: state.message,
      destructive: state.destructive,
      onConfirm,
      onCancel,
    },
  };
}
