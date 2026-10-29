import { validatePinFormat, type ShopCategoryType } from "@auxo/core";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import styles from "./OnboardingScreen.module.css";

const CATEGORY_OPTIONS: { value: ShopCategoryType; label: string }[] = [
  { value: "GARMENT", label: "Garment" },
  { value: "FOOTWEAR", label: "Footwear" },
  { value: "ACCESSORIES", label: "Accessories" },
  { value: "PACKAGED_FOOD", label: "Packaged food" },
  { value: "BEVERAGE", label: "Beverage" },
  { value: "GENERAL", label: "General item" },
  { value: "ELECTRONICS", label: "Electronics" },
  { value: "PHARMACY", label: "Pharmacy" },
  { value: "COSMETICS", label: "Cosmetics" },
  { value: "LOOSE", label: "Loose goods" },
  { value: "JEWELLERY", label: "Jewellery" },
  { value: "RESTAURANT", label: "Restaurant menu" },
];

export function OnboardingScreen() {
  const { completeSetup, acknowledgeRecoveryCodes } = useAuth();
  const [storeName, setStoreName] = useState("");
  const [categories, setCategories] = useState<Set<ShopCategoryType>>(new Set());
  const [adminName, setAdminName] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  function toggleCategory(value: ShopCategoryType) {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (storeName.trim().length === 0) return setError("Enter your shop name");
    if (categories.size === 0) return setError("Pick at least one category");
    if (adminName.trim().length === 0) return setError("Enter your name");
    const pinError = validatePinFormat(pin);
    if (pinError) return setError(pinError);
    if (pin !== confirmPin) return setError("PINs do not match");

    setSubmitting(true);
    try {
      const { recoveryCodes: codes } = await completeSetup({
        storeName: storeName.trim(),
        categories: [...categories],
        adminName: adminName.trim(),
        pin,
      });
      setRecoveryCodes(codes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (recoveryCodes) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Save your recovery codes</h1>
          <p className={styles.recoveryNote}>
            If you ever forget your PIN, one of these one-time codes gets you back in. Each code
            works once. Write them down somewhere safe — they will not be shown again.
          </p>
          <div className={styles.recoveryList}>
            {recoveryCodes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
          <button type="button" className={styles.button} onClick={acknowledgeRecoveryCodes}>
            I've saved these codes
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title}>Set up Auxo</h1>
        <p className={styles.subtitle}>A few details to get your shop started.</p>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="storeName">
            Shop name
          </label>
          <input
            id="storeName"
            className={styles.input}
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <span className={styles.label}>What do you sell?</span>
          <div className={styles.categoryGrid}>
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={[
                  styles.categoryChip,
                  categories.has(option.value) ? styles.categoryChipSelected : "",
                ].join(" ")}
                aria-pressed={categories.has(option.value)}
                onClick={() => toggleCategory(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="adminName">
            Your name (shop owner)
          </label>
          <input
            id="adminName"
            className={styles.input}
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="pin">
            Choose a PIN (4-8 digits)
          </label>
          <input
            id="pin"
            className={styles.input}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="confirmPin">
            Confirm PIN
          </label>
          <input
            id="confirmPin"
            className={styles.input}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
          />
        </div>

        <button type="submit" className={styles.button} disabled={submitting}>
          {submitting ? "Setting up…" : "Create shop"}
        </button>
      </form>
    </main>
  );
}
