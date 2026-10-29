import { useEffect, useState } from "react";
import { MAX_PIN_LENGTH } from "@auxo/core";
import styles from "./PinPad.module.css";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"];

export interface PinPadProps {
  errorMessage?: string | null;
  onSubmit: (pin: string) => void;
  /** Submits automatically once this many digits are entered (default 4). Set to MAX_PIN_LENGTH to require explicit submit via Enter. */
  autoSubmitLength?: number;
}

export function PinPad({ errorMessage, onSubmit, autoSubmitLength = 4 }: PinPadProps) {
  const [pin, setPin] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (/^[0-9]$/.test(event.key)) {
        setPin((prev) => (prev.length < MAX_PIN_LENGTH ? prev + event.key : prev));
      } else if (event.key === "Backspace") {
        setPin((prev) => prev.slice(0, -1));
      } else if (event.key === "Enter" && pin.length > 0) {
        onSubmit(pin);
        setPin("");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pin, onSubmit]);

  useEffect(() => {
    if (pin.length === autoSubmitLength) {
      onSubmit(pin);
      setPin("");
    }
  }, [pin, autoSubmitLength, onSubmit]);

  useEffect(() => {
    if (errorMessage) setPin("");
  }, [errorMessage]);

  return (
    <div>
      <div className={styles.dots} aria-hidden="true">
        {Array.from({ length: Math.max(autoSubmitLength, pin.length) }).map((_, i) => (
          <span key={i} className={[styles.dot, i < pin.length ? styles.dotFilled : ""].join(" ")} />
        ))}
      </div>
      <p className={styles.error}>{errorMessage ?? ""}</p>
      <div className={styles.grid} role="group" aria-label="PIN entry">
        {KEYS.map((key, i) => {
          if (key === "") return <span key={i} />;
          if (key === "backspace") {
            return (
              <button
                key={i}
                type="button"
                className={[styles.key, styles.keyGhost].join(" ")}
                aria-label="Backspace"
                onClick={() => setPin((prev) => prev.slice(0, -1))}
              >
                ⌫
              </button>
            );
          }
          return (
            <button
              key={i}
              type="button"
              className={styles.key}
              onClick={() => setPin((prev) => (prev.length < MAX_PIN_LENGTH ? prev + key : prev))}
            >
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
