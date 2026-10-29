import { formatMinorUnits, money } from "@auxo/core";
import { useTheme, type ThemePreference } from "../theme/useTheme";
import styles from "./StylePreview.module.css";

const COLOR_TOKENS = [
  { name: "surface-0", varName: "--color-surface-0" },
  { name: "surface-1", varName: "--color-surface-1" },
  { name: "surface-2", varName: "--color-surface-2" },
  { name: "surface-raised", varName: "--color-surface-raised" },
  { name: "border", varName: "--color-border" },
  { name: "text-primary", varName: "--color-text-primary" },
  { name: "text-secondary", varName: "--color-text-secondary" },
  { name: "text-tertiary", varName: "--color-text-tertiary" },
  { name: "accent", varName: "--color-accent" },
  { name: "money-owed", varName: "--color-money-owed" },
  { name: "money-paid", varName: "--color-money-paid" },
] as const;

const TYPE_SCALE = [
  { label: "text-xs", varName: "--text-xs" },
  { label: "text-sm", varName: "--text-sm" },
  { label: "text-base", varName: "--text-base" },
  { label: "text-lg", varName: "--text-lg" },
  { label: "text-xl", varName: "--text-xl" },
  { label: "text-2xl", varName: "--text-2xl" },
  { label: "text-3xl", varName: "--text-3xl" },
  { label: "text-4xl", varName: "--text-4xl" },
] as const;

const SPACING_SCALE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;

const RADII = [
  { label: "sm", varName: "--radius-sm" },
  { label: "md", varName: "--radius-md" },
  { label: "lg", varName: "--radius-lg" },
  { label: "full", varName: "--radius-full" },
] as const;

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export function StylePreview() {
  const [theme, setTheme] = useTheme();

  const owed = formatMinorUnits(money(12_450));
  const paid = formatMinorUnits(money(8_900));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Auxo — style preview</h1>
          <p className={styles.subtitle}>Design tokens for the web rebuild, before any real screens.</p>
        </div>
        <div className={styles.themeToggle} role="radiogroup" aria-label="Theme">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={theme === option.value}
              className={[
                styles.themeToggleButton,
                theme === option.value ? styles.themeToggleButtonActive : "",
              ].join(" ")}
              onClick={() => setTheme(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Colour</h2>
        <div className={styles.swatchGrid}>
          {COLOR_TOKENS.map((token) => (
            <div key={token.name} className={styles.swatch}>
              <div className={styles.swatchColor} style={{ background: `var(${token.varName})` }} />
              <div className={styles.swatchLabel}>
                <span className={styles.swatchName}>{token.name}</span>
                <span className={styles.swatchValue}>{token.varName}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Type scale</h2>
        {TYPE_SCALE.map((step) => (
          <div key={step.label} className={styles.typeRow}>
            <span className={styles.typeLabel}>{step.label}</span>
            <span className={styles.typeSample} style={{ fontSize: `var(${step.varName})` }}>
              Auxo POS
            </span>
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Spacing</h2>
        {SPACING_SCALE.map((step) => (
          <div key={step} className={styles.spacingRow}>
            <span className={styles.spacingLabel}>space-{step}</span>
            <div className={styles.spacingBar} style={{ width: `var(--space-${step})` }} />
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Radii</h2>
        <div className={styles.radiusRow}>
          {RADII.map((radius) => (
            <div
              key={radius.label}
              className={styles.radiusSwatch}
              style={{ borderRadius: `var(${radius.varName})` }}
            >
              {radius.label}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Money (red = owes, green = paid)</h2>
        <div className={styles.cardRow}>
          <div className={styles.card}>
            <p className={styles.cardLabel}>Customer owes</p>
            <p className={[styles.cardMoney, styles.moneyOwed].join(" ")}>₹{owed}</p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>Paid today</p>
            <p className={[styles.cardMoney, styles.moneyPaid].join(" ")}>₹{paid}</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Controls</h2>
        <div className={styles.buttonRow}>
          <button type="button" className={styles.buttonPrimary}>
            New bill
          </button>
          <button type="button" className={styles.buttonSecondary}>
            Park bill
          </button>
          <span className={styles.kbd}>Ctrl/Cmd K</span>
          <span className={styles.kbd}>Command palette</span>
        </div>
      </section>
    </main>
  );
}
